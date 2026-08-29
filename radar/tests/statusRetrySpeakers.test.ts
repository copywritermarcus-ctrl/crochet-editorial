import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retry } from '../src/stages/retry.js';
import { setSpeaker } from '../src/stages/speakers.js';
import { renderStatus, status } from '../src/stages/status.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import {
  assemblyAiFixtureAsVendorTranscript,
  seedEpisode,
  seedShows,
  seedSpeakerMap,
  seedUtterances,
} from './helpers/seed.js';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedShows(env.prisma);
});

afterEach(async () => {
  await env.dispose();
});

describe('status', () => {
  it('counts episodes by status', async () => {
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'a', status: 'discovered' });
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'b', status: 'exported' });
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'c', status: 'exported' });
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'd', status: 'failed', errorMessage: 'HTTP 500' });

    const report = await status(env.ctx);

    expect(report.countsByStatus.discovered).toBe(1);
    expect(report.countsByStatus.exported).toBe(2);
    expect(report.countsByStatus.failed).toBe(1);
  });

  it('lists failed episodes with their error messages', async () => {
    await seedEpisode(env.prisma, {
      slug: '2bobs', guid: 'bad', title: 'A Bad One', status: 'failed', errorMessage: 'AssemblyAI: transcoding failed',
    });

    const report = await status(env.ctx);

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      showSlug: '2bobs', title: 'A Bad One', errorMessage: 'AssemblyAI: transcoding failed',
    });
  });

  it('lists speaker maps needing review', async () => {
    const id = await seedEpisode(env.prisma, { slug: '2bobs', status: 'exported' });
    await seedSpeakerMap(env.prisma, id, [
      { label: 'A', name: 'Blair Enns', role: 'host', confidence: 'high' },
      { label: 'B', name: 'Unknown speaker B', role: 'unknown', confidence: 'low', needsReview: true },
    ]);

    const report = await status(env.ctx);

    expect(report.needsReview).toHaveLength(1);
    expect(report.needsReview[0]).toMatchObject({ label: 'B', name: 'Unknown speaker B' });
  });

  it('returns the five most recent runs, newest first', async () => {
    for (let i = 0; i < 7; i += 1) {
      await env.prisma.runLog.create({
        data: {
          command: `run #${i}`,
          dryRun: false,
          startedAt: new Date(Date.UTC(2026, 7, 1 + i, 22, 0, 0)),
        },
      });
    }

    const report = await status(env.ctx);

    expect(report.recentRuns).toHaveLength(5);
    expect(report.recentRuns[0]!.command).toBe('run #6');
    expect(report.recentRuns[4]!.command).toBe('run #2');
  });

  it('renders a readable report on an empty database', async () => {
    const rendered = renderStatus(await status(env.ctx));
    expect(rendered).toBeTruthy();
    expect(rendered).not.toContain('undefined');
    expect(rendered).not.toContain('[object Object]');
  });

  it('renders failures and review flags in the report', async () => {
    const id = await seedEpisode(env.prisma, {
      slug: '2bobs', guid: 'bad', title: 'A Bad One', status: 'failed', errorMessage: 'HTTP 500',
    });
    await seedSpeakerMap(env.prisma, id, [
      { label: 'B', name: 'Unknown speaker B', role: 'unknown', confidence: 'low', needsReview: true },
    ]);

    const rendered = renderStatus(await status(env.ctx));

    expect(rendered).toContain('A Bad One');
    expect(rendered).toContain('HTTP 500');
    expect(rendered).toContain('Unknown speaker B');
  });
});

describe('retry', () => {
  it('resets a failed episode with utterances back to transcribed', async () => {
    const id = await seedEpisode(env.prisma, {
      slug: '2bobs', status: 'failed', errorMessage: 'naming returned malformed JSON', audioPath: '/tmp/x.mp3',
    });
    await seedUtterances(env.prisma, id, assemblyAiFixtureAsVendorTranscript().utterances);

    const result = await retry(env.ctx, { allFailed: true });

    expect(result.reset).toEqual([{ episodeId: id, from: 'failed', to: 'transcribed' }]);
    const ep = await env.prisma.episode.findUniqueOrThrow({ where: { id } });
    expect(ep.status).toBe('transcribed');
    expect(ep.errorMessage).toBeNull();
  });

  it('resets a failed episode with audio but no utterances back to fetched', async () => {
    const id = await seedEpisode(env.prisma, {
      slug: '2bobs', status: 'failed', errorMessage: 'AssemblyAI: transcoding failed', audioPath: '/tmp/x.mp3',
    });

    const result = await retry(env.ctx, { allFailed: true });

    expect(result.reset[0]!.to).toBe('fetched');
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('fetched');
  });

  it('resets a failed episode with nothing downloaded back to discovered', async () => {
    const id = await seedEpisode(env.prisma, { slug: '2bobs', status: 'failed', errorMessage: 'HTTP 404' });

    const result = await retry(env.ctx, { allFailed: true });

    expect(result.reset[0]!.to).toBe('discovered');
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('discovered');
  });

  it('leaves episodes that are not failed alone', async () => {
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'ok', status: 'exported' });

    const result = await retry(env.ctx, { allFailed: true });

    expect(result.reset).toEqual([]);
  });

  it('retries a single episode by id', async () => {
    const wanted = await seedEpisode(env.prisma, { slug: '2bobs', guid: 'one', status: 'failed', errorMessage: 'x' });
    await seedEpisode(env.prisma, { slug: '2bobs', guid: 'two', status: 'failed', errorMessage: 'y' });

    const result = await retry(env.ctx, { episodeId: wanted });

    expect(result.reset).toHaveLength(1);
    expect(result.reset[0]!.episodeId).toBe(wanted);
  });

  it('changes nothing on a dry run', async () => {
    const id = await seedEpisode(env.prisma, { slug: '2bobs', status: 'failed', errorMessage: 'x' });

    const result = await retry(env.ctx, { allFailed: true, dryRun: true });

    expect(result.reset).toHaveLength(1);
    expect((await env.prisma.episode.findUniqueOrThrow({ where: { id } })).status).toBe('failed');
  });
});

describe('setSpeaker', () => {
  async function seedExported(): Promise<string> {
    const id = await seedEpisode(env.prisma, { slug: '2bobs', status: 'exported', source: 'assemblyai' });
    await seedUtterances(env.prisma, id, assemblyAiFixtureAsVendorTranscript().utterances);
    await seedSpeakerMap(env.prisma, id, [
      { label: 'A', name: 'Blair Enns', role: 'host', confidence: 'high' },
      { label: 'B', name: 'Unknown speaker B', role: 'unknown', confidence: 'low', needsReview: true },
    ]);
    return id;
  }

  it('marks the row manual, clears the review flag and re-exports', async () => {
    const id = await seedExported();

    const result = await setSpeaker(env.ctx, { episodeId: id, label: 'B', name: 'David C. Baker', role: 'host' });

    const row = await env.prisma.speakerMap.findFirstOrThrow({ where: { episodeId: id, label: 'B' } });
    expect(row.name).toBe('David C. Baker');
    expect(row.role).toBe('host');
    expect(row.manual).toBe(true);
    expect(row.needsReview).toBe(false);

    expect(result.files.length).toBeGreaterThan(0);
    const md = env.read(path.join('exports', '2bobs', '2026-08-27-productization-again.md'));
    expect(md).toContain('David C. Baker');
    expect(md).toContain('Review flags: none');
    expect(md).not.toContain('Unknown speaker B');
  });

  it('defaults the role to guest when none is given', async () => {
    const id = await seedExported();

    const result = await setSpeaker(env.ctx, { episodeId: id, label: 'B', name: 'April Dunford' });

    expect(result.role).toBe('guest');
  });

  it('creates the row when the label was never mapped', async () => {
    const id = await seedExported();

    await setSpeaker(env.ctx, { episodeId: id, label: 'C', name: 'A Third Voice', role: 'guest' });

    expect(await env.prisma.speakerMap.count({ where: { episodeId: id } })).toBe(3);
  });

  it('rejects an unknown episode', async () => {
    await expect(
      setSpeaker(env.ctx, { episodeId: 'nope', label: 'A', name: 'X' }),
    ).rejects.toThrow(/nope|not found/i);
  });

  it('changes nothing on a dry run', async () => {
    const id = await seedExported();

    await setSpeaker(env.ctx, { episodeId: id, label: 'B', name: 'David C. Baker', dryRun: true });

    const row = await env.prisma.speakerMap.findFirstOrThrow({ where: { episodeId: id, label: 'B' } });
    expect(row.name).toBe('Unknown speaker B');
    expect(row.manual).toBe(false);
    expect(env.list(path.join('exports', '2bobs'))).toEqual([]);
  });
});
