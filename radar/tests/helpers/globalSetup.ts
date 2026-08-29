import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, TEMPLATE_DB } from './paths.js';

/**
 * Migrations are expensive to run per test, so run them exactly once into a
 * template database. Each test copies that file, which is a few kilobytes.
 *
 * The template lives under node_modules/.cache so it is gitignored and never
 * pollutes data/.
 */
export async function setup(): Promise<void> {
  fs.rmSync(path.dirname(TEMPLATE_DB), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(TEMPLATE_DB), { recursive: true });

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${TEMPLATE_DB}` },
    stdio: 'pipe',
  });

  if (!fs.existsSync(TEMPLATE_DB)) {
    throw new Error(`prisma migrate deploy produced no database at ${TEMPLATE_DB}`);
  }
}

export async function teardown(): Promise<void> {
  fs.rmSync(path.dirname(TEMPLATE_DB), { recursive: true, force: true });
}
