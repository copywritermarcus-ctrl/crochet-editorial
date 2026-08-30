import type { EpisodeStatus, RadarContext } from '../types.js';

export interface RetryOptions {
  episodeId?: string;
  allFailed?: boolean;
  dryRun?: boolean;
}

export interface RetryResult {
  reset: Array<{ episodeId: string; from: EpisodeStatus; to: EpisodeStatus }>;
}

/**
 * Infers the last good status from persisted state: utterances present means
 * `transcribed`; an audioPath means `fetched`; otherwise `discovered`.
 * Clears errorMessage so the next run picks the episode up.
 */
export async function retry(ctx: RadarContext, opts: RetryOptions = {}): Promise<RetryResult> {
  const episodes = await ctx.prisma.episode.findMany({
    where: opts.episodeId ? { id: opts.episodeId } : { status: 'failed' },
    orderBy: { publishedAt: 'desc' },
    include: { _count: { select: { utterances: true } } },
  });

  const result: RetryResult = { reset: [] };

  for (const episode of episodes) {
    if (episode.status !== 'failed') continue;

    const to: EpisodeStatus =
      episode._count.utterances > 0 ? 'transcribed' : episode.audioPath ? 'fetched' : 'discovered';

    result.reset.push({ episodeId: episode.id, from: 'failed', to });
    if (opts.dryRun) continue;

    await ctx.prisma.episode.update({
      where: { id: episode.id },
      data: { status: to, errorMessage: null },
    });
    ctx.logger.info('retry.reset', { episodeId: episode.id, to });
  }

  return result;
}
