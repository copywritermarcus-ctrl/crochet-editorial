import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export const FIXTURES_DIR = path.join(PACKAGE_ROOT, 'fixtures');

/**
 * Where globalSetup leaves the migrated template database. A fixed path rather
 * than an env var, because globalSetup runs in the main vitest process and
 * fork workers do not reliably inherit mutations to its process.env.
 */
export const TEMPLATE_DB = path.join(
  PACKAGE_ROOT,
  'node_modules',
  '.cache',
  'radar-tests',
  'template.db',
);

export function fixture(...parts: string[]): string {
  return path.join(FIXTURES_DIR, ...parts);
}
