import type { RadarContext } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export interface RunLogSummary {
  id: string;
  command: string;
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  discovered: number;
  imported: number;
  transcribed: number;
  named: number;
  exported: number;
  failed: number;
  skipped: number;
  minutesUsed: number;
  estCostUsd: number;
}

export interface StatusReport {
  countsByStatus: Record<string, number>;
  recentRuns: RunLogSummary[];
  failures: Array<{ episodeId: string; showSlug: string; title: string; errorMessage: string }>;
  needsReview: Array<{ episodeId: string; showSlug: string; title: string; label: string; name: string }>;
}

export function status(_ctx: RadarContext): Promise<StatusReport> {
  return notImplemented('status');
}

export function renderStatus(_report: StatusReport): string {
  return notImplemented('renderStatus');
}
