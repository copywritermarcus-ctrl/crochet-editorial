import type { RadarContext, SpeakerRole } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export interface SetSpeakerOptions {
  episodeId: string;
  label: string;
  name: string;
  role?: SpeakerRole;
  dryRun?: boolean;
}

export interface SetSpeakerResult {
  episodeId: string;
  label: string;
  name: string;
  role: SpeakerRole;
  files: string[];
}

/** Sets manual = true, needsReview = false, then re-exports the episode. */
export function setSpeaker(
  _ctx: RadarContext,
  _opts: SetSpeakerOptions,
): Promise<SetSpeakerResult> {
  return notImplemented('setSpeaker');
}
