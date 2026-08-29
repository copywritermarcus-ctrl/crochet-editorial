import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../src/lib/db.js';
import { createMemoryLogger } from '../../src/lib/logger.js';
import type { Logger, RadarContext } from '../../src/types.js';
import { TEMPLATE_DB } from './paths.js';

export interface TestEnv {
  prisma: PrismaClient;
  ctx: RadarContext;
  dataDir: string;
  rootDir: string;
  logger: Logger & { lines: Array<Record<string, unknown>> };
  /** The clock every stage reads. Fixed so window arithmetic is deterministic. */
  now: Date;
  dispose(): Promise<void>;
  read(relativePath: string): string;
  exists(relativePath: string): boolean;
  list(relativeDir: string): string[];
}

/** The instant every time-sensitive fixture is anchored to. */
export const FIXED_NOW = new Date('2026-08-29T12:00:00.000Z');

/**
 * A throwaway database and data directory per test. The migrated template is
 * copied rather than re-migrated, so setup is a file copy.
 */
export async function createTestEnv(opts: { now?: Date } = {}): Promise<TestEnv> {
  if (!fs.existsSync(TEMPLATE_DB)) {
    throw new Error(
      `Template database missing at ${TEMPLATE_DB}. globalSetup should have created it.`,
    );
  }

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));
  const dbPath = path.join(rootDir, 'radar.db');
  fs.copyFileSync(TEMPLATE_DB, dbPath);

  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const prisma = createPrismaClient(`file:${dbPath}`);
  const logger = createMemoryLogger();
  const now = opts.now ?? FIXED_NOW;

  const ctx: RadarContext = { prisma, dataDir, logger, now: () => now };

  return {
    prisma,
    ctx,
    dataDir,
    rootDir,
    logger,
    now,
    async dispose() {
      await prisma.$disconnect().catch(() => undefined);
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
    read(relativePath: string) {
      return fs.readFileSync(path.join(dataDir, relativePath), 'utf8');
    },
    exists(relativePath: string) {
      return fs.existsSync(path.join(dataDir, relativePath));
    },
    list(relativeDir: string) {
      const dir = path.join(dataDir, relativeDir);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).sort();
    },
  };
}
