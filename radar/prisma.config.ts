import path from 'node:path';
import { defineConfig } from 'prisma/config';
import 'dotenv/config';

/**
 * Prisma 7 moves the Migrate connection URL out of schema.prisma and into this
 * file. Relative SQLite paths in DATABASE_URL resolve from the radar/ package
 * root, not from the caller's cwd, so that `radar` behaves the same whether it
 * is run by hand or by launchd.
 */
const packageRoot = import.meta.dirname;

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? 'file:./data/radar.db';
  if (!raw.startsWith('file:')) return raw;
  const filePath = raw.slice('file:'.length);
  if (path.isAbsolute(filePath)) return raw;
  return `file:${path.resolve(packageRoot, filePath)}`;
}

export default defineConfig({
  schema: path.join(packageRoot, 'prisma', 'schema.prisma'),
  migrations: { path: path.join(packageRoot, 'prisma', 'migrations') },
  datasource: { url: resolveDatabaseUrl() },
});
