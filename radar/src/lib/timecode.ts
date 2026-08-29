import { notImplemented } from './notImplemented.js';

/**
 * Normalise an `itunes:duration` value to whole seconds.
 * Accepts `HH:MM:SS`, `MM:SS` and bare seconds. Returns null for absent,
 * blank or unparseable input.
 */
export function parseItunesDuration(_raw: string | null | undefined): number | null {
  return notImplemented('parseItunesDuration');
}

/** `mm:ss` under one hour, `h:mm:ss` at or over. Truncates, never rounds up. */
export function formatTimecode(_ms: number): string {
  return notImplemented('formatTimecode');
}
