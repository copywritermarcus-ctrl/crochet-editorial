import type { AudioClient } from '../clients/audioClient.js';
import type { RadarContext } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

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
 * data/audio/<episodeId>.<ext>. Redirects are followed; a realistic
 * User-Agent is sent. An episode with a provided transcript that import has
 * not already refused is skipped here and left to `import`.
 */
export function fetchAudio(
  _ctx: RadarContext,
  _deps: { audioClient: AudioClient },
  _opts?: FetchOptions,
): Promise<FetchResult> {
  return notImplemented('fetchAudio');
}
