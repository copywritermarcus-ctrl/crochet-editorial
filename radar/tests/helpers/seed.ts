import fs from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import type { VendorTranscript, VendorUtterance } from '../../src/types.js';
import { fixture } from './paths.js';

export interface RosterFixtureShow {
  slug: string;
  name: string;
  searchTerm: string;
  feedUrl: string | null;
  hosts: string[];
  region: string;
  lenses: string[];
  active: boolean;
  maxEpisodesPerRun: number;
  speakersExpected: number | null;
}

export function readRosterFixture(): { shows: RosterFixtureShow[] } {
  return JSON.parse(fs.readFileSync(fixture('roster.fixture.json'), 'utf8'));
}

/** Inserts Show rows straight from the roster fixture, bypassing `roster sync`. */
export async function seedShows(prisma: PrismaClient): Promise<void> {
  const roster = readRosterFixture();
  for (const s of roster.shows) {
    await prisma.show.create({
      data: {
        slug: s.slug,
        name: s.name,
        feedUrl: s.feedUrl,
        hosts: JSON.stringify(s.hosts),
        region: s.region,
        lenses: JSON.stringify(s.lenses),
        active: s.active,
        maxEpisodesPerRun: s.maxEpisodesPerRun,
        speakersExpected: s.speakersExpected,
      },
    });
  }
}

export async function showId(prisma: PrismaClient, slug: string): Promise<string> {
  const show = await prisma.show.findUniqueOrThrow({ where: { slug } });
  return show.id;
}

export interface SeedEpisodeInput {
  slug: string;
  guid?: string;
  title?: string;
  description?: string | null;
  publishedAt?: Date;
  durationSec?: number | null;
  audioUrl?: string;
  pageUrl?: string | null;
  providedTranscriptUrl?: string | null;
  providedTranscriptType?: string | null;
  providedTranscriptRefusedReason?: string | null;
  status?: string;
  source?: string | null;
  audioPath?: string | null;
  transcriptId?: string | null;
  estCostUsd?: number | null;
  errorMessage?: string | null;
}

/** The 2Bobs fixture episode the naming and export fixtures are built from. */
export const FIXTURE_EPISODE = {
  guid: '2bobs-ep-101',
  title: 'Productization (Again)',
  description:
    'Productization is a compression of something you already do well and repeatedly. ' +
    'David and Blair on why most firms package too early, and what that does to pricing.',
  publishedAt: new Date('2026-08-27T09:00:00.000Z'),
  durationSec: 1500,
  audioUrl: 'https://audio.example/2bobs/productization-again.mp3',
  pageUrl: 'https://2bobs.example/episodes/productization-again',
} as const;

export async function seedEpisode(
  prisma: PrismaClient,
  input: SeedEpisodeInput,
): Promise<string> {
  const id = await showId(prisma, input.slug);
  const ep = await prisma.episode.create({
    data: {
      showId: id,
      guid: input.guid ?? FIXTURE_EPISODE.guid,
      title: input.title ?? FIXTURE_EPISODE.title,
      description: input.description === undefined ? FIXTURE_EPISODE.description : input.description,
      publishedAt: input.publishedAt ?? FIXTURE_EPISODE.publishedAt,
      durationSec: input.durationSec === undefined ? FIXTURE_EPISODE.durationSec : input.durationSec,
      audioUrl: input.audioUrl ?? FIXTURE_EPISODE.audioUrl,
      pageUrl: input.pageUrl === undefined ? FIXTURE_EPISODE.pageUrl : input.pageUrl,
      providedTranscriptUrl: input.providedTranscriptUrl ?? null,
      providedTranscriptType: input.providedTranscriptType ?? null,
      providedTranscriptRefusedReason: input.providedTranscriptRefusedReason ?? null,
      status: input.status ?? 'discovered',
      source: input.source ?? null,
      audioPath: input.audioPath ?? null,
      transcriptId: input.transcriptId ?? null,
      estCostUsd: input.estCostUsd ?? null,
      errorMessage: input.errorMessage ?? null,
    },
  });
  return ep.id;
}

export function readAssemblyAiFixture(): {
  id: string;
  audio_duration: number;
  utterances: Array<{ speaker: string; start: number; end: number; text: string; confidence: number }>;
} {
  return JSON.parse(fs.readFileSync(fixture('assemblyai', 'response.fixture.json'), 'utf8'));
}

/** The AssemblyAI fixture mapped onto the vendor-neutral shape, for fake transcribers. */
export function assemblyAiFixtureAsVendorTranscript(): VendorTranscript {
  const raw = readAssemblyAiFixture();
  const utterances: VendorUtterance[] = raw.utterances.map((u) => ({
    speaker: u.speaker,
    start: u.start,
    end: u.end,
    text: u.text,
    confidence: u.confidence ?? null,
  }));
  return {
    id: raw.id,
    status: 'completed',
    audioDurationSec: raw.audio_duration,
    utterances,
    raw,
  };
}

/** Writes Utterance rows directly, for tests that start downstream of transcribe. */
export async function seedUtterances(
  prisma: PrismaClient,
  episodeId: string,
  utterances: VendorUtterance[],
): Promise<void> {
  await prisma.utterance.createMany({
    data: utterances.map((u, idx) => ({
      episodeId,
      idx,
      speakerLabel: u.speaker,
      startMs: u.start,
      endMs: u.end,
      text: u.text,
      confidence: u.confidence,
    })),
  });
}

export async function seedSpeakerMap(
  prisma: PrismaClient,
  episodeId: string,
  entries: Array<{
    label: string;
    name: string;
    role: string;
    confidence: string;
    needsReview?: boolean;
    manual?: boolean;
  }>,
): Promise<void> {
  for (const e of entries) {
    await prisma.speakerMap.create({
      data: {
        episodeId,
        label: e.label,
        name: e.name,
        role: e.role,
        confidence: e.confidence,
        needsReview: e.needsReview ?? false,
        manual: e.manual ?? false,
      },
    });
  }
}
