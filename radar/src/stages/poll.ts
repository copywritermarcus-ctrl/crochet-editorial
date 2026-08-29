import type { FeedClient } from '../clients/feedClient.js';
import type { RadarContext } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

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

/**
 * Upserts an Episode per feed item newer than the window, keyed on
 * (showId, guid). Existing rows are left untouched, so a re-poll is a no-op.
 * Honours Show.maxEpisodesPerRun, newest first.
 */
export function poll(
  _ctx: RadarContext,
  _deps: { feedClient: FeedClient },
  _opts?: PollOptions,
): Promise<PollResult> {
  return notImplemented('poll');
}
