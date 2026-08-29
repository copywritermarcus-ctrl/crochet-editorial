import type { HttpClient } from '../clients/httpClient.js';
import type { RadarContext, VendorUtterance } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export interface ParsedProvidedTranscript {
  utterances: VendorUtterance[];
}

/**
 * Podcasting 2.0 JSON: segments carrying `speaker`, `startTime`, `endTime`,
 * `body`. Returns null when no segment carries speaker information — the
 * caller must then fall through to fetch + transcribe.
 */
export function parseProvidedJson(_body: string): ParsedProvidedTranscript | null {
  return notImplemented('parseProvidedJson');
}

/** VTT/SRT with `<v Name>` voice tags or `Name:` prefixes. Null when neither. */
export function parseProvidedVtt(_body: string): ParsedProvidedTranscript | null {
  return notImplemented('parseProvidedVtt');
}

export function parseProvidedTranscript(
  _body: string,
  _mimeType: string | null,
): ParsedProvidedTranscript | null {
  return notImplemented('parseProvidedTranscript');
}

export interface ImportOptions {
  episodeId?: string;
  allPending?: boolean;
  dryRun?: boolean;
}

export interface ImportResult {
  imported: number;
  failed: number;
  /** Episodes whose transcript carried no speaker info; now eligible for fetch. */
  refused: Array<{ episodeId: string; reason: string }>;
}

/**
 * On success: utterances persisted, source `provided`, estCostUsd 0, status
 * `transcribed`. On refusal: the reason is persisted to
 * Episode.providedTranscriptRefusedReason so a retry does not re-attempt a
 * known-bad import, and the episode stays `discovered` for `fetch`.
 */
export function importTranscript(
  _ctx: RadarContext,
  _deps: { http: HttpClient },
  _opts?: ImportOptions,
): Promise<ImportResult> {
  return notImplemented('importTranscript');
}
