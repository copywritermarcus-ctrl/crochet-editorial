import type { PrismaClient } from '@prisma/client';

/** Episode lifecycle. Enforced in code (src/lib/status.ts), not by a DB enum. */
export type EpisodeStatus =
  | 'discovered'
  | 'fetched'
  | 'transcribed'
  | 'named'
  | 'exported'
  | 'failed'
  | 'skipped';

export type TranscriptSource = 'assemblyai' | 'provided';
export type SpeakerRole = 'host' | 'guest' | 'unknown';
export type SpeakerConfidence = 'high' | 'medium' | 'low';
export type Region = 'UK' | 'EU' | 'US' | 'OTHER';

/** Single-line JSON to stdout; errors to stderr. */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/**
 * Everything a stage needs that is not a network client. `dataDir` is passed
 * rather than read from a global so tests can point each case at its own
 * throwaway directory.
 */
export interface RadarContext {
  prisma: PrismaClient;
  dataDir: string;
  logger: Logger;
  now: () => Date;
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

export interface FeedTranscript {
  url: string;
  type: string;
}

export interface FeedItem {
  guid: string;
  title: string;
  description: string | null;
  publishedAt: Date;
  durationSec: number | null;
  audioUrl: string | null;
  pageUrl: string | null;
  transcripts: FeedTranscript[];
}

export interface ParsedFeed {
  title: string | null;
  items: FeedItem[];
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export interface VendorUtterance {
  speaker: string;
  start: number; // ms
  end: number; // ms
  text: string;
  confidence: number | null;
}

export interface VendorTranscript {
  id: string;
  status: string;
  /** Seconds, as reported by the vendor. Null when the vendor omits it. */
  audioDurationSec: number | null;
  utterances: VendorUtterance[];
  /** The untouched vendor payload, persisted to data/raw/ for audit. */
  raw: unknown;
}

export interface TranscribeRequest {
  audioPath: string;
  speakersExpected: number | null;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export interface NamingUtterance {
  label: string;
  text: string;
}

/** Serialised verbatim into the prompt. Shape frozen by naming/input.fixture.json. */
export interface NamingRequest {
  show: { name: string; hosts: string[] };
  episode: { title: string; description: string };
  utterances: { head: NamingUtterance[]; tail: NamingUtterance[] };
}

export interface SpeakerMapEntry {
  label: string;
  name: string;
  role: SpeakerRole;
  confidence: SpeakerConfidence;
}

export interface SpeakerMapResult {
  speakers: SpeakerMapEntry[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportTurn {
  label: string;
  name: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface ExportBundle {
  episode: {
    id: string;
    showSlug: string;
    showName: string;
    title: string;
    publishedAt: string;
    durationSec: number | null;
    source: TranscriptSource | null;
    url: string;
  };
  speakers: SpeakerMapEntry[];
  reviewFlags: string[];
  turns: ExportTurn[];
}

// ---------------------------------------------------------------------------
// Run accounting
// ---------------------------------------------------------------------------

export interface RunCounts {
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
