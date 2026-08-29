import type { HttpClient } from './clients/httpClient.js';
import type { RadarContext, Region } from './types.js';
import { notImplemented } from './lib/notImplemented.js';

export interface RosterShow {
  slug: string;
  name: string;
  searchTerm: string;
  feedUrl: string | null;
  hosts: string[];
  region: Region;
  lenses: string[];
  active: boolean;
  maxEpisodesPerRun: number;
  /**
   * Diarisation hint. Per-show configuration, not a formula: interview shows
   * are hosts + 1, no-guest panel shows are hosts. Null omits the hint.
   */
  speakersExpected: number | null;
}

export interface Roster {
  shows: RosterShow[];
}

export function parseRoster(_json: unknown): Roster {
  return notImplemented('parseRoster');
}

export function loadRoster(_filePath: string): Promise<Roster> {
  return notImplemented('loadRoster');
}

export function writeRoster(_filePath: string, _roster: Roster): Promise<void> {
  return notImplemented('writeRoster');
}

export interface RosterSyncResult {
  resolved: Array<{ slug: string; name: string; feedUrl: string }>;
  unresolved: Array<{ slug: string; name: string; reason: string }>;
  unchanged: Array<{ slug: string; feedUrl: string }>;
}

/**
 * Resolves missing feed URLs via Apple's podcast search, writes them back to
 * the roster file, and upserts Show rows. A non-null feedUrl is never
 * overwritten unless `force`.
 */
export function syncRoster(
  _ctx: RadarContext,
  _deps: { http: HttpClient; rosterPath: string },
  _opts?: { force?: boolean; dryRun?: boolean },
): Promise<RosterSyncResult> {
  return notImplemented('syncRoster');
}

export function appleSearchUrl(_searchTerm: string, _country?: string): string {
  return notImplemented('appleSearchUrl');
}
