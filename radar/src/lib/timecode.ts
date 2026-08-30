/**
 * Normalise an `itunes:duration` value to whole seconds.
 * Accepts `HH:MM:SS`, `MM:SS` and bare seconds. Returns null for absent,
 * blank or unparseable input.
 */
export function parseItunesDuration(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  const numbers: number[] = [];
  for (const part of parts) {
    // Reject anything that is not a run of digits, so "1e3" and "not a
    // duration" fall through to null rather than becoming a number.
    if (!/^\d+$/.test(part.trim())) return null;
    numbers.push(Number(part.trim()));
  }

  if (numbers.length === 1) return numbers[0]!;
  if (numbers.length === 2) return numbers[0]! * 60 + numbers[1]!;
  return numbers[0]! * 3600 + numbers[1]! * 60 + numbers[2]!;
}

/** `mm:ss` under one hour, `h:mm:ss` at or over. Truncates, never rounds up. */
export function formatTimecode(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
