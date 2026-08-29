import { Command } from 'commander';
import { createAudioClient } from './clients/audioClient.js';
import { createRssFeedClient } from './clients/feedClient.js';
import { createHttpClient } from './clients/httpClient.js';
import { createAnthropicNamer, type Namer } from './clients/namer.js';
import { createAssemblyAiTranscriber, type Transcriber } from './clients/transcriber.js';
import { loadConfig, requireKey, type RadarConfig } from './config.js';
import { createPrismaClient, resolveDatabaseUrl } from './lib/db.js';
import { createLogger } from './lib/logger.js';
import { isSpeakerRole } from './lib/status.js';
import { syncRoster } from './roster.js';
import { exportEpisodes, type ExportFormat } from './stages/export.js';
import { fetchAudio } from './stages/fetch.js';
import { importTranscript } from './stages/importTranscript.js';
import { nameSpeakers } from './stages/nameSpeakers.js';
import { poll } from './stages/poll.js';
import { retry } from './stages/retry.js';
import { renderRunSummary, run } from './stages/run.js';
import { setSpeaker } from './stages/speakers.js';
import { renderStatus, status } from './stages/status.js';
import { transcribe } from './stages/transcribe.js';
import type { RadarContext, SpeakerRole } from './types.js';

interface GlobalOptions {
  json?: boolean;
  dryRun?: boolean;
}

/**
 * Keys are resolved on first use, not at wiring time. A --dry-run makes no
 * vendor calls, so it must rehearse the whole pipeline on a machine that has no
 * keys at all — which is exactly the machine you check the plumbing on before
 * you put keys anywhere near it.
 */
function lazyTranscriber(config: RadarConfig): Transcriber {
  let inner: Transcriber | null = null;
  return {
    transcribe(req) {
      inner ??= createAssemblyAiTranscriber({ apiKey: requireKey(config, 'assemblyai') });
      return inner.transcribe(req);
    },
  };
}

function lazyNamer(config: RadarConfig): Namer {
  let inner: Namer | null = null;
  return {
    complete(prompt) {
      inner ??= createAnthropicNamer({
        apiKey: requireKey(config, 'anthropic'),
        model: config.namingModel,
      });
      return inner.complete(prompt);
    },
  };
}

/** Builds a context and guarantees the Prisma connection is released. */
async function withContext<T>(
  config: RadarConfig,
  opts: GlobalOptions,
  fn: (ctx: RadarContext) => Promise<T>,
): Promise<T> {
  const prisma = createPrismaClient(resolveDatabaseUrl(config.databaseUrl, config.packageRoot));
  // On --json the log stream would corrupt the payload, so silence it.
  const logger = createLogger({ silent: opts.json === true });
  const ctx: RadarContext = { prisma, dataDir: config.dataDir, logger, now: () => new Date() };
  try {
    return await fn(ctx);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

function emit(opts: GlobalOptions, payload: unknown, human: string): void {
  process.stdout.write(opts.json ? `${JSON.stringify(payload, null, 2)}\n` : `${human}\n`);
}

function integer(name: string) {
  return (raw: string): number => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number, got "${raw}"`);
    }
    return value;
  };
}

export function buildProgram(config: RadarConfig, exit: { code: number }): Command {
  const program = new Command();
  program
    .name('radar')
    .description('Podcast transcript pipeline: feeds to speaker-named, timestamped transcripts.')
    .option('--json', 'machine-readable output')
    .option('--dry-run', 'report what would happen; write nothing');

  /**
   * --dry-run and --json are accepted both before and after the subcommand,
   * because "radar run --dry-run" is the form the brief and muscle memory use.
   */
  const globals = (command: Command): GlobalOptions => {
    const top = program.opts<GlobalOptions>();
    const sub = command.opts() as GlobalOptions;
    return { json: sub.json ?? top.json, dryRun: sub.dryRun ?? top.dryRun };
  };

  const sub = (name: string): Command =>
    program
      .command(name)
      .option('--json', 'machine-readable output')
      .option('--dry-run', 'report what would happen; write nothing');

  sub('roster')
    .argument('<action>', 'only "sync" is supported')
    .option('--force', 're-resolve feed URLs that are already set')
    .action(async (action: string, cmdOpts: { force?: boolean }, command: Command) => {
      if (action !== 'sync') throw new Error(`Unknown roster action "${action}". Try: radar roster sync`);
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const http = createHttpClient({ userAgent: config.userAgent });
        const result = await syncRoster(ctx, { http, rosterPath: config.rosterPath }, {
          force: cmdOpts.force,
          dryRun: g.dryRun,
        });
        emit(
          g,
          result,
          [
            `Resolved ${result.resolved.length}, unchanged ${result.unchanged.length}, unresolved ${result.unresolved.length}.`,
            ...result.resolved.map((r) => `  + ${r.name}\n      ${r.feedUrl}`),
            ...result.unresolved.map((r) => `  ! ${r.name}: ${r.reason}`),
            '',
            'Review the resolved feed URLs before the first live run.',
          ].join('\n'),
        );
      });
    });

  sub('poll')
    .option('--since <days>', 'how far back to look', integer('--since'), 7)
    .option('--show <slug>', 'limit to one show')
    .option('--include-inactive', 'also poll shows marked inactive')
    .action(async (cmdOpts: { since: number; show?: string; includeInactive?: boolean }, command: Command) => {
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const result = await poll(ctx, { feedClient: createRssFeedClient({ userAgent: config.userAgent }) }, {
          sinceDays: cmdOpts.since,
          showSlug: cmdOpts.show,
          includeInactive: cmdOpts.includeInactive,
          dryRun: g.dryRun,
        });
        emit(
          g,
          result,
          [
            `Discovered ${result.discovered} episode(s).`,
            ...result.perShow.map((s) => `  ${s.slug}: ${s.discovered} new of ${s.considered} considered`),
            ...result.warnings.map((w) => `  ! ${w}`),
          ].join('\n'),
        );
      });
    });

  sub('fetch')
    .option('--episode <id>', 'a single episode')
    .option('--all-pending', 'every discovered episode')
    .action(async (cmdOpts: { episode?: string; allPending?: boolean }, command: Command) => {
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const result = await fetchAudio(ctx, { audioClient: createAudioClient({ userAgent: config.userAgent }) }, {
          episodeId: cmdOpts.episode,
          allPending: cmdOpts.allPending,
          dryRun: g.dryRun,
        });
        if (result.failed > 0) exit.code = 1;
        emit(
          g,
          result,
          `Fetched ${result.fetched}, failed ${result.failed}, deferred to import ${result.deferredToImport.length}.`,
        );
      });
    });

  sub('import')
    .option('--episode <id>', 'a single episode')
    .option('--all-pending', 'every episode with a provided transcript')
    .action(async (cmdOpts: { episode?: string; allPending?: boolean }, command: Command) => {
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const result = await importTranscript(ctx, { http: createHttpClient({ userAgent: config.userAgent }) }, {
          episodeId: cmdOpts.episode,
          allPending: cmdOpts.allPending,
          dryRun: g.dryRun,
        });
        if (result.failed > 0) exit.code = 1;
        emit(
          g,
          result,
          `Imported ${result.imported}, refused ${result.refused.length} (no speaker info), failed ${result.failed}.`,
        );
      });
    });

  sub('transcribe')
    .option('--episode <id>', 'a single episode')
    .option('--all-pending', 'every fetched episode')
    .option('--max-minutes <n>', 'mandatory spend cap', integer('--max-minutes'), 600)
    .action(async (cmdOpts: { episode?: string; allPending?: boolean; maxMinutes: number }, command: Command) => {
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const result = await transcribe(ctx, { transcriber: lazyTranscriber(config) }, {
          episodeId: cmdOpts.episode,
          allPending: cmdOpts.allPending,
          maxMinutes: cmdOpts.maxMinutes,
          ratePerHour: config.ratePerHour,
          dryRun: g.dryRun,
        });
        if (result.failed > 0) exit.code = 1;
        emit(
          g,
          result,
          `Transcribed ${result.transcribed}, skipped ${result.skipped.length} (cap), failed ${result.failed}. ` +
            `${result.minutesUsed.toFixed(1)} minutes, $${result.estCostUsd.toFixed(4)} estimated.`,
        );
      });
    });

  sub('name')
    .option('--episode <id>', 'a single episode')
    .option('--all-pending', 'every transcribed episode')
    .action(async (cmdOpts: { episode?: string; allPending?: boolean }, command: Command) => {
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const result = await nameSpeakers(ctx, { namer: lazyNamer(config) }, {
          episodeId: cmdOpts.episode,
          allPending: cmdOpts.allPending,
          dryRun: g.dryRun,
        });
        if (result.failed > 0) exit.code = 1;
        emit(g, result, `Named ${result.named}, failed ${result.failed}, needing review ${result.needsReview.length}.`);
      });
    });

  sub('export')
    .option('--episode <id>', 'a single episode')
    .option('--all-named', 'every named episode')
    .option('--format <format>', 'md, json or both', 'both')
    .action(async (cmdOpts: { episode?: string; allNamed?: boolean; format: string }, command: Command) => {
      const g = globals(command);
      if (!['md', 'json', 'both'].includes(cmdOpts.format)) {
        throw new Error(`--format must be md, json or both, got "${cmdOpts.format}"`);
      }
      await withContext(config, g, async (ctx) => {
        const result = await exportEpisodes(ctx, {
          episodeId: cmdOpts.episode,
          allNamed: cmdOpts.allNamed,
          format: cmdOpts.format as ExportFormat,
          dryRun: g.dryRun,
        });
        if (result.failed > 0) exit.code = 1;
        emit(g, result, `Exported ${result.exported}, failed ${result.failed}.`);
      });
    });

  sub('run')
    .option('--since <days>', 'how far back to look', integer('--since'), 7)
    .option('--max-minutes <n>', 'mandatory spend cap', integer('--max-minutes'), 600)
    .option('--show <slug>', 'limit to one show')
    .action(async (cmdOpts: { since: number; maxMinutes: number; show?: string }, command: Command) => {
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const summary = await run(
          ctx,
          {
            feedClient: createRssFeedClient({ userAgent: config.userAgent }),
            audioClient: createAudioClient({ userAgent: config.userAgent }),
            http: createHttpClient({ userAgent: config.userAgent }),
            transcriber: lazyTranscriber(config),
            namer: lazyNamer(config),
          },
          {
            sinceDays: cmdOpts.since,
            maxMinutes: cmdOpts.maxMinutes,
            ratePerHour: config.ratePerHour,
            showSlug: cmdOpts.show,
            dryRun: g.dryRun,
          },
        );
        exit.code = summary.exitCode;
        emit(g, summary, renderRunSummary(summary, g.dryRun === true));
      });
    });

  sub('status').action(async (_cmdOpts: unknown, command: Command) => {
    const g = globals(command);
    await withContext(config, g, async (ctx) => {
      const report = await status(ctx);
      emit(g, report, renderStatus(report));
    });
  });

  sub('retry')
    .option('--episode <id>', 'a single episode')
    .option('--all-failed', 'every failed episode')
    .action(async (cmdOpts: { episode?: string; allFailed?: boolean }, command: Command) => {
      const g = globals(command);
      await withContext(config, g, async (ctx) => {
        const result = await retry(ctx, {
          episodeId: cmdOpts.episode,
          allFailed: cmdOpts.allFailed,
          dryRun: g.dryRun,
        });
        emit(
          g,
          result,
          [
            `Reset ${result.reset.length} episode(s).`,
            ...result.reset.map((r) => `  ${r.episodeId}: ${r.from} -> ${r.to}`),
          ].join('\n'),
        );
      });
    });

  sub('speakers')
    .argument('<action>', 'only "set" is supported')
    .argument('<episodeId>')
    .argument('<label>')
    .argument('<name>')
    .option('--role <role>', 'host, guest or unknown', 'guest')
    .action(
      async (
        action: string,
        episodeId: string,
        label: string,
        name: string,
        cmdOpts: { role: string },
        command: Command,
      ) => {
        if (action !== 'set') throw new Error(`Unknown speakers action "${action}". Try: radar speakers set ...`);
        if (!isSpeakerRole(cmdOpts.role)) {
          throw new Error(`--role must be host, guest or unknown, got "${cmdOpts.role}"`);
        }
        const g = globals(command);
        await withContext(config, g, async (ctx) => {
          const result = await setSpeaker(ctx, {
            episodeId,
            label,
            name,
            role: cmdOpts.role as SpeakerRole,
            dryRun: g.dryRun,
          });
          emit(
            g,
            result,
            [
              `${label} = ${name} (${result.role}), marked manual.`,
              ...result.files.map((f) => `  rewrote ${f}`),
            ].join('\n'),
          );
        });
      },
    );

  return program;
}

/** Wires commander to the stages and returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const config = loadConfig();
  const exit = { code: 0 };
  const program = buildProgram(config, exit);
  program.exitOverride();

  try {
    await program.parseAsync(argv);
    return exit.code;
  } catch (err) {
    // commander throws for --help and --version; those are not failures.
    const code = (err as { code?: string }).code;
    if (code === 'commander.helpDisplayed' || code === 'commander.help' || code === 'commander.version') {
      return 0;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'cli.error', message })}\n`,
    );
    return 1;
  }
}
