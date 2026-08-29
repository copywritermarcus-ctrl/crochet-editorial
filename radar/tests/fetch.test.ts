import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchAudio } from '../src/stages/fetch.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { fakeAudioClient } from './helpers/fakes.js';
import { seedEpisode, seedShows } from './helpers/seed.js';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

describe('fetchAudio', () => {
  it('downloads to data/audio/<episodeId> and marks the episode fetched', async () => {
    const id = await seedEpisode(env.prisma, { slug: '2bobs' });
    const audioClient = fakeAudioClient();

    const result = await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(0);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('fetched');
    expect(ep.audioPath).not.toBeNull();
    expect(path.basename(ep.audioPath!)).toBe(`${id}.mp3`);
    expect(env.exists(path.join('audio', `${id}.mp3`))).toBe(true);
  });

  it('passes the enclosure URL through untouched so redirects resolve downstream', async () => {
    const trackingUrl = 'https://pdst.fm/e/chtbl.com/track/ABCD12/traffic.megaphone.fm/CRO1234567890.mp3';
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'ep-tracking', audioUrl: trackingUrl });
    const audioClient = fakeAudioClient({
      redirects: { [trackingUrl]: 'https://traffic.megaphone.fm/CRO1234567890.mp3' },
    });

    await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(audioClient.calls[0]!.url).toBe(trackingUrl);
  });

  it('records a failure with its message and leaves the audio path unset', async () => {
    const id = await seedEpisode(env.prisma, { slug: '2bobs' });
    const audioClient = fakeAudioClient({
      failures: { [String((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).audioUrl)]: 'HTTP 404' },
    });

    const result = await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(result.failed).toBe(1);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('failed');
    expect(ep.errorMessage).toContain('404');
    expect(ep.audioPath).toBeNull();
  });

  it('one failure does not stop the other episodes', async () => {
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'ep-good', audioUrl: 'https://audio.example/good.mp3' });
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'ep-bad', audioUrl: 'https://audio.example/bad.mp3' });
    const audioClient = fakeAudioClient({ failures: { 'https://audio.example/bad.mp3': 'HTTP 500' } });

    const result = await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('defers an episode that carries an unrefused provided transcript', async () => {
    const id = await seedEpisode(env.prisma, {
      slug: 'rare-mind',
      guid: 'rare-mind-ep-041',
      providedTranscriptUrl: 'https://transcripts.example/rare-mind/041.json',
      providedTranscriptType: 'application/json',
    });
    const audioClient = fakeAudioClient();

    const result = await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(result.deferredToImport).toEqual([id]);
    expect(audioClient.calls).toHaveLength(0);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('discovered');
  });

  it('downloads anyway once import has refused that transcript', async () => {
    const id = await seedEpisode(env.prisma, {
      slug: 'rare-mind',
      guid: 'rare-mind-ep-041',
      providedTranscriptUrl: 'https://transcripts.example/rare-mind/041.json',
      providedTranscriptType: 'application/json',
      providedTranscriptRefusedReason: 'no speaker information in provided transcript',
    });
    const audioClient = fakeAudioClient();

    const result = await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(result.fetched).toBe(1);
    expect(audioClient.calls).toHaveLength(1);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('fetched');
  });

  it('picks up an episode the minute cap skipped on a previous run', async () => {
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'ep-capped', status: 'skipped' });
    const audioClient = fakeAudioClient();

    const result = await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(result.fetched).toBe(1);
  });

  it('does not re-download an episode that is already fetched', async () => {
    await seedEpisode(env.prisma, { slug: '2bobs', status: 'fetched', audioPath: '/tmp/already.mp3' });
    const audioClient = fakeAudioClient();

    const result = await fetchAudio(env.ctx, { audioClient }, { allPending: true });

    expect(result.fetched).toBe(0);
    expect(audioClient.calls).toHaveLength(0);
  });

  it('fetches a single episode by id', async () => {
    const wanted = await seedEpisode(env.prisma, { slug: '2bobs', guid: 'ep-one' });
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'ep-two' });
    const audioClient = fakeAudioClient();

    const result = await fetchAudio(env.ctx, { audioClient }, { episodeId: wanted });

    expect(result.fetched).toBe(1);
    expect(audioClient.calls).toHaveLength(1);
  });

  it('writes nothing on a dry run', async () => {
    const id = await seedEpisode(env.prisma, { slug: '2bobs' });
    const audioClient = fakeAudioClient();

    await fetchAudio(env.ctx, { audioClient }, { allPending: true, dryRun: true });

    expect(audioClient.calls).toHaveLength(0);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('discovered');
  });
});
