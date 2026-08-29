import { notImplemented } from './lib/notImplemented.js';

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

/** Reads .env plus process env. Keys are never logged or echoed. */
export function loadConfig(_opts?: { packageRoot?: string }): RadarConfig {
  return notImplemented('loadConfig');
}

/** Throws with a readable message naming the missing key, never its value. */
export function requireKey(_config: RadarConfig, _which: 'assemblyai' | 'anthropic'): string {
  return notImplemented('requireKey');
}
