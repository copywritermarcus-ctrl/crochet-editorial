import type { Namer } from '../clients/namer.js';
import { isSpeakerConfidence, isSpeakerRole } from '../lib/status.js';
import type { NamingRequest, NamingUtterance, RadarContext, SpeakerMapResult } from '../types.js';

export const NAMING_HEAD_UTTERANCES = 40;
export const NAMING_TAIL_UTTERANCES = 10;
export const NAMING_DESCRIPTION_LIMIT = 1500;

/**
 * Builds the request exactly as frozen in fixtures/naming/input.fixture.json.
 *
 * `head` is the first 40 utterances and `tail` the last 10, but the tail
 * excludes anything already present in the head — so a short episode never
 * sends the model the same utterance twice, and on a 12-utterance episode the
 * tail is empty rather than a duplicate of the end of the head.
 */
export function buildNamingRequest(input: {
  showName: string;
  hosts: string[];
  title: string;
  description: string | null;
  utterances: Array<{ speakerLabel: string; text: string }>;
}): NamingRequest {
  const toNaming = (u: { speakerLabel: string; text: string }): NamingUtterance => ({
    label: u.speakerLabel,
    text: u.text,
  });

  const head = input.utterances.slice(0, NAMING_HEAD_UTTERANCES).map(toNaming);
  const tailStart = Math.max(NAMING_HEAD_UTTERANCES, input.utterances.length - NAMING_TAIL_UTTERANCES);
  const tail = input.utterances.slice(tailStart).map(toNaming);

  return {
    show: { name: input.showName, hosts: input.hosts },
    episode: {
      title: input.title,
      description: (input.description ?? '').slice(0, NAMING_DESCRIPTION_LIMIT),
    },
    utterances: { head, tail },
  };
}

export function buildNamingPrompt(request: NamingRequest, validationError?: string): string {
  const hosts = request.show.hosts.length
    ? request.show.hosts.map((h) => `- ${h}`).join('\n')
    : '- (none recorded)';

  const renderTurns = (turns: NamingUtterance[]): string =>
    turns.length ? turns.map((u) => `${u.label}: ${u.text}`).join('\n') : '(none)';

  const labels = [...new Set([...request.utterances.head, ...request.utterances.tail].map((u) => u.label))].sort();

  const base = `You are labelling the speakers in a podcast transcript.

Show: ${request.show.name}
Known hosts of this show:
${hosts}

Episode title: ${request.episode.title}
Episode description: ${request.episode.description || '(none)'}

Diarisation produced these anonymous speaker labels: ${labels.join(', ')}

Opening of the transcript:
${renderTurns(request.utterances.head)}

End of the transcript:
${renderTurns(request.utterances.tail)}

Rules:
- Map every label listed above, and no others.
- A host's name must be taken from the known hosts list when that list is not empty.
- A guest's name should come from the episode title or description.
- If you cannot resolve a label, use name "Unknown speaker <label>", role "unknown", confidence "low".
- role must be exactly one of: host, guest, unknown.
- confidence must be exactly one of: high, medium, low.

Reply with only JSON, no prose, no code fence, in exactly this shape:
{"speakers":[{"label":"A","name":"Full Name","role":"host","confidence":"high"}]}`;

  if (!validationError) return base;
  return `${base}

Your previous reply was rejected: ${validationError}
Reply again with only the JSON object described above.`;
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Models fence JSON even when told not to; tolerate it rather than burn a retry.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  if (candidate.startsWith('{')) return candidate;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) return candidate.slice(start, end + 1);
  return candidate;
}

/** Strict parse and validate. Throws with a readable reason used by the retry. */
export function parseSpeakerMapResponse(raw: string, expectedLabels: string[]): SpeakerMapResult {
  let doc: unknown;
  try {
    doc = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(`reply was not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('reply must be a JSON object with a "speakers" array');
  }
  const speakers = (doc as { speakers?: unknown }).speakers;
  if (!Array.isArray(speakers)) throw new Error('reply is missing the "speakers" array');

  const seen = new Set<string>();
  const parsed = speakers.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`speakers[${index}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.label !== 'string' || e.label === '') throw new Error(`speakers[${index}] has no "label"`);
    if (typeof e.name !== 'string' || e.name === '') throw new Error(`speaker "${e.label}" has no "name"`);
    if (!isSpeakerRole(e.role)) {
      throw new Error(`speaker "${e.label}" has invalid role "${String(e.role)}" (expected host, guest or unknown)`);
    }
    if (!isSpeakerConfidence(e.confidence)) {
      throw new Error(
        `speaker "${e.label}" has invalid confidence "${String(e.confidence)}" (expected high, medium or low)`,
      );
    }
    if (seen.has(e.label)) throw new Error(`label "${e.label}" appears more than once`);
    seen.add(e.label);
    if (!expectedLabels.includes(e.label)) {
      throw new Error(`label "${e.label}" is not one of the transcript labels (${expectedLabels.join(', ')})`);
    }
    return { label: e.label, name: e.name, role: e.role, confidence: e.confidence };
  });

  const missing = expectedLabels.filter((l) => !seen.has(l));
  if (missing.length > 0) throw new Error(`no mapping returned for label(s): ${missing.join(', ')}`);

  return { speakers: parsed };
}

/**
 * A diarisation label is the anonymous placeholder a speech model emits — "A",
 * "B", "Speaker C", "1". A feed-provided transcript instead labels its segments
 * with real names, which need no resolving.
 */
export function isDiarisationLabel(label: string): boolean {
  return /^(speaker\s*)?[A-Z]$/i.test(label.trim()) || /^\d+$/.test(label.trim());
}

export interface NameOptions {
  episodeId?: string;
  allPending?: boolean;
  dryRun?: boolean;
}

function manualLabelsFor(rows: Array<{ label: string }>): Set<string> {
  return new Set(rows.map((r) => r.label));
}

export interface NameResult {
  named: number;
  failed: number;
  needsReview: Array<{ episodeId: string; label: string }>;
}

/**
 * One call per episode; on malformed output, one retry with the validation
 * error appended; a second failure marks the episode `failed`. Rows with
 * `manual = true` are never overwritten.
 */
export async function nameSpeakers(
  ctx: RadarContext,
  deps: { namer: Namer },
  opts: NameOptions = {},
): Promise<NameResult> {
  const episodes = await ctx.prisma.episode.findMany({
    where: opts.episodeId ? { id: opts.episodeId } : { status: 'transcribed' },
    orderBy: { publishedAt: 'desc' },
    include: { show: true },
  });

  const result: NameResult = { named: 0, failed: 0, needsReview: [] };

  for (const episode of episodes) {
    if (episode.status !== 'transcribed') continue;
    if (opts.dryRun) {
      result.named += 1;
      continue;
    }

    const utterances = await ctx.prisma.utterance.findMany({
      where: { episodeId: episode.id },
      orderBy: { idx: 'asc' },
      select: { speakerLabel: true, text: true },
    });
    if (utterances.length === 0) continue;

    const hosts = JSON.parse(episode.show.hosts) as string[];
    const labels = [...new Set(utterances.map((u) => u.speakerLabel))].sort();

    // A feed-provided transcript already names its speakers. Asking the model
    // to map "April Dunford" onto a name spends money to invent a chance of
    // getting it wrong, so map those labels to themselves instead. Only the
    // anonymous diarisation labels a speech model emits need resolving.
    if (episode.source === 'provided' && labels.every((l) => !isDiarisationLabel(l))) {
      const hostSet = new Set(hosts.map((h) => h.toLowerCase()));
      for (const label of labels) {
        if (manualLabelsFor(await ctx.prisma.speakerMap.findMany({
          where: { episodeId: episode.id, manual: true },
          select: { label: true },
        })).has(label)) continue;

        const data = {
          name: label,
          role: hostSet.has(label.toLowerCase()) ? 'host' : 'guest',
          confidence: 'high',
          needsReview: false,
        };
        await ctx.prisma.speakerMap.upsert({
          where: { episodeId_label: { episodeId: episode.id, label } },
          create: { episodeId: episode.id, label, ...data },
          update: data,
        });
      }
      await ctx.prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'named', errorMessage: null },
      });
      result.named += 1;
      ctx.logger.info('name.self_mapped', { episodeId: episode.id, speakers: labels.length });
      continue;
    }

    const request = buildNamingRequest({
      showName: episode.show.name,
      hosts,
      title: episode.title,
      description: episode.description,
      utterances,
    });
    const expectedLabels = labels;

    let map: SpeakerMapResult | null = null;
    let lastError = '';

    // One call, then exactly one retry with the validation error appended.
    for (let attempt = 0; attempt < 2 && map === null; attempt += 1) {
      const prompt = buildNamingPrompt(request, attempt === 0 ? undefined : lastError);
      try {
        map = parseSpeakerMapResponse(await deps.namer.complete(prompt), expectedLabels);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        ctx.logger.warn('name.rejected', { episodeId: episode.id, attempt: attempt + 1, reason: lastError });
      }
    }

    if (!map) {
      await ctx.prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'failed', errorMessage: `speaker naming failed: ${lastError}` },
      });
      result.failed += 1;
      ctx.logger.error('name.failed', { episodeId: episode.id, reason: lastError });
      continue;
    }

    const manualLabels = manualLabelsFor(
      await ctx.prisma.speakerMap.findMany({
        where: { episodeId: episode.id, manual: true },
        select: { label: true },
      }),
    );

    for (const speaker of map.speakers) {
      // A human correction outranks the model, permanently.
      if (manualLabels.has(speaker.label)) continue;

      const needsReview = speaker.confidence === 'low';
      const data = {
        name: speaker.name,
        role: speaker.role,
        confidence: speaker.confidence,
        needsReview,
      };
      await ctx.prisma.speakerMap.upsert({
        where: { episodeId_label: { episodeId: episode.id, label: speaker.label } },
        create: { episodeId: episode.id, label: speaker.label, ...data },
        update: data,
      });
      if (needsReview) result.needsReview.push({ episodeId: episode.id, label: speaker.label });
    }

    await ctx.prisma.episode.update({
      where: { id: episode.id },
      data: { status: 'named', errorMessage: null },
    });
    result.named += 1;
    ctx.logger.info('name.named', { episodeId: episode.id, speakers: map.speakers.length });
  }

  return result;
}
