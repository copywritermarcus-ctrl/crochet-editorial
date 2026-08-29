import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '../lib/slug.js';
import { formatTimecode } from '../lib/timecode.js';
import type {
  ExportBundle,
  ExportTurn,
  RadarContext,
  SpeakerMapEntry,
  SpeakerConfidence,
  SpeakerRole,
  TranscriptSource,
} from '../types.js';

export type ExportFormat = 'md' | 'json' | 'both';

/** Merges consecutive utterances from the same speaker; timestamp is the first. */
export function mergeTurns(
  utterances: Array<{ speakerLabel: string; startMs: number; endMs: number; text: string }>,
  names: Map<string, string>,
): ExportTurn[] {
  const turns: ExportTurn[] = [];

  for (const u of utterances) {
    const previous = turns[turns.length - 1];
    if (previous && previous.label === u.speakerLabel) {
      previous.text = `${previous.text} ${u.text}`;
      previous.endMs = u.endMs;
      continue;
    }
    turns.push({
      label: u.speakerLabel,
      name: names.get(u.speakerLabel) ?? `Unknown speaker ${u.speakerLabel}`,
      startMs: u.startMs,
      endMs: u.endMs,
      text: u.text,
    });
  }

  return turns;
}

/**
 * The brief's §5.7 layout, with blank lines added before and after the `---`
 * rule and between turns. Without the blank line before it, `---` turns the
 * preceding "Review flags:" line into a setext H2 heading. See
 * fixtures/README.md for the full note on this deviation.
 */
export function renderMarkdown(bundle: ExportBundle): string {
  const published = bundle.episode.publishedAt.slice(0, 10);
  const duration = bundle.episode.durationSec === null
    ? 'unknown'
    : formatTimecode(bundle.episode.durationSec * 1000);
  const speakers = bundle.speakers
    .map((s) => `${s.label} = ${s.name} (${s.role})`)
    .join(', ');

  const header = [
    `# ${bundle.episode.showName} — ${bundle.episode.title}`,
    `Published: ${published} · Duration: ${duration} · Source: ${bundle.episode.source ?? 'unknown'}`,
    `URL: ${bundle.episode.url}`,
    `Speakers: ${speakers}`,
    `Review flags: ${bundle.reviewFlags.length ? bundle.reviewFlags.join(', ') : 'none'}`,
    '',
    '---',
    '',
  ].join('\n');

  const body = bundle.turns
    .map((t) => `[${formatTimecode(t.startMs)}] ${t.name}: ${t.text}`)
    .join('\n\n');

  return `${header}\n${body}\n`;
}

export function renderJson(bundle: ExportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export interface ExportOptions {
  episodeId?: string;
  allNamed?: boolean;
  format?: ExportFormat;
  dryRun?: boolean;
}

export interface ExportResult {
  exported: number;
  failed: number;
  files: string[];
}

/** Builds the export bundle for one episode, or null when it has no utterances. */
export async function buildExportBundle(
  ctx: RadarContext,
  episodeId: string,
): Promise<ExportBundle | null> {
  const episode = await ctx.prisma.episode.findUnique({
    where: { id: episodeId },
    include: { show: true, speakerMap: { orderBy: { label: 'asc' } } },
  });
  if (!episode) return null;

  const utterances = await ctx.prisma.utterance.findMany({
    where: { episodeId },
    orderBy: { idx: 'asc' },
    select: { speakerLabel: true, startMs: true, endMs: true, text: true },
  });
  if (utterances.length === 0) return null;

  const speakers: SpeakerMapEntry[] = episode.speakerMap.map((s) => ({
    label: s.label,
    name: s.name,
    role: s.role as SpeakerRole,
    confidence: s.confidence as SpeakerConfidence,
  }));
  const names = new Map(speakers.map((s) => [s.label, s.name]));

  return {
    episode: {
      id: episode.id,
      showSlug: episode.show.slug,
      showName: episode.show.name,
      title: episode.title,
      publishedAt: episode.publishedAt.toISOString(),
      durationSec: episode.durationSec,
      source: (episode.source as TranscriptSource | null) ?? null,
      url: episode.pageUrl ?? episode.audioUrl,
    },
    speakers,
    reviewFlags: episode.speakerMap.filter((s) => s.needsReview).map((s) => s.label),
    turns: mergeTurns(utterances, names),
  };
}

/** Writes data/exports/<show-slug>/<yyyy-mm-dd>-<episode-slug>.{md,json}. */
export async function exportEpisodes(
  ctx: RadarContext,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const format = opts.format ?? 'both';
  const episodes = await ctx.prisma.episode.findMany({
    where: opts.episodeId ? { id: opts.episodeId } : { status: 'named' },
    orderBy: { publishedAt: 'desc' },
    select: { id: true },
  });

  const result: ExportResult = { exported: 0, failed: 0, files: [] };

  for (const { id } of episodes) {
    const bundle = await buildExportBundle(ctx, id);
    if (!bundle) continue;

    if (opts.dryRun) {
      result.exported += 1;
      continue;
    }

    try {
      const dir = path.join(ctx.dataDir, 'exports', bundle.episode.showSlug);
      fs.mkdirSync(dir, { recursive: true });
      const stem = `${bundle.episode.publishedAt.slice(0, 10)}-${slugify(bundle.episode.title)}`;

      if (format === 'md' || format === 'both') {
        const file = path.join(dir, `${stem}.md`);
        fs.writeFileSync(file, renderMarkdown(bundle), 'utf8');
        result.files.push(file);
      }
      if (format === 'json' || format === 'both') {
        const file = path.join(dir, `${stem}.json`);
        fs.writeFileSync(file, renderJson(bundle), 'utf8');
        result.files.push(file);
      }

      await ctx.prisma.episode.update({ where: { id }, data: { status: 'exported' } });
      result.exported += 1;
      ctx.logger.info('export.written', { episodeId: id, stem, format });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      ctx.logger.error('export.failed', { episodeId: id, message });
    }
  }

  return result;
}
