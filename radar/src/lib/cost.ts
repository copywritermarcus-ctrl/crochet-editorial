export const DEFAULT_RATE_PER_HOUR = 0.17;

/** USD estimate for a given audio duration. Null duration yields 0. */
export function estimateCost(durationSec: number | null, ratePerHour: number): number {
  if (!durationSec || durationSec <= 0) return 0;
  return (durationSec / 3600) * ratePerHour;
}
