import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { DEFAULT_NAMING_MODEL, DEFAULT_USER_AGENT } from '../src/config.js';
import type { RadarConfig } from '../src/config.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { seedShows } from './helpers/seed.js';

let env: TestEnv;
let config: RadarConfig;
let stdout: string[];
let stderr: string[];
let writeOut: ReturnType<typeof vi.spyOn>;
let writeErr: ReturnType<typeof vi.spyOn>;

/** A config with no API keys at all — the state of a fresh machine. */
function keylessConfig(): RadarConfig {
  return {
    databaseUrl: `file:${path.join(env.rootDir, 'radar.db')}`,
    dataDir: env.dataDir,
    rosterPath: path.join(env.rootDir, 'roster.json'),
    packageRoot: env.rootDir,
    ratePerHour: 0.17,
    namingModel: DEFAULT_NAMING_MODEL,
    assemblyAiApiKey: null,
    anthropicApiKey: null,
    userAgent: DEFAULT_USER_AGENT,
  };
}

async function runCli(args: string[]): Promise<number> {
  const exit = { code: 0 };
  const program = buildProgram(config, exit);
  program.exitOverride();
  await program.parseAsync(['node', 'radar', ...args]);
  return exit.code;
}

beforeEach(async () => {
  env = await createTestEnv();
  config = keylessConfig();
  stdout = [];
  stderr = [];
  writeOut = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  writeErr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  writeOut.mockRestore();
  writeErr.mockRestore();
  await env.dispose();
});

describe('cli', () => {
  it('runs status against an empty database without mentioning undefined', async () => {
    const code = await runCli(['status']);

    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('EPISODES BY STATUS');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('[object Object]');
  });

  it('emits parseable JSON under --json, with no log lines mixed in', async () => {
    const code = await runCli(['status', '--json']);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed).toHaveProperty('countsByStatus');
    expect(parsed).toHaveProperty('recentRuns');
  });

  it('rehearses a full run with --dry-run on a machine that has no API keys', async () => {
    await seedShows(env.prisma);

    const code = await runCli(['run', '--dry-run', '--since', '7']);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('dry run');
    const logs = await env.prisma.runLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.dryRun).toBe(true);
    expect(await env.prisma.episode.count()).toBe(0);
  });

  it('accepts the global flags before the subcommand too', async () => {
    const code = await runCli(['--json', 'status']);

    expect(code).toBe(0);
    expect(() => JSON.parse(stdout.join(''))).not.toThrow();
  });

  it('refuses a keyed stage with a message naming the variable, not a stack trace', async () => {
    await seedShows(env.prisma);
    await env.prisma.episode.create({
      data: {
        showId: (await env.prisma.show.findUniqueOrThrow({ where: { slug: '2bobs' } })).id,
        guid: 'needs-key',
        title: 'Needs A Key',
        publishedAt: new Date('2026-08-27T09:00:00Z'),
        durationSec: 600,
        audioUrl: 'https://audio.example/x.mp3',
        audioPath: '/tmp/x.mp3',
        status: 'fetched',
      },
    });

    await runCli(['transcribe', '--all-pending', '--max-minutes', '600']);

    // The stage records the failure per episode rather than crashing the run.
    const episode = await env.prisma.episode.findFirstOrThrow({ where: { guid: 'needs-key' } });
    expect(episode.status).toBe('failed');
    expect(episode.errorMessage).toContain('ASSEMBLYAI_API_KEY');
  });

  it('rejects a non-positive --max-minutes rather than transcribing uncapped', async () => {
    await expect(runCli(['transcribe', '--all-pending', '--max-minutes', '0'])).rejects.toThrow(
      /--max-minutes/,
    );
  });

  it('rejects an unknown --format', async () => {
    await expect(runCli(['export', '--all-named', '--format', 'pdf'])).rejects.toThrow(/--format/);
  });

  it('rejects an unknown roster action', async () => {
    await expect(runCli(['roster', 'destroy'])).rejects.toThrow(/roster sync/);
  });

  it('writes no export files on a dry run', async () => {
    await seedShows(env.prisma);
    await runCli(['run', '--dry-run']);
    expect(fs.existsSync(path.join(env.dataDir, 'exports'))).toBe(false);
  });
});
