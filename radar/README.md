# Radar

Turns a roster of podcast RSS feeds into speaker-named, timestamped transcripts
stored locally, with Markdown and JSON exports. Runs weekly on the Mac Mini
under launchd.

Radar stops at the transcript. Relevance triage, insight extraction and the
Monday email are a later brief.

---

## Setup

```bash
cd radar
npm install
cp .env.example .env      # then fill in the two keys
npx prisma migrate deploy # creates data/radar.db
npm run build             # produces dist/, which launchd runs
```

`.env` holds:

| Variable | What it is |
|---|---|
| `ASSEMBLYAI_API_KEY` | Transcription. https://www.assemblyai.com/app/account |
| `ANTHROPIC_API_KEY` | Speaker naming. https://console.anthropic.com/settings/keys |
| `DATABASE_URL` | Defaults to `file:./data/radar.db`. Relative paths resolve from `radar/`. |
| `RATE_PER_HOUR` | AssemblyAI's rate per audio hour, for cost estimates. Default `0.17`. |
| `NAMING_MODEL` | Default `claude-haiku-4-5-20251001`. |

`.env` and `data/` are gitignored. Radar never logs or prints a key value; if a
key is missing, the error names the variable and nothing else.

---

## Running it

Everything runs from `radar/`. Use `npm run radar -- <command>` in development
(runs TypeScript directly), or `node dist/bin.js <command>` against a build.

Every command takes `--dry-run` (report, write nothing) and `--json`.

| Command | What it does |
|---|---|
| `radar roster sync` | Resolves missing feed URLs from `roster.json` via Apple's podcast search and writes them back. `--force` re-resolves URLs already set. |
| `radar poll --since 7` | Finds new episodes. `--show <slug>` for one show, `--include-inactive` for the cherry-pick tier. |
| `radar fetch --all-pending` | Downloads audio to `data/audio/`. Skips episodes with a usable feed transcript. |
| `radar import --all-pending` | Imports a feed-provided transcript instead of paying to transcribe. |
| `radar transcribe --all-pending --max-minutes 600` | Diarised transcription via AssemblyAI. The cap is mandatory. |
| `radar name --all-pending` | Maps speaker labels to real names. |
| `radar export --all-named` | Writes `data/exports/<show>/<date>-<title>.{md,json}`. |
| `radar run --since 8 --max-minutes 600` | All of the above, one RunLog row, a one-screen summary. |
| `radar status` | Counts by status, last five runs, failures, speakers needing review. |
| `radar retry --all-failed` | Resets failed episodes to their last good status. |
| `radar speakers set <episodeId> <label> "<name>" --role guest` | Manual override, then re-exports. |

### The weekly run

`radar run` does: poll, then for each episode either import a provided
transcript or fetch + transcribe, then name, then export. Import is tried
first because a feed transcript costs nothing. If that transcript turns out to
carry no speaker information, Radar records why and falls through to fetch and
transcribe **in the same run**, not the next one.

Re-running is always safe. Episodes are keyed on `(show, guid)`, utterances are
replaced rather than appended, and an episode already transcribed is never
transcribed again. A second `radar run` straight after the first discovers
nothing and spends nothing.

---

## Editing the roster

`roster.json` is the source of truth for shows. After editing it, run
`radar roster sync` to push changes into the database.

```json
{
  "slug": "2bobs",
  "name": "2Bobs",
  "searchTerm": "2Bobs Enns Baker",
  "feedUrl": null,
  "hosts": ["David C. Baker", "Blair Enns"],
  "region": "US",
  "lenses": ["business-of-expertise"],
  "active": true,
  "maxEpisodesPerRun": 2,
  "speakersExpected": 2
}
```

- `feedUrl` starts `null` and is filled in by `roster sync`. Review the
  resolved URLs once; after that they are treated as fixed.
- `active: false` shows are skipped by `poll` unless `--include-inactive`.
- `speakersExpected` is the diarisation hint. It is **per-show configuration,
  not a formula**: an interview show is hosts + 1, a no-guest panel show is
  hosts. 2Bobs is 2, not 3.
- `"formatGuess": true` marks a `speakersExpected` value nobody has verified
  against a real episode yet. Eleven of the fourteen shows carry it. When a
  smoke run shows the speakers mis-split, **correct the roster and re-run** —
  never hand-patch the export.
- `lenses` is stored but unused; a later brief reads it.

---

## Reading `radar status`

Four blocks: counts by status, the last five runs with their spend, failed
episodes with the actual error message, and speaker maps flagged for review.
The failure and review blocks print the exact command to fix each one.

Episode statuses run `discovered` → `fetched` → `transcribed` → `named` →
`exported`, with `failed` and `skipped` off to the side. `skipped` means the
minute cap deferred it; the next run picks it up automatically.

## Fixing a speaker name

`radar status` lists anything the model was unsure of, with the command:

```bash
npm run radar -- speakers set <episodeId> B "April Dunford" --role guest
```

This marks the row `manual`, clears the review flag, and re-exports the episode
straight away. **A manual row is never overwritten by a later naming run** — so
correcting a name makes it stick, permanently.

## Costs

Every transcription records `estCostUsd` on the episode, and each run totals it
into the RunLog row. `radar status` prints the last five runs' spend. These are
estimates from `RATE_PER_HOUR` × audio duration; reconcile against the
AssemblyAI dashboard after the first few runs and adjust `RATE_PER_HOUR` in
`.env` if it drifts.

The `--max-minutes` cap is the real guard. `transcribe` refuses to run without
one. An episode that would breach it is marked `skipped` and waits for the next
run rather than being dropped.

---

## The weekly job

See **PHASE3-RUNBOOK.md** for first-run smoke tests and the full launchd
install. In short:

```bash
# install
launchctl bootstrap gui/$(id -u) launchd/co.crochet.radar.plist

# trigger by hand
launchctl kickstart -k gui/$(id -u)/co.crochet.radar

# remove
launchctl bootout gui/$(id -u)/co.crochet.radar
```

Logs: `data/logs/radar-YYYY-MM-DD.log`, one per run date.

launchd runs a missed calendar job when the machine **wakes**, but not if it
was shut down or nobody was logged in. The Mini's sleep and auto-login settings
are a dependency of this job, not an afterthought.

---

## Tests

```bash
npm test          # 183 tests, no network
npm run typecheck
```

The whole suite runs offline. Every network call goes through an injectable
client, and the fixtures under `fixtures/` are frozen — see
`fixtures/README.md` before changing one.

---

## Known issues

**`deepmerge-ts` advisory GHSA-ggr8-5vv4-36mx (high) — accepted, not fixed.**
The `prisma` CLI depends on `@prisma/config`, which depends on `deepmerge-ts`
below 8.0.0. The advisory is a stack exhaustion when merging recursive object
graphs.

Not fixed because:

- It is a **devDependency**. The CLI runs at migration time, on our own
  `prisma.config.ts`. It is not in the runtime path of `radar run`, and no
  attacker-controlled data reaches it.
- `npm audit fix --force` "fixes" it by downgrading Prisma to 6.12.0, a major
  version back, which is a considerably worse trade than a dev-only DoS on a
  config file we wrote ourselves.

**Never run `npm audit fix --force` on this project.** Re-check the advisory
when Prisma ships a release that bumps `deepmerge-ts` to 8.x.
