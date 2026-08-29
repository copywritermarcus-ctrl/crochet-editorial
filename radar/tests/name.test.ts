import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NAMING_DESCRIPTION_LIMIT,
  NAMING_HEAD_UTTERANCES,
  NAMING_TAIL_UTTERANCES,
  buildNamingRequest,
  nameSpeakers,
  parseSpeakerMapResponse,
} from '../src/stages/nameSpeakers.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { expectThrows } from './helpers/expect.js';
import { fakeNamer } from './helpers/fakes.js';
import { fixture } from './helpers/paths.js';
import {
  assemblyAiFixtureAsVendorTranscript,
  seedEpisode,
  seedShows,
  seedSpeakerMap,
  seedUtterances,
} from './helpers/seed.js';

const expectedMap = () =>
  JSON.parse(fs.readFileSync(fixture('naming', 'expected-speaker-map.json'), 'utf8'));
const expectedRequest = () =>
  JSON.parse(fs.readFileSync(fixture('naming', 'input.fixture.json'), 'utf8'));

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

/** A transcribed 2Bobs fixture episode, ready to name. */
async function seedTranscribed(): Promise<string> {
  const id = await seedEpisode(env.prisma, {
    slug: '2bobs',
    status: 'transcribed',
    source: 'assemblyai',
    audioPath: '/tmp/fake.mp3',
  });
  await seedUtterances(env.prisma, id, assemblyAiFixtureAsVendorTranscript().utterances);
  return id;
}

describe('buildNamingRequest', () => {
  it('builds exactly the frozen fixture request', () => {
    const vendor = assemblyAiFixtureAsVendorTranscript();
    const request = buildNamingRequest({
      showName: '2Bobs',
      hosts: ['David C. Baker', 'Blair Enns'],
      title: 'Productization (Again)',
      description:
        'Productization is a compression of something you already do well and repeatedly. ' +
        'David and Blair on why most firms package too early, and what that does to pricing.',
      utterances: vendor.utterances.map((u) => ({ speakerLabel: u.speaker, text: u.text })),
    });

    expect(request).toEqual(expectedRequest());
  });

  it('truncates the description at the documented limit', () => {
    const request = buildNamingRequest({
      showName: '2Bobs',
      hosts: [],
      title: 'x',
      description: 'y'.repeat(NAMING_DESCRIPTION_LIMIT + 500),
      utterances: [],
    });
    expect(request.episode.description).toHaveLength(NAMING_DESCRIPTION_LIMIT);
  });

  it('treats a null description as empty rather than the string "null"', () => {
    const request = buildNamingRequest({
      showName: '2Bobs', hosts: [], title: 'x', description: null, utterances: [],
    });
    expect(request.episode.description).toBe('');
  });

  it('sends head and tail without overlap on a long episode', () => {
    const utterances = Array.from({ length: 60 }, (_, i) => ({
      speakerLabel: i % 2 === 0 ? 'A' : 'B',
      text: `utterance ${i}`,
    }));

    const request = buildNamingRequest({
      showName: '2Bobs', hosts: [], title: 'x', description: '', utterances,
    });

    expect(request.utterances.head).toHaveLength(NAMING_HEAD_UTTERANCES);
    expect(request.utterances.tail).toHaveLength(NAMING_TAIL_UTTERANCES);
    expect(request.utterances.head[0]!.text).toBe('utterance 0');
    expect(request.utterances.tail[0]!.text).toBe('utterance 50');
    expect(request.utterances.tail.at(-1)!.text).toBe('utterance 59');

    const texts = [...request.utterances.head, ...request.utterances.tail].map((u) => u.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('leaves the tail empty when every utterance is already in the head', () => {
    const utterances = Array.from({ length: 12 }, (_, i) => ({ speakerLabel: 'A', text: `u${i}` }));
    const request = buildNamingRequest({
      showName: '2Bobs', hosts: [], title: 'x', description: '', utterances,
    });
    expect(request.utterances.head).toHaveLength(12);
    expect(request.utterances.tail).toEqual([]);
  });
});

describe('parseSpeakerMapResponse', () => {
  it('accepts the expected JSON', () => {
    const raw = JSON.stringify(expectedMap());
    expect(parseSpeakerMapResponse(raw, ['A', 'B'])).toEqual(expectedMap());
  });

  it('tolerates a fenced code block around the JSON', () => {
    const raw = '```json\n' + JSON.stringify(expectedMap()) + '\n```';
    expect(parseSpeakerMapResponse(raw, ['A', 'B'])).toEqual(expectedMap());
  });

  it('rejects malformed JSON with a readable reason', () => {
    expectThrows(() => parseSpeakerMapResponse('not json at all', ['A', 'B']), /json/i);
  });

  it('rejects a valid JSON document of the wrong shape', () => {
    expectThrows(() => parseSpeakerMapResponse('{"speakers":"nope"}', ['A', 'B']), /speakers/i);
    expectThrows(() => parseSpeakerMapResponse('{"foo":[]}', ['A', 'B']), /speakers/i);
  });

  it('rejects an unknown role or confidence value', () => {
    const bad = { speakers: [{ label: 'A', name: 'X', role: 'moderator', confidence: 'high' }] };
    expect(() => parseSpeakerMapResponse(JSON.stringify(bad), ['A'])).toThrow(/role/i);
    const bad2 = { speakers: [{ label: 'A', name: 'X', role: 'host', confidence: 'certain' }] };
    expect(() => parseSpeakerMapResponse(JSON.stringify(bad2), ['A'])).toThrow(/confidence/i);
  });

  it('rejects a response that misses a label present in the transcript', () => {
    const partial = { speakers: [{ label: 'A', name: 'X', role: 'host', confidence: 'high' }] };
    expect(() => parseSpeakerMapResponse(JSON.stringify(partial), ['A', 'B'])).toThrow(/B/);
  });

  it('rejects a label the transcript never contained', () => {
    const extra = {
      speakers: [
        { label: 'A', name: 'X', role: 'host', confidence: 'high' },
        { label: 'Z', name: 'Y', role: 'guest', confidence: 'high' },
      ],
    };
    expect(() => parseSpeakerMapResponse(JSON.stringify(extra), ['A'])).toThrow(/Z/);
  });
});

describe('nameSpeakers', () => {
  it('persists the expected speaker map and marks the episode named', async () => {
    const id = await seedTranscribed();
    const namer = fakeNamer([JSON.stringify(expectedMap())]);

    const result = await nameSpeakers(env.ctx, { namer }, { allPending: true });

    expect(result.named).toBe(1);
    expect(namer.prompts).toHaveLength(1);

    const rows = await env.prisma.speakerMap.findMany({ where: { episodeId: id }, orderBy: { label: 'asc' } });
    expect(rows.map((r) => ({ label: r.label, name: r.name, role: r.role, confidence: r.confidence })))
      .toEqual(expectedMap().speakers);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('named');
  });

  it('puts the roster hosts and the episode title into the prompt', async () => {
    await seedTranscribed();
    const namer = fakeNamer([JSON.stringify(expectedMap())]);

    await nameSpeakers(env.ctx, { namer }, { allPending: true });

    const prompt = namer.prompts[0]!;
    expect(prompt).toContain('David C. Baker');
    expect(prompt).toContain('Blair Enns');
    expect(prompt).toContain('Productization (Again)');
    expect(prompt).toMatch(/only\s+JSON|JSON only/i);
  });

  it('flags low confidence for review', async () => {
    const id = await seedTranscribed();
    const withUnknown = {
      speakers: [
        { label: 'A', name: 'Blair Enns', role: 'host', confidence: 'high' },
        { label: 'B', name: 'Unknown speaker B', role: 'unknown', confidence: 'low' },
      ],
    };
    const namer = fakeNamer([JSON.stringify(withUnknown)]);

    const result = await nameSpeakers(env.ctx, { namer }, { allPending: true });

    expect(result.needsReview).toEqual([{ episodeId: id, label: 'B' }]);
    const rows = await env.prisma.speakerMap.findMany({ where: { episodeId: id }, orderBy: { label: 'asc' } });
    expect(rows[0]!.needsReview).toBe(false);
    expect(rows[1]!.needsReview).toBe(true);
  });

  it('retries once on malformed output, appending the validation error', async () => {
    const id = await seedTranscribed();
    const namer = fakeNamer(['I think speaker A is Blair.', JSON.stringify(expectedMap())]);

    const result = await nameSpeakers(env.ctx, { namer }, { allPending: true });

    expect(result.named).toBe(1);
    expect(namer.prompts).toHaveLength(2);
    expect(namer.prompts[1]!.length).toBeGreaterThan(namer.prompts[0]!.length);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('named');
  });

  it('fails the episode after a second malformed response and calls no more', async () => {
    const id = await seedTranscribed();
    const namer = fakeNamer(['still not json', 'nor is this']);

    const result = await nameSpeakers(env.ctx, { namer }, { allPending: true });

    expect(result.named).toBe(0);
    expect(result.failed).toBe(1);
    expect(namer.prompts).toHaveLength(2);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('failed');
    expect(ep.errorMessage).toBeTruthy();
    expect(await env.prisma.speakerMap.count({ where: { episodeId: id } })).toBe(0);
  });

  it('never overwrites a manually corrected speaker row', async () => {
    const id = await seedTranscribed();
    await seedSpeakerMap(env.prisma, id, [
      { label: 'A', name: 'Blair Enns (corrected)', role: 'host', confidence: 'high', manual: true },
    ]);
    const namer = fakeNamer([JSON.stringify(expectedMap())]);

    await nameSpeakers(env.ctx, { namer }, { episodeId: id });

    const rows = await env.prisma.speakerMap.findMany({ where: { episodeId: id }, orderBy: { label: 'asc' } });
    expect(rows[0]!.name).toBe('Blair Enns (corrected)');
    expect(rows[0]!.manual).toBe(true);
    expect(rows[0]!.needsReview).toBe(false);
    // The non-manual label is still written.
    expect(rows[1]!.name).toBe('David C. Baker');
  });

  it('re-naming replaces the non-manual rows rather than duplicating them', async () => {
    const id = await seedTranscribed();
    const namer = fakeNamer([JSON.stringify(expectedMap()), JSON.stringify(expectedMap())]);

    await nameSpeakers(env.ctx, { namer }, { episodeId: id });
    await env.prisma.episode.update({ where: { id }, data: { status: 'transcribed' } });
    await nameSpeakers(env.ctx, { namer }, { episodeId: id });

    expect(await env.prisma.speakerMap.count({ where: { episodeId: id } })).toBe(2);
  });

  it('ignores episodes that are not transcribed', async () => {
    await seedEpisode(env.prisma, { slug: '2bobs', status: 'discovered' });
    const namer = fakeNamer([]);

    const result = await nameSpeakers(env.ctx, { namer }, { allPending: true });

    expect(result.named).toBe(0);
    expect(namer.prompts).toHaveLength(0);
  });

  it('calls nothing on a dry run', async () => {
    const id = await seedTranscribed();
    const namer = fakeNamer([]);

    await nameSpeakers(env.ctx, { namer }, { allPending: true, dryRun: true });

    expect(namer.prompts).toHaveLength(0);
    expect(await env.prisma.speakerMap.count({ where: { episodeId: id } })).toBe(0);
  });
});
