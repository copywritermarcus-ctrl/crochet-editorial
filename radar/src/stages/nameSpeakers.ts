import type { Namer } from '../clients/namer.js';
import type { NamingRequest, RadarContext, SpeakerMapResult } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export const NAMING_HEAD_UTTERANCES = 40;
export const NAMING_TAIL_UTTERANCES = 10;
export const NAMING_DESCRIPTION_LIMIT = 1500;

/**
 * Builds the request exactly as frozen in fixtures/naming/input.fixture.json.
 * `tail` excludes anything already present in `head`, so a short episode never
 * sends the same utterance twice.
 */
export function buildNamingRequest(_input: {
  showName: string;
  hosts: string[];
  title: string;
  description: string | null;
  utterances: Array<{ speakerLabel: string; text: string }>;
}): NamingRequest {
  return notImplemented('buildNamingRequest');
}

export function buildNamingPrompt(_request: NamingRequest, _validationError?: string): string {
  return notImplemented('buildNamingPrompt');
}

/** Strict parse and validate. Throws with a readable reason used by the retry. */
export function parseSpeakerMapResponse(
  _raw: string,
  _expectedLabels: string[],
): SpeakerMapResult {
  return notImplemented('parseSpeakerMapResponse');
}

export interface NameOptions {
  episodeId?: string;
  allPending?: boolean;
  dryRun?: boolean;
}

export interface NameResult {
  named: number;
  failed: number;
  needsReview: Array<{ episodeId: string; label: string }>;
}

/**
 * One call per episode; on malformed output, one retry with the validation
 * error appended; a second failure marks the episode `failed`. Rows with
 * `manual = true` are never overwritten.
 */
export function nameSpeakers(
  _ctx: RadarContext,
  _deps: { namer: Namer },
  _opts?: NameOptions,
): Promise<NameResult> {
  return notImplemented('nameSpeakers');
}
