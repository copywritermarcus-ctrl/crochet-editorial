import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, requireKey } from '../src/config.js';
import { DEFAULT_RATE_PER_HOUR } from '../src/lib/cost.js';
import { resolveDatabaseUrl } from '../src/lib/db.js';
import { expectThrows } from './helpers/expect.js';

let root: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config-'));
  for (const k of ['ASSEMBLYAI_API_KEY', 'ANTHROPIC_API_KEY', 'RATE_PER_HOUR', 'NAMING_MODEL', 'DATABASE_URL']) {
    delete process.env[k];
  }
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe('resolveDatabaseUrl', () => {
  it('resolves a relative file URL from the package root, not the cwd', () => {
    expect(resolveDatabaseUrl('file:./data/radar.db', '/opt/radar')).toBe('file:/opt/radar/data/radar.db');
  });

  it('leaves absolute and in-memory URLs alone', () => {
    expect(resolveDatabaseUrl('file:/var/db/radar.db', '/opt/radar')).toBe('file:/var/db/radar.db');
    expect(resolveDatabaseUrl('file::memory:', '/opt/radar')).toBe('file::memory:');
  });
});

describe('loadConfig', () => {
  it('falls back to documented defaults when nothing is set', () => {
    const config = loadConfig({ packageRoot: root });
    expect(config.ratePerHour).toBe(DEFAULT_RATE_PER_HOUR);
    expect(config.namingModel).toBeTruthy();
    expect(config.dataDir).toBe(path.join(root, 'data'));
    expect(config.rosterPath).toBe(path.join(root, 'roster.json'));
    expect(config.assemblyAiApiKey).toBeNull();
    expect(config.anthropicApiKey).toBeNull();
  });

  it('reads keys and overrides from the environment', () => {
    process.env.ASSEMBLYAI_API_KEY = 'aai-test';
    process.env.ANTHROPIC_API_KEY = 'ant-test';
    process.env.RATE_PER_HOUR = '0.25';

    const config = loadConfig({ packageRoot: root });

    expect(config.assemblyAiApiKey).toBe('aai-test');
    expect(config.anthropicApiKey).toBe('ant-test');
    expect(config.ratePerHour).toBe(0.25);
  });

  it('ignores a non-numeric rate rather than producing NaN costs', () => {
    process.env.RATE_PER_HOUR = 'free please';
    expect(loadConfig({ packageRoot: root }).ratePerHour).toBe(DEFAULT_RATE_PER_HOUR);
  });

  it('sends a realistic User-Agent so podcast CDNs do not reject the request', () => {
    const ua = loadConfig({ packageRoot: root }).userAgent;
    expect(ua.length).toBeGreaterThan(10);
    expect(ua).toMatch(/mozilla|radar/i);
  });
});

describe('requireKey', () => {
  it('returns the key when it is set', () => {
    process.env.ASSEMBLYAI_API_KEY = 'aai-test';
    expect(requireKey(loadConfig({ packageRoot: root }), 'assemblyai')).toBe('aai-test');
  });

  it('names the missing variable without echoing any value', () => {
    process.env.ANTHROPIC_API_KEY = 'ant-secret-value';
    const config = loadConfig({ packageRoot: root });

    let message = '';
    try {
      requireKey(config, 'assemblyai');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('ASSEMBLYAI_API_KEY');
    expect(message).not.toContain('ant-secret-value');
  });

  it('refuses to run a keyed stage with no key at all', () => {
    const config = loadConfig({ packageRoot: root });
    expectThrows(() => requireKey(config, 'anthropic'), /ANTHROPIC_API_KEY/);
  });
});
