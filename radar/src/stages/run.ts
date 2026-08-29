import type { AudioClient } from '../clients/audioClient.js';
import type { FeedClient } from '../clients/feedClient.js';
import type { HttpClient } from '../clients/httpClient.js';
import type { Namer } from '../clients/namer.js';
import type { Transcriber } from '../clients/transcriber.js';
import type { RadarContext, RunCounts } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export interface RunDeps {
  feedClient: FeedClient;
  audioClient: AudioClient;
  http: HttpClient;
  transcriber: Transcriber;
  namer: Namer;
}

export interface RunOptions {
  sinceDays?: number;
  maxMinutes: number;
  ratePerHour?: number;
  dryRun?: boolean;
  showSlug?: string;
}

export interface RunSummary {
  runLogId: string;
  counts: RunCounts;
  needsReview: Array<{ episodeId: string; title: string; label: string }>;
  failures: Array<{ episodeId: string; title: string; errorMessage: string }>;
  exitCode: number;
}

/**
 * poll -> (import | fetch + transcribe) -> name -> export, one RunLog row.
 * Import is attempted first where a provided transcript exists; a refusal
 * falls through to fetch + transcribe within the same run.
 * exitCode is non-zero when any stage failed.
 */
export function run(
  _ctx: RadarContext,
  _deps: RunDeps,
  _opts: RunOptions,
): Promise<RunSummary> {
  return notImplemented('run');
}
