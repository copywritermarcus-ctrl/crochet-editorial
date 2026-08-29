import type { EpisodeStatus, RadarContext } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

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
export function retry(_ctx: RadarContext, _opts?: RetryOptions): Promise<RetryResult> {
  return notImplemented('retry');
}
