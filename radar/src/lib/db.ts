import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

/**
 * Prisma 7 requires an explicit driver adapter. Relative `file:` URLs resolve
 * from the radar/ package root rather than the caller's cwd, so `radar` behaves
 * identically whether run by hand, by npm, or by launchd.
 */
export function resolveDatabaseUrl(url: string, packageRoot: string): string {
  if (!url.startsWith('file:')) return url;
  const filePath = url.slice('file:'.length);
  if (filePath === ':memory:' || path.isAbsolute(filePath)) return url;
  return `file:${path.resolve(packageRoot, filePath)}`;
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}
