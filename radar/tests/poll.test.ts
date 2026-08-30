import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { poll } from '../src/stages/poll.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { fakeFeedClient } from './helpers/fakes.js';
import { fixture } from './helpers/paths.js';
import { seedShows } from './helpers/seed.js';

const FEEDS = {
  'https://feeds.example/2bobs.xml': fixture('feeds', 'plain.xml'),
  'https://feeds.example/rare-mind.xml': fixture('feeds', 'with-transcript.xml'),
};

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

describe('poll', () => {
  it('discovers only items inside the --since window', async () => {
    // Fixed clock is 2026-08-29T12:00Z; the fourth 2Bobs item is 10 Aug.
    const result = await poll(env.ctx, { feedClient: fakeFeedClient(FEEDS) }, { sinceDays: 7, showSlug: '2bobs' });
    expect(result.discovered).toBe(3);
    const guids = (await env.prisma.episode.findMany({ orderBy: { publishedAt: 'desc' } })).map((e) => e.guid);
    expect(guids).toEqual(['2bobs-ep-102', '2bobs-ep-101', '2bobs-ep-100']);
  });

  it('widens with a larger window', async () => {
    // Raise the cap so this measures the window alone; the cap has its own test.
    await env.prisma.show.update({ where: { slug: '2bobs' }, data: { maxEpisodesPerRun: 10 } });

    const result = await poll(env.ctx, { feedClient: fakeFeedClient(FEEDS) }, { sinceDays: 60, showSlug: '2bobs' });

    expect(result.discovered).toBe(4);
  });

  it('stores new episodes as discovered with feed metadata attached', async () => {
    await poll(env.ctx, { feedClient: fakeFeedClient(FEEDS) }, { sinceDays: 7, showSlug: '2bobs' });
    const ep = await env.prisma.episode.findFirstOrThrow({ where: { guid: '2bobs-ep-101' } });
    expect(ep.status).toBe('discovered');
    expect(ep.title).toBe('Productization (Again)');
    expect(ep.durationSec).toBe(1500);
    expect(ep.audioUrl).toBe('https://audio.example/2bobs/productization-again.mp3');
    expect(ep.pageUrl).toBe('https://2bobs.example/episodes/productization-again');
    expect(ep.providedTranscriptUrl).toBeNull();
    expect(ep.source).toBeNull();
  });

  it('records the preferred provided transcript URL and type', async () => {
    await poll(env.ctx, { feedClient: fakeFeedClient(FEEDS) }, { sinceDays: 7, showSlug: 'rare-mind' });
    const ep = await env.prisma.episode.findFirstOrThrow({ where: { guid: 'rare-mind-ep-041' } });
    expect(ep.providedTranscriptUrl).toBe('https://transcripts.example/rare-mind/041.json');
    expect(ep.providedTranscriptType).toBe('application/json');
  });

  it('de-duplicates on (showId, guid) and is idempotent across two runs', async () => {
    const feedClient = fakeFeedClient(FEEDS);
    const first = await poll(env.ctx, { feedClient }, { sinceDays: 7, showSlug: '2bobs' });
    const second = await poll(env.ctx, { feedClient }, { sinceDays: 7, showSlug: '2bobs' });

    expect(first.discovered).toBe(3);
    expect(second.discovered).toBe(0);
    expect(await env.prisma.episode.count()).toBe(3);
  });

  it('leaves an already-progressed episode untouched on a re-poll', async () => {
    const feedClient = fakeFeedClient(FEEDS);
    await poll(env.ctx, { feedClient }, { sinceDays: 7, showSlug: '2bobs' });
    const before = await env.prisma.episode.findFirstOrThrow({ where: { guid: '2bobs-ep-101' } });
    await env.prisma.episode.update({
      where: { id: before.id },
      data: { status: 'transcribed', source: 'assemblyai', audioPath: '/tmp/x.mp3' },
    });

    await poll(env.ctx, { feedClient }, { sinceDays: 7, showSlug: '2bobs' });

    const after = await env.prisma.episode.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.status).toBe('transcribed');
    expect(after.source).toBe('assemblyai');
    expect(after.audioPath).toBe('/tmp/x.mp3');
  });

  it('honours maxEpisodesPerRun, newest first', async () => {
    await env.prisma.show.update({ where: { slug: '2bobs' }, data: { maxEpisodesPerRun: 2 } });

    const result = await poll(env.ctx, { feedClient: fakeFeedClient(FEEDS) }, { sinceDays: 7, showSlug: '2bobs' });

    expect(result.discovered).toBe(2);
    const guids = (await env.prisma.episode.findMany({ orderBy: { publishedAt: 'desc' } })).map((e) => e.guid);
    expect(guids).toEqual(['2bobs-ep-102', '2bobs-ep-101']);
  });

  it('picks up the remainder on the next run once the cap frees up', async () => {
    const feedClient = fakeFeedClient(FEEDS);
    await env.prisma.show.update({ where: { slug: '2bobs' }, data: { maxEpisodesPerRun: 2 } });
    await poll(env.ctx, { feedClient }, { sinceDays: 7, showSlug: '2bobs' });

    const second = await poll(env.ctx, { feedClient }, { sinceDays: 7, showSlug: '2bobs' });

    expect(second.discovered).toBe(1);
    expect(await env.prisma.episode.count()).toBe(3);
  });

  it('skips inactive shows unless includeInactive is set', async () => {
    const feedClient = fakeFeedClient(FEEDS);
    await poll(env.ctx, { feedClient }, { sinceDays: 7 });
    expect(feedClient.calls).not.toContain('https://feeds.example/marketing-week.xml');
    expect(feedClient.calls.sort()).toEqual([
      'https://feeds.example/2bobs.xml',
      'https://feeds.example/rare-mind.xml',
    ]);
  });

  it('warns rather than throwing when an active show has no feed URL', async () => {
    await env.prisma.show.update({ where: { slug: 'rare-mind' }, data: { feedUrl: null } });
    const result = await poll(env.ctx, { feedClient: fakeFeedClient(FEEDS) }, { sinceDays: 7 });
    expect(result.warnings.join(' ')).toContain('rare-mind');
    expect(result.discovered).toBe(3);
  });

  it('reports a feed that fails to fetch as a warning and still polls the others', async () => {
    const feedClient = fakeFeedClient({ 'https://feeds.example/2bobs.xml': FEEDS['https://feeds.example/2bobs.xml'] });
    const result = await poll(env.ctx, { feedClient }, { sinceDays: 7 });
    expect(result.discovered).toBe(3);
    expect(result.warnings.join(' ')).toContain('rare-mind');
  });

  it('writes nothing on a dry run but still reports what it would discover', async () => {
    const result = await poll(env.ctx, { feedClient: fakeFeedClient(FEEDS) }, { sinceDays: 7, showSlug: '2bobs', dryRun: true });
    expect(result.discovered).toBe(3);
    expect(result.episodeIds).toEqual([]);
    expect(await env.prisma.episode.count()).toBe(0);
  });
});
