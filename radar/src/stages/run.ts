import type { AudioClient } from '../clients/audioClient.js';
import type { FeedClient } from '../clients/feedClient.js';
import type { HttpClient } from '../clients/httpClient.js';
import type { Namer } from '../clients/namer.js';
import type { Transcriber } from '../clients/transcriber.js';
import { DEFAULT_RATE_PER_HOUR } from '../lib/cost.js';
import type { RadarContext, RunCounts } from '../types.js';
import { exportEpisodes } from './export.js';
import { fetchAudio } from './fetch.js';
import { importTranscript } from './importTranscript.js';
import { nameSpeakers } from './nameSpeakers.js';
import { poll } from './poll.js';
import { transcribe } from './transcribe.js';

export interface RunDeps {
  feedClient: FeedClient;
  audioClient: AudioClient;
  http: HttpClient;
  transcriber: Transcriber;
  namer: Namer;
}

export interface RunOptions {
  sinceDays?: number;
  maxMinutes: number;
  ratePerHour?: number;
  dryRun?: boolean;
  showSlug?: string;
}

export interface RunSummary {
  runLogId: string;
  counts: RunCounts;
  needsReview: Array<{ episodeId: string; title: string; label: string }>;
  failures: Array<{ episodeId: string; title: string; errorMessage: string }>;
  /** Non-zero when any stage failed. */
  exitCode: number;
}

/**
 * poll -> (import | fetch + transcribe) -> name -> export, one RunLog row.
 *
 * Import runs before fetch so a feed-provided transcript is used in preference
 * to paying for transcription. An import that refuses (no speaker information)
 * records the reason, which lets the fetch stage — running immediately after,
 * in the same run — pick the episode up rather than waiting a week.
 */
export async function run(
  ctx: RadarContext,
  deps: RunDeps,
  opts: RunOptions,
): Promise<RunSummary> {
  const dryRun = opts.dryRun ?? false;
  const ratePerHour = opts.ratePerHour ?? DEFAULT_RATE_PER_HOUR;
  const command = [
    'run',
    `--since ${opts.sinceDays ?? 7}`,
    `--max-minutes ${opts.maxMinutes}`,
    opts.showSlug ? `--show ${opts.showSlug}` : null,
    dryRun ? '--dry-run' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const runLog = await ctx.prisma.runLog.create({
    data: { command, dryRun, startedAt: ctx.now() },
    select: { id: true },
  });

  const counts: RunCounts = {
    discovered: 0,
    imported: 0,
    transcribed: 0,
    named: 0,
    exported: 0,
    failed: 0,
    skipped: 0,
    minutesUsed: 0,
    estCostUsd: 0,
  };

  const pollResult = await poll(ctx, { feedClient: deps.feedClient }, {
    sinceDays: opts.sinceDays,
    showSlug: opts.showSlug,
    dryRun,
  });
  counts.discovered = pollResult.discovered;
  for (const warning of pollResult.warnings) ctx.logger.warn('run.poll_warning', { warning });

  const importResult = await importTranscript(ctx, { http: deps.http }, { allPending: true, dryRun });
  counts.imported = importResult.imported;
  counts.failed += importResult.failed;

  // Runs after import, so an episode whose provided transcript was just
  // refused is downloaded in this run rather than the next one.
  const fetchResult = await fetchAudio(ctx, { audioClient: deps.audioClient }, { allPending: true, dryRun });
  counts.failed += fetchResult.failed;

  const transcribeResult = await transcribe(ctx, { transcriber: deps.transcriber }, {
    allPending: true,
    maxMinutes: opts.maxMinutes,
    ratePerHour,
    dryRun,
  });
  counts.transcribed = transcribeResult.transcribed;
  counts.failed += transcribeResult.failed;
  counts.skipped = transcribeResult.skipped.length;
  counts.minutesUsed = transcribeResult.minutesUsed;
  counts.estCostUsd = transcribeResult.estCostUsd;

  const nameResult = await nameSpeakers(ctx, { namer: deps.namer }, { allPending: true, dryRun });
  counts.named = nameResult.named;
  counts.failed += nameResult.failed;

  const exportResult = await exportEpisodes(ctx, { allNamed: true, dryRun });
  counts.exported = exportResult.exported;
  counts.failed += exportResult.failed;

  const failedEpisodes = dryRun
    ? []
    : await ctx.prisma.episode.findMany({
        where: { status: 'failed' },
        select: { id: true, title: true, errorMessage: true },
        orderBy: { publishedAt: 'desc' },
      });

  const reviewRows = dryRun
    ? []
    : await ctx.prisma.speakerMap.findMany({
        where: { needsReview: true },
        include: { episode: { select: { title: true } } },
        orderBy: [{ episodeId: 'asc' }, { label: 'asc' }],
      });

  await ctx.prisma.runLog.update({
    where: { id: runLog.id },
    data: {
      finishedAt: new Date(),
      discovered: counts.discovered,
      imported: counts.imported,
      transcribed: counts.transcribed,
      named: counts.named,
      exported: counts.exported,
      failed: counts.failed,
      skipped: counts.skipped,
      minutesUsed: counts.minutesUsed,
      estCostUsd: counts.estCostUsd,
      notes: pollResult.warnings.length ? pollResult.warnings.join('; ') : null,
    },
  });

  return {
    runLogId: runLog.id,
    counts,
    needsReview: reviewRows.map((r) => ({
      episodeId: r.episodeId,
      title: r.episode.title,
      label: r.label,
    })),
    failures: failedEpisodes.map((e) => ({
      episodeId: e.id,
      title: e.title,
      errorMessage: e.errorMessage ?? '(no message recorded)',
    })),
    exitCode: counts.failed > 0 ? 1 : 0,
  };
}

/** One-screen summary, printed at the end of a run. */
export function renderRunSummary(summary: RunSummary, dryRun: boolean): string {
  const c = summary.counts;
  const lines = [
    dryRun ? 'RADAR RUN (dry run — nothing was written)' : 'RADAR RUN',
    `  discovered ${c.discovered} · imported ${c.imported} · transcribed ${c.transcribed}`,
    `  named ${c.named} · exported ${c.exported} · failed ${c.failed} · skipped ${c.skipped}`,
    `  ${c.minutesUsed.toFixed(1)} minutes of audio · $${c.estCostUsd.toFixed(4)} estimated`,
  ];

  if (summary.needsReview.length) {
    lines.push('', 'SPEAKERS NEEDING REVIEW');
    for (const r of summary.needsReview) {
      lines.push(`  ${r.title} — label ${r.label}`);
      lines.push(`    radar speakers set ${r.episodeId} ${r.label} "Real Name"`);
    }
  }

  if (summary.failures.length) {
    lines.push('', 'FAILURES');
    for (const f of summary.failures) lines.push(`  ${f.title}: ${f.errorMessage}`);
    lines.push('  Retry with: radar retry --all-failed');
  }

  return lines.join('\n');
}
