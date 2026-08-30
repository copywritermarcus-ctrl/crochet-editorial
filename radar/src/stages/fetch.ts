import path from 'node:path';
import type { AudioClient } from '../clients/audioClient.js';
import type { RadarContext } from '../types.js';

export interface FetchOptions {
  episodeId?: string;
  allPending?: boolean;
  dryRun?: boolean;
}

export interface FetchResult {
  fetched: number;
  failed: number;
  /** Episodes left for `import` because they carry a usable provided transcript. */
  deferredToImport: string[];
}

/**
 * Downloads audio for `discovered` (and cap-`skipped`) episodes to
 * data/audio/<episodeId>.<ext>. An episode with a provided transcript that
 * import has not already refused is skipped here and left to `import`.
 */
export async function fetchAudio(
  ctx: RadarContext,
  deps: { audioClient: AudioClient },
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const episodes = await ctx.prisma.episode.findMany({
    where: opts.episodeId
      ? { id: opts.episodeId }
      : { status: { in: ['discovered', 'skipped'] } },
    orderBy: { publishedAt: 'desc' },
  });

  const result: FetchResult = { fetched: 0, failed: 0, deferredToImport: [] };

  for (const episode of episodes) {
    if (!['discovered', 'skipped'].includes(episode.status)) continue;

    // A provided transcript that import has not yet refused is cheaper and
    // better than transcribing; leave it for the import stage.
    if (episode.providedTranscriptUrl && !episode.providedTranscriptRefusedReason) {
      result.deferredToImport.push(episode.id);
      continue;
    }

    if (opts.dryRun) {
      result.fetched += 1;
      continue;
    }

    try {
      const dest = path.join(ctx.dataDir, 'audio', episode.id);
      const download = await deps.audioClient.download(episode.audioUrl, dest);
      await ctx.prisma.episode.update({
        where: { id: episode.id },
        data: { audioPath: download.path, status: 'fetched', errorMessage: null },
      });
      result.fetched += 1;
      ctx.logger.info('fetch.downloaded', {
        episodeId: episode.id,
        bytes: download.bytes,
        finalUrl: download.finalUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'failed', errorMessage: message },
      });
      result.failed += 1;
      ctx.logger.error('fetch.failed', { episodeId: episode.id, message });
    }
  }

  return result;
}
