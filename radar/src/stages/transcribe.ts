import type { Transcriber } from '../clients/transcriber.js';
import type { RadarContext } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

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
 * episode using the feed's durationSec, which is known before the call is made.
 * The raw vendor payload is written to data/raw/<episodeId>.assemblyai.json.
 * Vendor errors mark the episode `failed`; nothing auto-retries inside a run.
 */
export function transcribe(
  _ctx: RadarContext,
  _deps: { transcriber: Transcriber },
  _opts: TranscribeOptions,
): Promise<TranscribeResult> {
  return notImplemented('transcribe');
}
