import type { HttpClient } from '../clients/httpClient.js';
import type { RadarContext, VendorUtterance } from '../types.js';

export interface ParsedProvidedTranscript {
  utterances: VendorUtterance[];
}

export const NO_SPEAKER_INFO = 'provided transcript carries no speaker information';

interface ProvidedSegment {
  speaker?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  body?: unknown;
}

function toMs(seconds: unknown): number {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

/**
 * Podcasting 2.0 JSON: segments carrying `speaker`, `startTime`, `endTime`,
 * `body`. Returns null when no segment carries speaker information — the
 * caller must then fall through to fetch + transcribe.
 */
export function parseProvidedJson(body: string): ParsedProvidedTranscript | null {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;

  const segments = (doc as { segments?: unknown }).segments;
  if (!Array.isArray(segments) || segments.length === 0) return null;

  const utterances: VendorUtterance[] = [];
  let anySpeaker = false;

  for (const raw of segments as ProvidedSegment[]) {
    const text = typeof raw.body === 'string' ? raw.body.trim() : '';
    if (text === '') continue;
    const speaker = typeof raw.speaker === 'string' ? raw.speaker.trim() : '';
    if (speaker !== '') anySpeaker = true;

    utterances.push({
      speaker,
      start: toMs(raw.startTime),
      end: toMs(raw.endTime),
      text,
      confidence: null,
    });
  }

  if (!anySpeaker || utterances.length === 0) return null;
  return { utterances };
}

/** `HH:MM:SS.mmm` or `MM:SS.mmm`, as used by both VTT and SRT (with a comma). */
function parseCueTime(raw: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(raw.trim());
  if (!match) return null;
  const [, h, m, s, frac] = match;
  return (
    Number(h ?? 0) * 3_600_000 +
    Number(m) * 60_000 +
    Number(s) * 1000 +
    Number(frac!.padEnd(3, '0'))
  );
}

/** VTT/SRT with `<v Name>` voice tags or `Name:` prefixes. Null when neither. */
export function parseProvidedVtt(body: string): ParsedProvidedTranscript | null {
  const normalised = body.replace(/\r\n/g, '\n');
  const blocks = normalised.split(/\n{2,}/);

  const utterances: VendorUtterance[] = [];
  let anySpeaker = false;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    if (lines.length === 0) continue;

    const arrowIndex = lines.findIndex((l) => l.includes('-->'));
    if (arrowIndex === -1) continue;

    const [startRaw, endRaw] = lines[arrowIndex]!.split('-->').map((p) => p.trim());
    const start = parseCueTime(startRaw ?? '');
    const end = parseCueTime((endRaw ?? '').split(/\s+/)[0] ?? '');
    if (start === null || end === null) continue;

    const payload = lines.slice(arrowIndex + 1).join(' ').trim();
    if (payload === '') continue;

    let speaker = '';
    let text = payload;

    const voiceTag = /^<v\s+([^>]+)>\s*(.*)$/s.exec(payload);
    if (voiceTag) {
      speaker = voiceTag[1]!.trim();
      text = voiceTag[2]!.replace(/<\/v>\s*$/, '').trim();
    } else {
      // "Name: text", but only when the prefix looks like a name rather than a
      // sentence that happens to contain a colon.
      const prefixed = /^([^:]{1,60}):\s+(.*)$/s.exec(payload);
      if (prefixed && !/[.!?]/.test(prefixed[1]!)) {
        speaker = prefixed[1]!.trim();
        text = prefixed[2]!.trim();
      }
    }

    if (speaker !== '') anySpeaker = true;
    utterances.push({ speaker, start, end, text, confidence: null });
  }

  if (!anySpeaker || utterances.length === 0) return null;
  return { utterances };
}

export function parseProvidedTranscript(
  body: string,
  mimeType: string | null,
): ParsedProvidedTranscript | null {
  const type = mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (type === 'application/json') return parseProvidedJson(body);
  if (type === 'text/vtt' || type === 'application/x-subrip') return parseProvidedVtt(body);

  // Unknown or wrong mime type: sniff rather than refuse. Feeds mislabel.
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseProvidedJson(body) ?? parseProvidedVtt(body);
  }
  return parseProvidedVtt(body) ?? parseProvidedJson(body);
}

export interface ImportOptions {
  episodeId?: string;
  allPending?: boolean;
  dryRun?: boolean;
}

export interface ImportResult {
  imported: number;
  failed: number;
  /** Episodes whose transcript carried no speaker info; now eligible for fetch. */
  refused: Array<{ episodeId: string; reason: string }>;
}

/**
 * On success: utterances persisted, source `provided`, estCostUsd 0, status
 * `transcribed`. On refusal: the reason is persisted so a retry does not
 * re-attempt a known-bad import, and the episode stays `discovered` for fetch.
 */
export async function importTranscript(
  ctx: RadarContext,
  deps: { http: HttpClient },
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const episodes = await ctx.prisma.episode.findMany({
    where: opts.episodeId ? { id: opts.episodeId } : { status: { in: ['discovered', 'skipped'] } },
    orderBy: { publishedAt: 'desc' },
  });

  const result: ImportResult = { imported: 0, failed: 0, refused: [] };

  for (const episode of episodes) {
    if (!episode.providedTranscriptUrl) continue;
    if (episode.providedTranscriptRefusedReason) continue;
    if (!['discovered', 'skipped'].includes(episode.status)) continue;
    if (opts.dryRun) {
      result.imported += 1;
      continue;
    }

    let parsed: ParsedProvidedTranscript | null;
    try {
      const { body, contentType } = await deps.http.getText(episode.providedTranscriptUrl);
      parsed = parseProvidedTranscript(body, episode.providedTranscriptType ?? contentType);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'failed', errorMessage: message },
      });
      result.failed += 1;
      ctx.logger.error('import.failed', { episodeId: episode.id, message });
      continue;
    }

    if (!parsed) {
      await ctx.prisma.episode.update({
        where: { id: episode.id },
        data: { providedTranscriptRefusedReason: NO_SPEAKER_INFO },
      });
      result.refused.push({ episodeId: episode.id, reason: NO_SPEAKER_INFO });
      ctx.logger.warn('import.refused', { episodeId: episode.id, reason: NO_SPEAKER_INFO });
      continue;
    }

    // Replace rather than append, so a re-import is idempotent.
    await ctx.prisma.utterance.deleteMany({ where: { episodeId: episode.id } });
    await ctx.prisma.utterance.createMany({
      data: parsed.utterances.map((u, idx) => ({
        episodeId: episode.id,
        idx,
        speakerLabel: u.speaker,
        startMs: u.start,
        endMs: u.end,
        text: u.text,
        confidence: u.confidence,
      })),
    });
    await ctx.prisma.episode.update({
      where: { id: episode.id },
      data: { status: 'transcribed', source: 'provided', estCostUsd: 0, errorMessage: null },
    });

    result.imported += 1;
    ctx.logger.info('import.imported', {
      episodeId: episode.id,
      utterances: parsed.utterances.length,
    });
  }

  return result;
}
