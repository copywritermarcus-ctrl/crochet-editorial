import { expect } from 'vitest';

/**
 * Asserts a call throws for the *right* reason.
 *
 * A bare `.toThrow()` is satisfied by the Phase 1 NotImplementedError, which
 * means such a test would sit green whether or not the engine was ever built.
 * This rejects that specific error explicitly, so every negative-path test
 * stays red until real validation exists behind it.
 */
export function expectThrows(fn: () => unknown, pattern: RegExp): void {
  let thrown: unknown;
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    thrown = err;
  }

  expect(threw, 'expected the call to throw').toBe(true);
  expect(thrown).toBeInstanceOf(Error);
  expect(
    (thrown as Error).name,
    'a NotImplementedError does not count as validation',
  ).not.toBe('NotImplementedError');
  expect((thrown as Error).message).toMatch(pattern);
}
