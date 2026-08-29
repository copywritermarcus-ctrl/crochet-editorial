import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  importTranscript,
  parseProvidedJson,
  parseProvidedTranscript,
  parseProvidedVtt,
} from '../src/stages/importTranscript.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { fakeHttpClient } from './helpers/fakes.js';
import { fixture } from './helpers/paths.js';
import { seedEpisode, seedShows } from './helpers/seed.js';

const JSON_URL = 'https://transcripts.example/rare-mind/041.json';
const VTT_URL = 'https://transcripts.example/rare-mind/041.vtt';

const providedJson = () => fs.readFileSync(fixture('transcripts', 'provided.json'), 'utf8');
const providedNoSpeakersJson = () => fs.readFileSync(fixture('transcripts', 'provided-no-speakers.json'), 'utf8');
const providedVtt = () => fs.readFileSync(fixture('transcripts', 'provided.vtt'), 'utf8');
const providedNoSpeakersVtt = () => fs.readFileSync(fixture('transcripts', 'provided-no-speakers.vtt'), 'utf8');

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

describe('parseProvidedJson', () => {
  it('maps Podcasting 2.0 segments to utterances with millisecond timings', () => {
    const parsed = parseProvidedJson(providedJson());
    expect(parsed).not.toBeNull();
    expect(parsed!.utterances).toHaveLength(6);
    expect(parsed!.utterances[0]).toEqual({
      speaker: 'Alex M H Smith',
      start: 0,
      end: 6400,
      text: 'My guest today is April Dunford, and we are going to talk about positioning.',
      confidence: null,
    });
    expect(parsed!.utterances[2]!.speaker).toBe('April Dunford');
    expect(parsed!.utterances[2]!.start).toBe(13600);
  });

  it('returns null when no segment carries speaker information', () => {
    expect(parseProvidedJson(providedNoSpeakersJson())).toBeNull();
  });

  it('returns null for a document that is not a transcript at all', () => {
    expect(parseProvidedJson('{"hello":"world"}')).toBeNull();
  });
});

describe('parseProvidedVtt', () => {
  it('reads both <v Name> voice tags and Name: prefixes', () => {
    const parsed = parseProvidedVtt(providedVtt());
    expect(parsed).not.toBeNull();
    expect(parsed!.utterances).toHaveLength(5);
    expect(parsed!.utterances[0]!.speaker).toBe('Alex M H Smith');
    expect(parsed!.utterances[0]!.text).toBe(
      'My guest today is April Dunford, and we are going to talk about positioning.',
    );
    // Cue 4 uses the bare "Name:" style.
    expect(parsed!.utterances[3]!.speaker).toBe('April Dunford');
    expect(parsed!.utterances[3]!.text).toBe(
      'Positioning is not what you say. It is the context you set before you say anything at all.',
    );
  });

  it('parses cue timings past the minute boundary', () => {
    const parsed = parseProvidedVtt(providedVtt());
    expect(parsed!.utterances[4]!.start).toBe(62200);
    expect(parsed!.utterances[4]!.end).toBe(70000);
  });

  it('returns null when no cue carries a speaker', () => {
    expect(parseProvidedVtt(providedNoSpeakersVtt())).toBeNull();
  });
});

describe('parseProvidedTranscript', () => {
  it('dispatches on mime type', () => {
    expect(parseProvidedTranscript(providedJson(), 'application/json')!.utterances).toHaveLength(6);
    expect(parseProvidedTranscript(providedVtt(), 'text/vtt')!.utterances).toHaveLength(5);
  });

  it('sniffs the format when the mime type is missing or wrong', () => {
    expect(parseProvidedTranscript(providedJson(), null)!.utterances).toHaveLength(6);
    expect(parseProvidedTranscript(providedVtt(), 'text/plain')!.utterances).toHaveLength(5);
  });
});

describe('importTranscript', () => {
  const seedImportable = () =>
    seedEpisode(env.prisma, {
      slug: 'rare-mind',
      guid: 'rare-mind-ep-041',
      durationSec: 2480,
      providedTranscriptUrl: JSON_URL,
      providedTranscriptType: 'application/json',
    });

  it('persists utterances in order, free of charge, and marks the episode transcribed', async () => {
    const id = await seedImportable();
    const http = fakeHttpClient({ [JSON_URL]: { body: providedJson(), contentType: 'application/json' } });

    const result = await importTranscript(env.ctx, { http }, { allPending: true });

    expect(result.imported).toBe(1);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('transcribed');
    expect(ep.source).toBe('provided');
    expect(ep.estCostUsd).toBe(0);

    const utterances = await env.prisma.utterance.findMany({ where: { episodeId: id }, orderBy: { idx: 'asc' } });
    expect(utterances).toHaveLength(6);
    expect(utterances.map((u) => u.idx)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(utterances[0]!.speakerLabel).toBe('Alex M H Smith');
    expect(utterances[5]!.text).toContain('you cannot fix a frame problem with better copy');
  });

  it('refuses a transcript with no speaker information and leaves the episode ready to fetch', async () => {
    const id = await seedImportable();
    const http = fakeHttpClient({ [JSON_URL]: { body: providedNoSpeakersJson(), contentType: 'application/json' } });

    const result = await importTranscript(env.ctx, { http }, { allPending: true });

    expect(result.imported).toBe(0);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]!.episodeId).toBe(id);

    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('discovered');
    expect(ep.source).toBeNull();
    expect(ep.providedTranscriptRefusedReason).toBeTruthy();
    expect(await env.prisma.utterance.count({ where: { episodeId: id } })).toBe(0);
  });

  it('does not re-attempt an import it has already refused', async () => {
    await seedEpisode(env.prisma, {
      slug: 'rare-mind',
      guid: 'rare-mind-ep-041',
      providedTranscriptUrl: JSON_URL,
      providedTranscriptType: 'application/json',
      providedTranscriptRefusedReason: 'no speaker information in provided transcript',
    });
    const http = fakeHttpClient({ [JSON_URL]: { body: providedJson() } });

    const result = await importTranscript(env.ctx, { http }, { allPending: true });

    expect(result.imported).toBe(0);
    expect(http.calls).toHaveLength(0);
  });

  it('imports a VTT transcript when that is what the feed offers', async () => {
    const id = await seedEpisode(env.prisma, {
      slug: 'rare-mind',
      guid: 'rare-mind-ep-040',
      providedTranscriptUrl: VTT_URL,
      providedTranscriptType: 'text/vtt',
    });
    const http = fakeHttpClient({ [VTT_URL]: { body: providedVtt(), contentType: 'text/vtt' } });

    const result = await importTranscript(env.ctx, { http }, { allPending: true });

    expect(result.imported).toBe(1);
    expect(await env.prisma.utterance.count({ where: { episodeId: id } })).toBe(5);
  });

  it('marks the episode failed when the transcript will not download', async () => {
    const id = await seedImportable();
    const http = fakeHttpClient({ [JSON_URL]: { body: '', error: 'HTTP 503' } });

    const result = await importTranscript(env.ctx, { http }, { allPending: true });

    expect(result.failed).toBe(1);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('failed');
    expect(ep.errorMessage).toContain('503');
  });

  it('is idempotent: a second import does not duplicate utterances', async () => {
    const id = await seedImportable();
    const http = fakeHttpClient({ [JSON_URL]: { body: providedJson() } });

    await importTranscript(env.ctx, { http }, { allPending: true });
    await importTranscript(env.ctx, { http }, { episodeId: id });

    expect(await env.prisma.utterance.count({ where: { episodeId: id } })).toBe(6);
  });

  it('ignores episodes with no provided transcript at all', async () => {
    await seedEpisode(env.prisma, { slug: '2bobs' });
    const http = fakeHttpClient({});

    const result = await importTranscript(env.ctx, { http }, { allPending: true });

    expect(result.imported).toBe(0);
    expect(http.calls).toHaveLength(0);
  });

  it('writes nothing on a dry run', async () => {
    const id = await seedImportable();
    const http = fakeHttpClient({ [JSON_URL]: { body: providedJson() } });

    await importTranscript(env.ctx, { http }, { allPending: true, dryRun: true });

    expect(await env.prisma.utterance.count({ where: { episodeId: id } })).toBe(0);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('discovered');
  });
});
