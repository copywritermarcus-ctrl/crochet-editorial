import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appleSearchUrl, loadRoster, parseRoster, syncRoster } from '../src/roster.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { expectThrows } from './helpers/expect.js';
import { fakeHttpClient } from './helpers/fakes.js';
import { fixture } from './helpers/paths.js';
import { readRosterFixture } from './helpers/seed.js';

let env: TestEnv;
let rosterPath: string;

beforeEach(async () => {
  env = await createTestEnv();
  rosterPath = path.join(env.rootDir, 'roster.json');
  fs.copyFileSync(fixture('roster.fixture.json'), rosterPath);
});

afterEach(async () => {
  await env.dispose();
});

const appleResponse = (feedUrl: string) =>
  JSON.stringify({ resultCount: 1, results: [{ feedUrl, collectionName: 'Whatever' }] });

describe('parseRoster', () => {
  it('accepts the fixture roster', () => {
    const roster = parseRoster(readRosterFixture());
    expect(roster.shows).toHaveLength(3);
    expect(roster.shows[0]!.slug).toBe('2bobs');
    expect(roster.shows[0]!.hosts).toEqual(['David C. Baker', 'Blair Enns']);
    expect(roster.shows[2]!.active).toBe(false);
  });

  it('rejects a duplicate slug', () => {
    const dup = readRosterFixture();
    dup.shows[1]!.slug = '2bobs';
    expect(() => parseRoster(dup)).toThrow(/2bobs/);
  });

  it('rejects an unknown region', () => {
    const bad = readRosterFixture();
    (bad.shows[0] as { region: string }).region = 'MARS';
    expect(() => parseRoster(bad)).toThrow(/region/i);
  });

  it('rejects a missing required field', () => {
    expectThrows(() => parseRoster({ shows: [{ slug: 'x' }] }), /name|required|missing/i);
  });

  it('rejects a document that is not a roster', () => {
    expectThrows(() => parseRoster({ nope: true }), /shows/i);
    expectThrows(() => parseRoster(null), /roster|object|shows/i);
  });

  it('loads from disk', async () => {
    const roster = await loadRoster(rosterPath);
    expect(roster.shows).toHaveLength(3);
  });
});

describe('appleSearchUrl', () => {
  it('builds an encoded Apple podcast search URL defaulting to GB', () => {
    const url = new URL(appleSearchUrl('2Bobs Enns Baker'));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(url.searchParams.get('media')).toBe('podcast');
    expect(url.searchParams.get('term')).toBe('2Bobs Enns Baker');
    expect(url.searchParams.get('country')).toBe('GB');
  });
});

describe('syncRoster', () => {
  it('resolves a missing feed URL, writes it back and upserts the show', async () => {
    const searchUrl = appleSearchUrl('Marketing Week Podcast');
    const http = fakeHttpClient({
      [searchUrl]: { body: appleResponse('https://feeds.example/marketing-week.xml') },
    });

    const result = await syncRoster(env.ctx, { http, rosterPath });

    expect(result.resolved).toEqual([
      { slug: 'marketing-week', name: 'The Marketing Week Podcast', feedUrl: 'https://feeds.example/marketing-week.xml' },
    ]);
    const written = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    expect(written.shows[2].feedUrl).toBe('https://feeds.example/marketing-week.xml');
    const show = await env.prisma.show.findUniqueOrThrow({ where: { slug: 'marketing-week' } });
    expect(show.feedUrl).toBe('https://feeds.example/marketing-week.xml');
  });

  it('never re-resolves a show that already has a feed URL', async () => {
    const searchUrl = appleSearchUrl('Marketing Week Podcast');
    const http = fakeHttpClient({ [searchUrl]: { body: appleResponse('https://feeds.example/marketing-week.xml') } });

    const result = await syncRoster(env.ctx, { http, rosterPath });

    expect(http.calls).toEqual([searchUrl]);
    expect(result.unchanged.map((u) => u.slug).sort()).toEqual(['2bobs', 'rare-mind']);
  });

  it('re-resolves everything under --force', async () => {
    const http = fakeHttpClient({
      [appleSearchUrl('2Bobs Enns Baker')]: { body: appleResponse('https://new.example/2bobs.xml') },
      [appleSearchUrl('The Rare Mind Alex Smith')]: { body: appleResponse('https://new.example/rare-mind.xml') },
      [appleSearchUrl('Marketing Week Podcast')]: { body: appleResponse('https://new.example/mw.xml') },
    });

    const result = await syncRoster(env.ctx, { http, rosterPath }, { force: true });

    expect(result.resolved).toHaveLength(3);
    const written = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    expect(written.shows[0].feedUrl).toBe('https://new.example/2bobs.xml');
  });

  it('warns and leaves the feed URL null when Apple returns nothing', async () => {
    const http = fakeHttpClient({
      [appleSearchUrl('Marketing Week Podcast')]: { body: JSON.stringify({ resultCount: 0, results: [] }) },
    });

    const result = await syncRoster(env.ctx, { http, rosterPath });

    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.slug).toBe('marketing-week');
    const written = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    expect(written.shows[2].feedUrl).toBeNull();
  });

  it('reports a search failure without aborting the sync', async () => {
    const http = fakeHttpClient({
      [appleSearchUrl('Marketing Week Podcast')]: { body: '', error: 'HTTP 429' },
    });

    const result = await syncRoster(env.ctx, { http, rosterPath });

    expect(result.unresolved[0]!.reason).toContain('429');
    expect(await env.prisma.show.count()).toBe(3);
  });

  it('upserts rather than duplicating on a second sync', async () => {
    const http = fakeHttpClient({
      [appleSearchUrl('Marketing Week Podcast')]: { body: appleResponse('https://feeds.example/marketing-week.xml') },
    });

    await syncRoster(env.ctx, { http, rosterPath });
    await syncRoster(env.ctx, { http, rosterPath });

    expect(await env.prisma.show.count()).toBe(3);
  });

  it('carries roster metadata onto the Show row', async () => {
    const http = fakeHttpClient({
      [appleSearchUrl('Marketing Week Podcast')]: { body: appleResponse('https://feeds.example/marketing-week.xml') },
    });

    await syncRoster(env.ctx, { http, rosterPath });

    const show = await env.prisma.show.findUniqueOrThrow({ where: { slug: '2bobs' } });
    expect(JSON.parse(show.hosts)).toEqual(['David C. Baker', 'Blair Enns']);
    expect(JSON.parse(show.lenses)).toEqual(['business-of-expertise']);
    expect(show.region).toBe('US');
    expect(show.maxEpisodesPerRun).toBe(3);
    expect(show.speakersExpected).toBe(2);
    expect(show.active).toBe(true);
  });

  it('writes neither the roster file nor the database on a dry run', async () => {
    const before = fs.readFileSync(rosterPath, 'utf8');
    const http = fakeHttpClient({
      [appleSearchUrl('Marketing Week Podcast')]: { body: appleResponse('https://feeds.example/marketing-week.xml') },
    });

    await syncRoster(env.ctx, { http, rosterPath }, { dryRun: true });

    expect(fs.readFileSync(rosterPath, 'utf8')).toBe(before);
    expect(await env.prisma.show.count()).toBe(0);
  });
});
