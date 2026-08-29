import type { EpisodeStatus, SpeakerConfidence, SpeakerRole } from '../types.js';

export const EPISODE_STATUSES = [
  'discovered',
  'fetched',
  'transcribed',
  'named',
  'exported',
  'failed',
  'skipped',
] as const satisfies readonly EpisodeStatus[];

export const SPEAKER_ROLES = ['host', 'guest', 'unknown'] as const satisfies readonly SpeakerRole[];

export const SPEAKER_CONFIDENCES = [
  'high',
  'medium',
  'low',
] as const satisfies readonly SpeakerConfidence[];

export function isEpisodeStatus(v: unknown): v is EpisodeStatus {
  return typeof v === 'string' && (EPISODE_STATUSES as readonly string[]).includes(v);
}

export function assertEpisodeStatus(v: unknown): EpisodeStatus {
  if (!isEpisodeStatus(v)) throw new Error(`Not an episode status: ${String(v)}`);
  return v;
}

export function isSpeakerRole(v: unknown): v is SpeakerRole {
  return typeof v === 'string' && (SPEAKER_ROLES as readonly string[]).includes(v);
}

export function isSpeakerConfidence(v: unknown): v is SpeakerConfidence {
  return typeof v === 'string' && (SPEAKER_CONFIDENCES as readonly string[]).includes(v);
}
