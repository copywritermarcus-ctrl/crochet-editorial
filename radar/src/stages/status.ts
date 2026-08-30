import { EPISODE_STATUSES } from '../lib/status.js';
import { formatTimecode } from '../lib/timecode.js';
import type { RadarContext } from '../types.js';

export interface RunLogSummary {
  id: string;
  command: string;
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  discovered: number;
  imported: number;
  transcribed: number;
  named: number;
  exported: number;
  failed: number;
  skipped: number;
  minutesUsed: number;
  estCostUsd: number;
}

export interface StatusReport {
  countsByStatus: Record<string, number>;
  recentRuns: RunLogSummary[];
  failures: Array<{ episodeId: string; showSlug: string; title: string; errorMessage: string }>;
  needsReview: Array<{ episodeId: string; showSlug: string; title: string; label: string; name: string }>;
}

export const RECENT_RUN_LIMIT = 5;

export async function status(ctx: RadarContext): Promise<StatusReport> {
  const grouped = await ctx.prisma.episode.groupBy({ by: ['status'], _count: { _all: true } });
  const countsByStatus: Record<string, number> = {};
  for (const s of EPISODE_STATUSES) countsByStatus[s] = 0;
  for (const row of grouped) countsByStatus[row.status] = row._count._all;

  const runs = await ctx.prisma.runLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: RECENT_RUN_LIMIT,
  });

  const failed = await ctx.prisma.episode.findMany({
    where: { status: 'failed' },
    orderBy: { publishedAt: 'desc' },
    include: { show: { select: { slug: true } } },
  });

  const review = await ctx.prisma.speakerMap.findMany({
    where: { needsReview: true },
    include: { episode: { include: { show: { select: { slug: true } } } } },
    orderBy: [{ episodeId: 'asc' }, { label: 'asc' }],
  });

  return {
    countsByStatus,
    recentRuns: runs.map((r) => ({
      id: r.id,
      command: r.command,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      dryRun: r.dryRun,
      discovered: r.discovered,
      imported: r.imported,
      transcribed: r.transcribed,
      named: r.named,
      exported: r.exported,
      failed: r.failed,
      skipped: r.skipped,
      minutesUsed: r.minutesUsed,
      estCostUsd: r.estCostUsd,
    })),
    failures: failed.map((e) => ({
      episodeId: e.id,
      showSlug: e.show.slug,
      title: e.title,
      errorMessage: e.errorMessage ?? '(no message recorded)',
    })),
    needsReview: review.map((s) => ({
      episodeId: s.episodeId,
      showSlug: s.episode.show.slug,
      title: s.episode.title,
      label: s.label,
      name: s.name,
    })),
  };
}

export function renderStatus(report: StatusReport): string {
  const lines: string[] = [];

  lines.push('EPISODES BY STATUS');
  const statuses = Object.entries(report.countsByStatus).filter(([, n]) => n > 0);
  if (statuses.length === 0) {
    lines.push('  (no episodes yet — run "radar poll")');
  } else {
    for (const [name, count] of statuses) lines.push(`  ${name.padEnd(12)} ${count}`);
  }

  lines.push('', `LAST ${RECENT_RUN_LIMIT} RUNS`);
  if (report.recentRuns.length === 0) {
    lines.push('  (none)');
  } else {
    for (const r of report.recentRuns) {
      const when = r.startedAt.replace('T', ' ').slice(0, 16);
      const tag = r.dryRun ? ' [dry-run]' : '';
      lines.push(
        `  ${when}${tag} ${r.command}`,
        `    discovered ${r.discovered} · imported ${r.imported} · transcribed ${r.transcribed} · ` +
          `named ${r.named} · exported ${r.exported} · failed ${r.failed} · skipped ${r.skipped}`,
        `    ${formatTimecode(r.minutesUsed * 60_000)} of audio · $${r.estCostUsd.toFixed(4)} estimated` +
          `${r.finishedAt ? '' : ' · DID NOT FINISH'}`,
      );
    }
  }

  lines.push('', 'FAILED EPISODES');
  if (report.failures.length === 0) {
    lines.push('  (none)');
  } else {
    for (const f of report.failures) {
      lines.push(`  ${f.showSlug} — ${f.title}`, `    ${f.errorMessage}`, `    ${f.episodeId}`);
    }
    lines.push('  Retry with: radar retry --all-failed');
  }

  lines.push('', 'SPEAKERS NEEDING REVIEW');
  if (report.needsReview.length === 0) {
    lines.push('  (none)');
  } else {
    for (const s of report.needsReview) {
      lines.push(`  ${s.showSlug} — ${s.title}`, `    ${s.label} = ${s.name}`);
      lines.push(`    Fix with: radar speakers set ${s.episodeId} ${s.label} "Real Name"`);
    }
  }

  return lines.join('\n');
}
