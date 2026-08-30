import { expect } from 'vitest';

/**
 * Asserts a call throws for the *right* reason.
 *
 * A bare `.toThrow()` was satisfied by the Phase 1 NotImplementedError scaffold,
 * so such a test sat green whether or not the engine was ever built. The guard
 * against that error name is kept deliberately: it costs nothing, and it stops
 * a future stub from quietly re-greening these tests.
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
