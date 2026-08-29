import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type RunDeps } from '../src/stages/run.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { fakeAudioClient, fakeFeedClient, fakeHttpClient, fakeNamer, fakeTranscriber } from './helpers/fakes.js';
import { fixture } from './helpers/paths.js';
import { assemblyAiFixtureAsVendorTranscript, seedShows } from './helpers/seed.js';

const FEEDS = {
  'https://feeds.example/2bobs.xml': fixture('feeds', 'plain.xml'),
  'https://feeds.example/rare-mind.xml': fixture('feeds', 'with-transcript.xml'),
};

const expectedMap = () => fs.readFileSync(fixture('naming', 'expected-speaker-map.json'), 'utf8');
const providedJson = () => fs.readFileSync(fixture('transcripts', 'provided.json'), 'utf8');
const providedNoSpeakers = () => fs.readFileSync(fixture('transcripts', 'provided-no-speakers.json'), 'utf8');

const TRANSCRIPT_URLS = {
  'https://transcripts.example/rare-mind/041.json': { body: providedJson() },
  'https://transcripts.example/rare-mind/040.vtt': {
    body: fs.readFileSync(fixture('transcripts', 'provided.vtt'), 'utf8'),
  },
};

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

function deps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    feedClient: fakeFeedClient(FEEDS),
    audioClient: fakeAudioClient(),
    http: fakeHttpClient(TRANSCRIPT_URLS),
    transcriber: fakeTranscriber({ response: assemblyAiFixtureAsVendorTranscript() }),
    // One response per episode that reaches naming; the queue is generous.
    namer: fakeNamer(Array.from({ length: 10 }, () => expectedMap())),
    ...over,
  };
}

describe('run', () => {
  it('drives poll through export and writes one RunLog with the counts', async () => {
    const summary = await run(env.ctx, deps(), { sinceDays: 7, maxMinutes: 600, showSlug: '2bobs' });

    expect(summary.counts.discovered).toBe(3);
    expect(summary.counts.transcribed).toBe(3);
    expect(summary.counts.named).toBe(3);
    expect(summary.counts.exported).toBe(3);
    expect(summary.counts.failed).toBe(0);
    expect(summary.exitCode).toBe(0);

    const logs = await env.prisma.runLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.command).toContain('run');
    expect(logs[0]!.dryRun).toBe(false);
    expect(logs[0]!.discovered).toBe(3);
    expect(logs[0]!.exported).toBe(3);
    expect(logs[0]!.finishedAt).not.toBeNull();
    expect(logs[0]!.estCostUsd).toBeGreaterThan(0);
    expect(env.list(path.join('exports', '2bobs'))).toHaveLength(6);
  });

  it('imports rather than transcribing where the feed ships a usable transcript', async () => {
    const d = deps();
    const summary = await run(env.ctx, d, { sinceDays: 7, maxMinutes: 600, showSlug: 'rare-mind' });

    expect(summary.counts.imported).toBe(2);
    expect(summary.counts.transcribed).toBe(0);
    expect((d.transcriber as ReturnType<typeof fakeTranscriber>).calls).toHaveLength(0);
    expect((d.audioClient as ReturnType<typeof fakeAudioClient>).calls).toHaveLength(0);
    expect(summary.counts.estCostUsd).toBe(0);
  });

  it('falls through to fetch and transcribe in the same run when import refuses', async () => {
    const d = deps({
      http: fakeHttpClient({
        ...TRANSCRIPT_URLS,
        'https://transcripts.example/rare-mind/041.json': { body: providedNoSpeakers() },
      }),
    });

    const summary = await run(env.ctx, d, { sinceDays: 7, maxMinutes: 600, showSlug: 'rare-mind' });

    expect(summary.counts.imported).toBe(1);
    expect(summary.counts.transcribed).toBe(1);
    expect((d.audioClient as ReturnType<typeof fakeAudioClient>).calls).toHaveLength(1);
    expect(summary.counts.exported).toBe(2);
  });

  it('honours the minute cap and reports what it deferred', async () => {
    const summary = await run(env.ctx, deps(), { sinceDays: 7, maxMinutes: 30, showSlug: '2bobs' });

    expect(summary.counts.transcribed).toBe(1);
    expect(summary.counts.skipped).toBe(2);
    expect(summary.counts.minutesUsed).toBeCloseTo(25, 6);
    expect(summary.exitCode).toBe(0);
  });

  it('exits non-zero when a stage fails, and still exports the episodes that worked', async () => {
    const d = deps({
      transcriber: fakeTranscriber({
        perCall: [
          { error: 'AssemblyAI: transcoding failed' },
          assemblyAiFixtureAsVendorTranscript(),
          assemblyAiFixtureAsVendorTranscript(),
        ],
      }),
    });

    const summary = await run(env.ctx, d, { sinceDays: 7, maxMinutes: 600, showSlug: '2bobs' });

    expect(summary.exitCode).not.toBe(0);
    expect(summary.counts.failed).toBe(1);
    expect(summary.counts.exported).toBe(2);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]!.errorMessage).toContain('transcoding failed');
    expect((await env.prisma.runLog.findFirstOrThrow()).failed).toBe(1);
  });

  it('surfaces speakers needing review in the summary', async () => {
    const lowConfidence = JSON.stringify({
      speakers: [
        { label: 'A', name: 'Blair Enns', role: 'host', confidence: 'high' },
        { label: 'B', name: 'Unknown speaker B', role: 'unknown', confidence: 'low' },
      ],
    });
    const d = deps({ namer: fakeNamer(Array.from({ length: 10 }, () => lowConfidence)) });

    const summary = await run(env.ctx, d, { sinceDays: 7, maxMinutes: 600, showSlug: '2bobs' });

    expect(summary.needsReview).toHaveLength(3);
    expect(summary.needsReview[0]!.label).toBe('B');
    expect(summary.needsReview[0]!.title).toBeTruthy();
  });

  it('is idempotent: a second run does nothing and spends nothing', async () => {
    const first = await run(env.ctx, deps(), { sinceDays: 7, maxMinutes: 600, showSlug: '2bobs' });
    const second = await run(env.ctx, deps(), { sinceDays: 7, maxMinutes: 600, showSlug: '2bobs' });

    expect(first.counts.exported).toBe(3);
    expect(second.counts.discovered).toBe(0);
    expect(second.counts.transcribed).toBe(0);
    expect(second.counts.estCostUsd).toBe(0);
    expect(await env.prisma.runLog.count()).toBe(2);
  });

  it('on a dry run writes only a RunLog row, flagged as such', async () => {
    const d = deps();
    const summary = await run(env.ctx, d, { sinceDays: 7, maxMinutes: 600, showSlug: '2bobs', dryRun: true });

    expect(summary.counts.discovered).toBe(3);
    expect(await env.prisma.episode.count()).toBe(0);
    expect(await env.prisma.utterance.count()).toBe(0);
    expect(await env.prisma.speakerMap.count()).toBe(0);
    expect(env.list(path.join('exports', '2bobs'))).toEqual([]);
    expect(fs.existsSync(path.join(env.dataDir, 'audio'))).toBe(false);

    const logs = await env.prisma.runLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.dryRun).toBe(true);
    expect(logs[0]!.estCostUsd).toBe(0);
    expect((d.transcriber as ReturnType<typeof fakeTranscriber>).calls).toHaveLength(0);
    expect((d.namer as ReturnType<typeof fakeNamer>).prompts).toHaveLength(0);
  });
});
