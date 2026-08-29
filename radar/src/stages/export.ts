import type { ExportBundle, ExportTurn, RadarContext } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export type ExportFormat = 'md' | 'json' | 'both';

/** Merges consecutive utterances from the same speaker; timestamp is the first. */
export function mergeTurns(
  _utterances: Array<{ speakerLabel: string; startMs: number; endMs: number; text: string }>,
  _names: Map<string, string>,
): ExportTurn[] {
  return notImplemented('mergeTurns');
}

export function renderMarkdown(_bundle: ExportBundle): string {
  return notImplemented('renderMarkdown');
}

export function renderJson(_bundle: ExportBundle): string {
  return notImplemented('renderJson');
}

export interface ExportOptions {
  episodeId?: string;
  allNamed?: boolean;
  format?: ExportFormat;
  dryRun?: boolean;
}

export interface ExportResult {
  exported: number;
  failed: number;
  files: string[];
}

/** Writes data/exports/<show-slug>/<yyyy-mm-dd>-<episode-slug>.{md,json}. */
export function exportEpisodes(
  _ctx: RadarContext,
  _opts?: ExportOptions,
): Promise<ExportResult> {
  return notImplemented('exportEpisodes');
}
