import type { ParsedFeed } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export interface FeedClient {
  fetchFeed(url: string): Promise<ParsedFeed>;
}

/** Parses a feed document that has already been retrieved. Pure; no network. */
export function parseFeedXml(_xml: string): Promise<ParsedFeed> {
  return notImplemented('parseFeedXml');
}

/**
 * Preference order for `podcast:transcript` types: JSON, then VTT, then SRT.
 * Document order is ignored. Returns null when nothing usable is offered.
 */
export function pickTranscript(
  _transcripts: Array<{ url: string; type: string }>,
): { url: string; type: string } | null {
  return notImplemented('pickTranscript');
}

export function createRssFeedClient(_opts?: { userAgent?: string }): FeedClient {
  return notImplemented('createRssFeedClient');
}
