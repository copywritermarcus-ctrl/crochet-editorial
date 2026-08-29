import { notImplemented } from '../lib/notImplemented.js';

/**
 * Deliberately dumb: takes a fully-built prompt, returns the model's raw text.
 * Parsing, validation and the single retry all live in the naming stage, so
 * tests can drive both by handing back a canned string.
 */
export interface Namer {
  complete(prompt: string): Promise<string>;
}

export function createAnthropicNamer(_opts: { apiKey: string; model: string }): Namer {
  return notImplemented('createAnthropicNamer');
}
