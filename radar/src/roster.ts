import fs from 'node:fs/promises';
import type { HttpClient } from './clients/httpClient.js';
import type { RadarContext, Region } from './types.js';

const REGIONS: readonly Region[] = ['UK', 'EU', 'US', 'OTHER'];

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
  /**
   * True where speakersExpected is an unverified guess at the show's format.
   * Phase 3 review uses this to know which values have earned no trust.
   */
  formatGuess?: boolean;
}

export interface Roster {
  shows: RosterShow[];
}

function fail(message: string): never {
  throw new Error(`roster.json: ${message}`);
}

function readStringArray(value: unknown, field: string, slug: string): string[] {
  if (!Array.isArray(value)) fail(`show "${slug}": ${field} must be an array of strings`);
  return value.map((v) => {
    if (typeof v !== 'string') fail(`show "${slug}": ${field} must contain only strings`);
    return v;
  });
}

export function parseRoster(json: unknown): Roster {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    fail('the roster must be an object with a "shows" array');
  }
  const shows = (json as { shows?: unknown }).shows;
  if (!Array.isArray(shows)) fail('missing required "shows" array');

  const seen = new Set<string>();
  const parsed: RosterShow[] = shows.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) fail(`show at index ${index} must be an object`);
    const s = raw as Record<string, unknown>;

    const slug = s.slug;
    if (typeof slug !== 'string' || slug === '') fail(`show at index ${index}: missing required "slug"`);
    if (seen.has(slug)) fail(`duplicate slug "${slug}"`);
    seen.add(slug);

    if (typeof s.name !== 'string' || s.name === '') fail(`show "${slug}": missing required "name"`);
    if (typeof s.searchTerm !== 'string' || s.searchTerm === '') {
      fail(`show "${slug}": missing required "searchTerm"`);
    }
    if (s.feedUrl !== null && typeof s.feedUrl !== 'string') {
      fail(`show "${slug}": "feedUrl" must be a string or null`);
    }
    if (typeof s.region !== 'string' || !REGIONS.includes(s.region as Region)) {
      fail(`show "${slug}": invalid region "${String(s.region)}" (expected ${REGIONS.join(', ')})`);
    }
    if (typeof s.active !== 'boolean') fail(`show "${slug}": missing required "active" boolean`);

    const maxEpisodesPerRun = s.maxEpisodesPerRun;
    if (typeof maxEpisodesPerRun !== 'number' || !Number.isInteger(maxEpisodesPerRun) || maxEpisodesPerRun < 1) {
      fail(`show "${slug}": "maxEpisodesPerRun" must be a positive integer`);
    }

    const speakersExpected = s.speakersExpected === undefined ? null : s.speakersExpected;
    if (speakersExpected !== null && (typeof speakersExpected !== 'number' || speakersExpected < 1 || speakersExpected > 10)) {
      // AssemblyAI accepts a hint of at most 10 speakers.
      fail(`show "${slug}": "speakersExpected" must be null or a number from 1 to 10`);
    }

    const show: RosterShow = {
      slug,
      name: s.name,
      searchTerm: s.searchTerm,
      feedUrl: (s.feedUrl as string | null) ?? null,
      hosts: readStringArray(s.hosts, 'hosts', slug),
      region: s.region as Region,
      lenses: readStringArray(s.lenses, 'lenses', slug),
      active: s.active,
      maxEpisodesPerRun,
      speakersExpected: speakersExpected as number | null,
    };
    if (s.formatGuess === true) show.formatGuess = true;
    return show;
  });

  return { shows: parsed };
}

export async function loadRoster(filePath: string): Promise<Roster> {
  return parseRoster(JSON.parse(await fs.readFile(filePath, 'utf8')));
}

export async function writeRoster(filePath: string, roster: Roster): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(roster, null, 2)}\n`, 'utf8');
}

export function appleSearchUrl(searchTerm: string, country = 'GB'): string {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('media', 'podcast');
  url.searchParams.set('term', searchTerm);
  url.searchParams.set('country', country);
  return url.toString();
}

export interface RosterSyncResult {
  resolved: Array<{ slug: string; name: string; feedUrl: string }>;
  unresolved: Array<{ slug: string; name: string; reason: string }>;
  unchanged: Array<{ slug: string; feedUrl: string }>;
}

interface AppleSearchResponse {
  resultCount?: number;
  results?: Array<{ feedUrl?: string }>;
}

/**
 * Resolves missing feed URLs via Apple's podcast search, writes them back to
 * the roster file, and upserts Show rows. A non-null feedUrl is never
 * overwritten unless `force`.
 */
export async function syncRoster(
  ctx: RadarContext,
  deps: { http: HttpClient; rosterPath: string },
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<RosterSyncResult> {
  const roster = await loadRoster(deps.rosterPath);
  const result: RosterSyncResult = { resolved: [], unresolved: [], unchanged: [] };
  let rosterChanged = false;

  for (const show of roster.shows) {
    const needsResolution = opts.force || show.feedUrl === null;

    if (!needsResolution) {
      result.unchanged.push({ slug: show.slug, feedUrl: show.feedUrl! });
    } else {
      try {
        const response = await deps.http.getJson<AppleSearchResponse>(appleSearchUrl(show.searchTerm));
        const feedUrl = response.results?.[0]?.feedUrl;
        if (typeof feedUrl === 'string' && feedUrl !== '') {
          show.feedUrl = feedUrl;
          rosterChanged = true;
          result.resolved.push({ slug: show.slug, name: show.name, feedUrl });
          ctx.logger.info('roster.resolved', { slug: show.slug, name: show.name, feedUrl });
        } else {
          const reason = 'Apple search returned no result';
          result.unresolved.push({ slug: show.slug, name: show.name, reason });
          ctx.logger.warn('roster.unresolved', { slug: show.slug, reason });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        result.unresolved.push({ slug: show.slug, name: show.name, reason });
        ctx.logger.warn('roster.unresolved', { slug: show.slug, reason });
      }
    }

    if (!opts.dryRun) {
      const data = {
        name: show.name,
        feedUrl: show.feedUrl,
        hosts: JSON.stringify(show.hosts),
        region: show.region,
        lenses: JSON.stringify(show.lenses),
        active: show.active,
        maxEpisodesPerRun: show.maxEpisodesPerRun,
        speakersExpected: show.speakersExpected,
      };
      await ctx.prisma.show.upsert({
        where: { slug: show.slug },
        create: { slug: show.slug, ...data },
        update: data,
      });
    }
  }

  if (rosterChanged && !opts.dryRun) await writeRoster(deps.rosterPath, roster);
  return result;
}
