import { notImplemented } from './notImplemented.js';

export const DEFAULT_RATE_PER_HOUR = 0.17;

/** USD estimate for a given audio duration. Null duration yields 0. */
export function estimateCost(_durationSec: number | null, _ratePerHour: number): number {
  return notImplemented('estimateCost');
}
