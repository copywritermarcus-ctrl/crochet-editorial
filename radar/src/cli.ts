import { notImplemented } from './lib/notImplemented.js';

/**
 * Wires commander to the stages and returns the process exit code.
 * Built in Phase 2. Kept as an exported function so tests can drive the CLI
 * without spawning a process.
 */
export function main(_argv: string[]): Promise<number> {
  return notImplemented('cli');
}
