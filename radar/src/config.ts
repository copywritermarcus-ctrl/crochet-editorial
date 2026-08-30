import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DEFAULT_RATE_PER_HOUR } from './lib/cost.js';

/**
 * Naming model. Verified against docs 2026-08-29 (platform.claude.com models
 * overview): Claude Haiku 4.5 is the current Haiku-class model; its Claude API
 * ID is the pinned snapshot `claude-haiku-4-5-20251001`, with `claude-haiku-4-5`
 * as the alias. The pinned snapshot is used deliberately, so a future alias
 * repoint cannot silently change naming behaviour mid-season.
 */
export const DEFAULT_NAMING_MODEL = 'claude-haiku-4-5-20251001';

/** Podcast CDNs reject unknown clients, so present as a normal browser. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/128.0.0.0 Safari/537.36 Radar/1.0';

export interface RadarConfig {
  databaseUrl: string;
  dataDir: string;
  rosterPath: string;
  packageRoot: string;
  ratePerHour: number;
  namingModel: string;
  assemblyAiApiKey: string | null;
  anthropicApiKey: string | null;
  userAgent: string;
}

function defaultPackageRoot(): string {
  // src/config.ts -> src -> package root. Works from dist/ too, since the
  // compiled layout keeps the same one-level nesting.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmpty(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reads radar/.env plus process env. Values already in the environment win, so
 * launchd or a shell export can override the file. Keys are never logged.
 */
export function loadConfig(opts: { packageRoot?: string } = {}): RadarConfig {
  const packageRoot = opts.packageRoot ?? defaultPackageRoot();

  const envPath = path.join(packageRoot, '.env');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });

  const rawDatabaseUrl = process.env.DATABASE_URL ?? 'file:./data/radar.db';

  return {
    databaseUrl: rawDatabaseUrl,
    dataDir: path.join(packageRoot, 'data'),
    rosterPath: path.join(packageRoot, 'roster.json'),
    packageRoot,
    ratePerHour: positiveNumber(process.env.RATE_PER_HOUR, DEFAULT_RATE_PER_HOUR),
    namingModel: nonEmpty(process.env.NAMING_MODEL) ?? DEFAULT_NAMING_MODEL,
    assemblyAiApiKey: nonEmpty(process.env.ASSEMBLYAI_API_KEY),
    anthropicApiKey: nonEmpty(process.env.ANTHROPIC_API_KEY),
    userAgent: nonEmpty(process.env.RADAR_USER_AGENT) ?? DEFAULT_USER_AGENT,
  };
}

const KEY_ENV_NAMES = {
  assemblyai: 'ASSEMBLYAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const;

/** Throws naming the missing variable, never its value. */
export function requireKey(config: RadarConfig, which: 'assemblyai' | 'anthropic'): string {
  const key = which === 'assemblyai' ? config.assemblyAiApiKey : config.anthropicApiKey;
  if (!key) {
    throw new Error(
      `${KEY_ENV_NAMES[which]} is not set. Add it to ${path.join(config.packageRoot, '.env')} ` +
        `(see .env.example). Radar never logs or prints key values.`,
    );
  }
  return key;
}
