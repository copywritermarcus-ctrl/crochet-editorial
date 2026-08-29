import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportEpisodes, mergeTurns } from '../src/stages/export.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { fixture } from './helpers/paths.js';
import {
  assemblyAiFixtureAsVendorTranscript,
  seedEpisode,
  seedShows,
  seedSpeakerMap,
  seedUtterances,
} from './helpers/seed.js';

const expectedMd = () => fs.readFileSync(fixture('export', 'expected.md'), 'utf8');

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

/** The fully named 2Bobs fixture episode that expected.md is frozen against. */
async function seedNamed(over: Record<string, unknown> = {}): Promise<string> {
  const id = await seedEpisode(env.prisma, {
    slug: '2bobs',
    status: 'named',
    source: 'assemblyai',
    audioPath: '/tmp/fake.mp3',
    ...over,
  });
  await seedUtterances(env.prisma, id, assemblyAiFixtureAsVendorTranscript().utterances);
  await seedSpeakerMap(env.prisma, id, [
    { label: 'A', name: 'Blair Enns', role: 'host', confidence: 'high' },
    { label: 'B', name: 'David C. Baker', role: 'host', confidence: 'high' },
  ]);
  return id;
}

describe('mergeTurns', () => {
  it('merges consecutive utterances from the same speaker, keeping the first timestamp', () => {
    const turns = mergeTurns(
      [
        { speakerLabel: 'A', startMs: 0, endMs: 1000, text: 'One.' },
        { speakerLabel: 'A', startMs: 1200, endMs: 2000, text: 'Two.' },
        { speakerLabel: 'B', startMs: 2100, endMs: 3000, text: 'Three.' },
        { speakerLabel: 'A', startMs: 3100, endMs: 4000, text: 'Four.' },
      ],
      new Map([['A', 'Alice'], ['B', 'Bob']]),
    );

    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({ label: 'A', name: 'Alice', startMs: 0, endMs: 2000, text: 'One. Two.' });
    expect(turns[1]!.startMs).toBe(2100);
    expect(turns[2]!.text).toBe('Four.');
  });

  it('falls back to a readable placeholder for an unmapped label', () => {
    const turns = mergeTurns([{ speakerLabel: 'C', startMs: 0, endMs: 1, text: 'Hello.' }], new Map());
    expect(turns[0]!.name).toContain('C');
  });

  it('returns an empty array for no utterances', () => {
    expect(mergeTurns([], new Map())).toEqual([]);
  });
});

describe('exportEpisodes', () => {
  it('produces byte-identical Markdown for the fixture episode', async () => {
    const id = await seedNamed();

    const result = await exportEpisodes(env.ctx, { episodeId: id, format: 'md' });

    expect(result.exported).toBe(1);
    const rel = path.join('exports', '2bobs', '2026-08-27-productization-again.md');
    expect(env.exists(rel)).toBe(true);
    expect(env.read(rel)).toBe(expectedMd());
  });

  it('writes both formats by default', async () => {
    const id = await seedNamed();

    await exportEpisodes(env.ctx, { episodeId: id });

    expect(env.list(path.join('exports', '2bobs'))).toEqual([
      '2026-08-27-productization-again.json',
      '2026-08-27-productization-again.md',
    ]);
  });

  it('writes a JSON export carrying metadata, the speaker map and merged turns', async () => {
    const id = await seedNamed();

    await exportEpisodes(env.ctx, { episodeId: id, format: 'json' });

    const doc = JSON.parse(env.read(path.join('exports', '2bobs', '2026-08-27-productization-again.json')));
    expect(doc.episode).toMatchObject({
      id,
      showSlug: '2bobs',
      showName: '2Bobs',
      title: 'Productization (Again)',
      durationSec: 1500,
      source: 'assemblyai',
      url: 'https://2bobs.example/episodes/productization-again',
    });
    expect(doc.episode.publishedAt).toContain('2026-08-27');
    expect(doc.speakers).toHaveLength(2);
    expect(doc.reviewFlags).toEqual([]);
    expect(doc.turns).toHaveLength(8);
    expect(doc.turns[0]).toMatchObject({ label: 'A', name: 'Blair Enns', startMs: 0 });
  });

  it('marks the episode exported', async () => {
    const id = await seedNamed();
    await exportEpisodes(env.ctx, { episodeId: id });
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('exported');
  });

  it('lists low-confidence labels in the review flags line', async () => {
    const id = await seedEpisode(env.prisma, { slug: '2bobs', status: 'named', source: 'assemblyai' });
    await seedUtterances(env.prisma, id, assemblyAiFixtureAsVendorTranscript().utterances);
    await seedSpeakerMap(env.prisma, id, [
      { label: 'A', name: 'Blair Enns', role: 'host', confidence: 'high' },
      { label: 'B', name: 'Unknown speaker B', role: 'unknown', confidence: 'low', needsReview: true },
    ]);

    await exportEpisodes(env.ctx, { episodeId: id, format: 'md' });

    const md = env.read(path.join('exports', '2bobs', '2026-08-27-productization-again.md'));
    expect(md).toContain('Review flags: B');
    expect(md).not.toContain('Review flags: none');
  });

  it('formats a header duration over one hour as h:mm:ss', async () => {
    const id = await seedNamed({ guid: 'ep-long', title: 'A Long One', durationSec: 3723 });

    await exportEpisodes(env.ctx, { episodeId: id, format: 'md' });

    const md = env.read(path.join('exports', '2bobs', '2026-08-27-a-long-one.md'));
    expect(md).toContain('Duration: 1:02:03');
  });

  it('formats turn timecodes over one hour as h:mm:ss', async () => {
    const id = await seedEpisode(env.prisma, {
      slug: '2bobs', guid: 'ep-hourplus', title: 'Past The Hour', status: 'named',
      source: 'assemblyai', durationSec: 7200,
    });
    await seedUtterances(env.prisma, id, [
      { speaker: 'A', start: 0, end: 1000, text: 'Start.', confidence: 0.9 },
      { speaker: 'B', start: 3_600_000, end: 3_601_000, text: 'An hour in.', confidence: 0.9 },
      { speaker: 'A', start: 3_723_000, end: 3_724_000, text: 'And later.', confidence: 0.9 },
    ]);
    await seedSpeakerMap(env.prisma, id, [
      { label: 'A', name: 'Blair Enns', role: 'host', confidence: 'high' },
      { label: 'B', name: 'David C. Baker', role: 'host', confidence: 'high' },
    ]);

    await exportEpisodes(env.ctx, { episodeId: id, format: 'md' });

    const md = env.read(path.join('exports', '2bobs', '2026-08-27-past-the-hour.md'));
    expect(md).toContain('[00:00] Blair Enns: Start.');
    expect(md).toContain('[1:00:00] David C. Baker: An hour in.');
    expect(md).toContain('[1:02:03] Blair Enns: And later.');
  });

  it('falls back to the audio URL when the feed gave no page URL', async () => {
    const id = await seedNamed({ guid: 'ep-nopage', title: 'No Page', pageUrl: null });

    await exportEpisodes(env.ctx, { episodeId: id, format: 'md' });

    const md = env.read(path.join('exports', '2bobs', '2026-08-27-no-page.md'));
    expect(md).toContain('URL: https://audio.example/2bobs/productization-again.mp3');
  });

  it('exports every named episode with --all-named', async () => {
    await seedNamed({ guid: 'ep-one', title: 'One' });
    await seedNamed({ guid: 'ep-two', title: 'Two' });

    const result = await exportEpisodes(env.ctx, { allNamed: true, format: 'md' });

    expect(result.exported).toBe(2);
    expect(env.list(path.join('exports', '2bobs'))).toHaveLength(2);
  });

  it('re-exporting overwrites in place rather than accumulating files', async () => {
    const id = await seedNamed();

    await exportEpisodes(env.ctx, { episodeId: id });
    await exportEpisodes(env.ctx, { episodeId: id });

    expect(env.list(path.join('exports', '2bobs'))).toHaveLength(2);
  });

  it('writes nothing on a dry run', async () => {
    const id = await seedNamed();

    const result = await exportEpisodes(env.ctx, { episodeId: id, dryRun: true });

    expect(result.exported).toBe(1);
    expect(env.list(path.join('exports', '2bobs'))).toEqual([]);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('named');
  });
});
