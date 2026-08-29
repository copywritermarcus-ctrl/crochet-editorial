import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAssemblyAiResponse } from '../src/clients/transcriber.js';
import { transcribe } from '../src/stages/transcribe.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { fakeTranscriber } from './helpers/fakes.js';
import { fixture } from './helpers/paths.js';
import {
  assemblyAiFixtureAsVendorTranscript,
  readAssemblyAiFixture,
  seedEpisode,
  seedShows,
} from './helpers/seed.js';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

/**
 * Assertions read their expectations out of the fixture rather than hard-coding
 * them, so the suite stays green when the placeholder is replaced by the real
 * recorded response in Session 2.
 */
describe('parseAssemblyAiResponse', () => {
  it('maps the vendor payload onto the neutral shape', () => {
    const raw = JSON.parse(fs.readFileSync(fixture('assemblyai', 'response.fixture.json'), 'utf8'));
    const parsed = parseAssemblyAiResponse(raw);

    expect(parsed.id).toBe(raw.id);
    expect(parsed.status).toBe('completed');
    expect(parsed.audioDurationSec).toBe(raw.audio_duration);
    expect(parsed.utterances).toHaveLength(raw.utterances.length);
    expect(parsed.utterances[0]).toMatchObject({
      speaker: raw.utterances[0].speaker,
      start: raw.utterances[0].start,
      end: raw.utterances[0].end,
      text: raw.utterances[0].text,
    });
  });

  it('keeps the untouched payload for audit', () => {
    const raw = JSON.parse(fs.readFileSync(fixture('assemblyai', 'response.fixture.json'), 'utf8'));
    expect(parseAssemblyAiResponse(raw).raw).toEqual(raw);
  });

  it('tolerates the per-word arrays real responses carry', () => {
    const raw = JSON.parse(fs.readFileSync(fixture('assemblyai', 'response.fixture.json'), 'utf8'));
    expect(() => parseAssemblyAiResponse(raw)).not.toThrow();
  });

  it('throws on a vendor error payload rather than returning empty utterances', () => {
    expect(() =>
      parseAssemblyAiResponse({ id: 'x', status: 'error', error: 'Audio file is corrupt' }),
    ).toThrow(/corrupt/i);
  });
});

describe('transcribe', () => {
  const seedFetched = (over: Record<string, unknown> = {}) =>
    seedEpisode(env.prisma, { slug: '2bobs', status: 'fetched', audioPath: '/tmp/fake.mp3', ...over });

  it('persists utterances in fixture order and marks the episode transcribed', async () => {
    const raw = readAssemblyAiFixture();
    const id = await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    expect(result.transcribed).toBe(1);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('transcribed');
    expect(ep.source).toBe('assemblyai');
    expect(ep.transcriptId).toBe(raw.id);

    const utterances = await env.prisma.utterance.findMany({ where: { episodeId: id }, orderBy: { idx: 'asc' } });
    expect(utterances).toHaveLength(raw.utterances.length);
    expect(utterances.map((u) => u.idx)).toEqual(raw.utterances.map((_, i) => i));
    expect(utterances.map((u) => u.speakerLabel)).toEqual(raw.utterances.map((u) => u.speaker));
    expect(utterances.map((u) => u.text)).toEqual(raw.utterances.map((u) => u.text));
    expect(utterances.map((u) => u.startMs)).toEqual(raw.utterances.map((u) => u.start));
    expect(utterances[0]!.confidence).toBeCloseTo(raw.utterances[0]!.confidence, 6);
  });

  it('estimates cost from the vendor duration at the configured rate', async () => {
    const raw = readAssemblyAiFixture();
    const id = await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600, ratePerHour: 0.17 });

    const expected = (raw.audio_duration / 3600) * 0.17;
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.estCostUsd).toBeCloseTo(expected, 8);
    expect(result.estCostUsd).toBeCloseTo(expected, 8);
    expect(result.minutesUsed).toBeCloseTo(raw.audio_duration / 60, 6);
  });

  it('writes the raw vendor response to data/raw for audit', async () => {
    const id = await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    const rel = path.join('raw', `${id}.assemblyai.json`);
    expect(env.exists(rel)).toBe(true);
    expect(JSON.parse(env.read(rel))).toEqual(readAssemblyAiFixture());
  });

  it('passes the show speakersExpected hint through', async () => {
    await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    // 2Bobs is a no-guest panel show: two hosts, two speakers expected.
    expect(transcriber.calls[0]!.speakersExpected).toBe(2);
  });

  it('omits the hint when the show does not configure one', async () => {
    await env.prisma.show.update({ where: { slug: '2bobs' }, data: { speakersExpected: null } });
    await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    expect(transcriber.calls[0]!.speakersExpected).toBeNull();
  });

  it('skips an episode that would breach the minute cap and notes it as cap', async () => {
    // 1500s = 25 minutes; a 10-minute cap cannot admit it.
    const id = await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 10 });

    expect(result.transcribed).toBe(0);
    expect(result.skipped).toEqual([{ episodeId: id, note: 'cap' }]);
    expect(transcriber.calls).toHaveLength(0);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('skipped');
  });

  it('transcribes up to the cap and defers the rest', async () => {
    const first = await seedFetched({ guid: 'ep-a', durationSec: 1500 });
    const second = await seedFetched({ guid: 'ep-b', durationSec: 1500, publishedAt: new Date('2026-08-26T09:00:00Z') });
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 30 });

    expect(result.transcribed).toBe(1);
    expect(result.skipped).toHaveLength(1);
    const statuses = new Map(
      (await env.prisma.episode.findMany({ where: { id: { in: [first, second] } } })).map((e) => [e.id, e.status]),
    );
    expect([...statuses.values()].sort()).toEqual(['skipped', 'transcribed']);
  });

  it('treats a previously skipped episode as fetched on the next run', async () => {
    const id = await seedFetched({ status: 'skipped' });
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    expect(result.transcribed).toBe(1);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('transcribed');
  });

  it('refuses to run without a cap', async () => {
    await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    await expect(
      transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 0 }),
    ).rejects.toThrow(/cap|max-minutes/i);
    await expect(
      // A missing cap is a programming error, not a runtime default.
      transcribe(env.ctx, { transcriber }, { allPending: true } as never),
    ).rejects.toThrow(/cap|max-minutes/i);
  });

  it('marks a vendor error as failed and does not retry inside the run', async () => {
    const id = await seedFetched();
    const transcriber = fakeTranscriber({ perCall: [{ error: 'AssemblyAI: transcoding failed' }] });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    expect(result.failed).toBe(1);
    expect(transcriber.calls).toHaveLength(1);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('failed');
    expect(ep.errorMessage).toContain('transcoding failed');
  });

  it('skips episodes that already have a provided transcript', async () => {
    await seedFetched({ source: 'provided', status: 'transcribed' });
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    expect(result.transcribed).toBe(0);
    expect(transcriber.calls).toHaveLength(0);
  });

  it('is idempotent: re-transcribing does not duplicate utterances or double-bill', async () => {
    const raw = readAssemblyAiFixture();
    const id = await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });
    const second = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600 });

    expect(second.transcribed).toBe(0);
    expect(second.estCostUsd).toBe(0);
    expect(await env.prisma.utterance.count({ where: { episodeId: id } })).toBe(raw.utterances.length);
  });

  it('spends nothing on a dry run', async () => {
    const id = await seedFetched();
    const transcriber = fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() });

    const result = await transcribe(env.ctx, { transcriber }, { allPending: true, maxMinutes: 600, dryRun: true });

    expect(transcriber.calls).toHaveLength(0);
    expect(result.estCostUsd).toBe(0);
    expect(await env.prisma.utterance.count({ where: { episodeId: id } })).toBe(0);
    expect(env.exists(path.join('raw', `${id}.assemblyai.json`))).toBe(false);
  });
});
