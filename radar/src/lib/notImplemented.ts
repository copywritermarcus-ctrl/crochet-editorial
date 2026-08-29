/**
 * Phase 1 marker. Every stage below is a typed skeleton so the test suite is
 * wired and executable before the engine exists; Phase 2 replaces each throw
 * with a real implementation. A green suite therefore proves the engine runs,
 * not merely that the modules import.
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}

export function notImplemented(what: string): never {
  throw new NotImplementedError(what);
}
