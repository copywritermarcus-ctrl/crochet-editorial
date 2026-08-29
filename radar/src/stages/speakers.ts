import type { RadarContext, SpeakerRole } from '../types.js';
import { exportEpisodes } from './export.js';

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
export async function setSpeaker(
  ctx: RadarContext,
  opts: SetSpeakerOptions,
): Promise<SetSpeakerResult> {
  const episode = await ctx.prisma.episode.findUnique({ where: { id: opts.episodeId } });
  if (!episode) throw new Error(`Episode not found: ${opts.episodeId}`);

  // A human naming a speaker is almost always naming a guest; hosts come from
  // the roster and are usually right already.
  const role: SpeakerRole = opts.role ?? 'guest';

  if (opts.dryRun) {
    return { episodeId: opts.episodeId, label: opts.label, name: opts.name, role, files: [] };
  }

  const data = { name: opts.name, role, confidence: 'high', needsReview: false, manual: true };
  await ctx.prisma.speakerMap.upsert({
    where: { episodeId_label: { episodeId: opts.episodeId, label: opts.label } },
    create: { episodeId: opts.episodeId, label: opts.label, ...data },
    update: data,
  });
  ctx.logger.info('speakers.set', { episodeId: opts.episodeId, label: opts.label, role });

  const exported = await exportEpisodes(ctx, { episodeId: opts.episodeId });
  return { episodeId: opts.episodeId, label: opts.label, name: opts.name, role, files: exported.files };
}
