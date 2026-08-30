import type { FeedClient, } from '../clients/feedClient.js';
import { pickTranscript } from '../clients/feedClient.js';
import type { RadarContext } from '../types.js';

export interface PollOptions {
  sinceDays?: number;
  showSlug?: string;
  includeInactive?: boolean;
  dryRun?: boolean;
}

export interface PollResult {
  discovered: number;
  /** Episode ids created this run. Empty on a dry run. */
  episodeIds: string[];
  perShow: Array<{ slug: string; considered: number; discovered: number; skippedByCap: number }>;
  warnings: string[];
}

export const DEFAULT_SINCE_DAYS = 7;

/**
 * Upserts an Episode per feed item newer than the window, keyed on
 * (showId, guid). Existing rows are left untouched, so a re-poll is a no-op
 * and an episode already part-way through the pipeline is never reset.
 */
export async function poll(
  ctx: RadarContext,
  deps: { feedClient: FeedClient },
  opts: PollOptions = {},
): Promise<PollResult> {
  const sinceDays = opts.sinceDays ?? DEFAULT_SINCE_DAYS;
  const cutoff = new Date(ctx.now().getTime() - sinceDays * 24 * 60 * 60 * 1000);

  const shows = await ctx.prisma.show.findMany({
    where: {
      ...(opts.showSlug ? { slug: opts.showSlug } : {}),
      ...(opts.includeInactive ? {} : { active: true }),
    },
    orderBy: { slug: 'asc' },
  });

  const result: PollResult = { discovered: 0, episodeIds: [], perShow: [], warnings: [] };

  for (const show of shows) {
    if (!show.feedUrl) {
      const warning = `${show.slug}: no feedUrl. Run "radar roster sync" first.`;
      result.warnings.push(warning);
      ctx.logger.warn('poll.no_feed_url', { slug: show.slug });
      continue;
    }

    let items;
    try {
      items = (await deps.feedClient.fetchFeed(show.feedUrl)).items;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.warnings.push(`${show.slug}: feed fetch failed: ${reason}`);
      ctx.logger.warn('poll.feed_failed', { slug: show.slug, reason });
      continue;
    }

    // Newest first, so maxEpisodesPerRun keeps the most recent episodes.
    const inWindow = items
      .filter((item) => item.publishedAt >= cutoff && item.audioUrl !== null)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    let discoveredForShow = 0;
    let consideredForShow = 0;

    for (const item of inWindow) {
      // The cap counts episodes newly discovered this run, so a show whose
      // backlog exceeds the cap drains a few episodes per run rather than
      // stalling on the same ones.
      if (discoveredForShow >= show.maxEpisodesPerRun) break;
      consideredForShow += 1;

      const existing = await ctx.prisma.episode.findUnique({
        where: { showId_guid: { showId: show.id, guid: item.guid } },
        select: { id: true },
      });
      if (existing) continue;

      discoveredForShow += 1;
      result.discovered += 1;

      if (opts.dryRun) continue;

      const transcript = pickTranscript(item.transcripts);
      const created = await ctx.prisma.episode.create({
        data: {
          showId: show.id,
          guid: item.guid,
          title: item.title,
          description: item.description,
          publishedAt: item.publishedAt,
          durationSec: item.durationSec,
          audioUrl: item.audioUrl!,
          pageUrl: item.pageUrl,
          providedTranscriptUrl: transcript?.url ?? null,
          providedTranscriptType: transcript?.type ?? null,
          status: 'discovered',
        },
        select: { id: true },
      });
      result.episodeIds.push(created.id);
      ctx.logger.info('poll.discovered', { slug: show.slug, guid: item.guid, title: item.title });
    }

    result.perShow.push({
      slug: show.slug,
      considered: consideredForShow,
      discovered: discoveredForShow,
      skippedByCap: Math.max(0, inWindow.length - consideredForShow),
    });
  }

  return result;
}
