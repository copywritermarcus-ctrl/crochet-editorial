import fs from 'node:fs';
import path from 'node:path';
import type { Transcriber } from '../clients/transcriber.js';
import { DEFAULT_RATE_PER_HOUR, estimateCost } from '../lib/cost.js';
import type { RadarContext } from '../types.js';

export interface TranscribeOptions {
  episodeId?: string;
  allPending?: boolean;
  /** Mandatory. `transcribe` refuses to run without a cap. */
  maxMinutes: number;
  ratePerHour?: number;
  dryRun?: boolean;
}

export interface TranscribeResult {
  transcribed: number;
  failed: number;
  /** Episodes deferred by the minute cap; picked up by the next run. */
  skipped: Array<{ episodeId: string; note: string }>;
  minutesUsed: number;
  estCostUsd: number;
}

/**
 * Transcribes `fetched` (and previously cap-`skipped`) episodes that have no
 * usable provided transcript. The cumulative minute cap is checked before each
 * episode using the feed's durationSec, which is known before any spend.
 */
export async function transcribe(
  ctx: RadarContext,
  deps: { transcriber: Transcriber },
  opts: TranscribeOptions,
): Promise<TranscribeResult> {
  const maxMinutes = opts?.maxMinutes;
  if (typeof maxMinutes !== 'number' || !Number.isFinite(maxMinutes) || maxMinutes <= 0) {
    throw new Error(
      'transcribe refuses to run without a spend cap: pass --max-minutes with a positive value.',
    );
  }
  const ratePerHour = opts.ratePerHour ?? DEFAULT_RATE_PER_HOUR;

  const episodes = await ctx.prisma.episode.findMany({
    where: opts.episodeId ? { id: opts.episodeId } : { status: { in: ['fetched', 'skipped'] } },
    orderBy: { publishedAt: 'desc' },
    include: { show: true },
  });

  const result: TranscribeResult = {
    transcribed: 0,
    failed: 0,
    skipped: [],
    minutesUsed: 0,
    estCostUsd: 0,
  };

  for (const episode of episodes) {
    if (!['fetched', 'skipped'].includes(episode.status)) continue;
    // A provided transcript already covers this episode; import owns it.
    if (episode.source === 'provided') continue;
    if (!episode.audioPath) continue;

    const durationMinutes = (episode.durationSec ?? 0) / 60;
    if (result.minutesUsed + durationMinutes > maxMinutes) {
      if (!opts.dryRun) {
        await ctx.prisma.episode.update({ where: { id: episode.id }, data: { status: 'skipped' } });
      }
      result.skipped.push({ episodeId: episode.id, note: 'cap' });
      ctx.logger.warn('transcribe.capped', {
        episodeId: episode.id,
        durationMinutes,
        maxMinutes,
        minutesUsed: result.minutesUsed,
      });
      continue;
    }

    if (opts.dryRun) {
      result.transcribed += 1;
      continue;
    }

    try {
      const vendor = await deps.transcriber.transcribe({
        audioPath: episode.audioPath,
        speakersExpected: episode.speakersExpected ?? episode.show.speakersExpected ?? null,
      });

      const rawDir = path.join(ctx.dataDir, 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      fs.writeFileSync(
        path.join(rawDir, `${episode.id}.assemblyai.json`),
        `${JSON.stringify(vendor.raw, null, 2)}\n`,
        'utf8',
      );

      // Bill on what the vendor actually processed; fall back to the feed.
      const billedSeconds = vendor.audioDurationSec ?? episode.durationSec ?? 0;
      const cost = estimateCost(billedSeconds, ratePerHour);

      await ctx.prisma.utterance.deleteMany({ where: { episodeId: episode.id } });
      await ctx.prisma.utterance.createMany({
        data: vendor.utterances.map((u, idx) => ({
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
        data: {
          status: 'transcribed',
          source: 'assemblyai',
          transcriptId: vendor.id,
          estCostUsd: cost,
          errorMessage: null,
        },
      });

      result.transcribed += 1;
      result.minutesUsed += billedSeconds / 60;
      result.estCostUsd += cost;
      ctx.logger.info('transcribe.completed', {
        episodeId: episode.id,
        transcriptId: vendor.id,
        utterances: vendor.utterances.length,
        estCostUsd: cost,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'failed', errorMessage: message },
      });
      result.failed += 1;
      ctx.logger.error('transcribe.failed', { episodeId: episode.id, message });
    }
  }

  return result;
}
