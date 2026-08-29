import { notImplemented } from './notImplemented.js';

/**
 * Filename-safe slug: lowercased, non-alphanumerics collapsed to a single
 * hyphen, trimmed of leading/trailing hyphens, capped at `maxLength`
 * (default 60) without splitting mid-word where avoidable.
 */
export function slugify(_input: string, _maxLength?: number): string {
  return notImplemented('slugify');
}
