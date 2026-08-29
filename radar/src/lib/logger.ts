import type { Logger } from '../types.js';

/** Structured single-line JSON. Info/warn to stdout, error to stderr. */
export function createLogger(opts: { silent?: boolean } = {}): Logger {
  const emit = (stream: NodeJS.WriteStream, level: string, event: string, fields?: Record<string, unknown>) => {
    if (opts.silent) return;
    stream.write(`${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`);
  };
  return {
    info: (event, fields) => emit(process.stdout, 'info', event, fields),
    warn: (event, fields) => emit(process.stdout, 'warn', event, fields),
    error: (event, fields) => emit(process.stderr, 'error', event, fields),
  };
}

/** Collects log lines instead of writing them. Used by tests. */
export function createMemoryLogger(): Logger & { lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const push = (level: string, event: string, fields?: Record<string, unknown>) => {
    lines.push({ level, event, ...fields });
  };
  return {
    lines,
    info: (e, f) => push('info', e, f),
    warn: (e, f) => push('warn', e, f),
    error: (e, f) => push('error', e, f),
  };
}
