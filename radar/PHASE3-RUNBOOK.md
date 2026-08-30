# Radar — Phase 3 and 4 runbook

**Everything in this file runs on the Mac Mini, attended, by Marcus.**

Phases 0–2 were built in a remote Linux container with no API keys, so nothing
here has ever made a live call. The engine is green against 183 offline tests;
what follows is the first contact with real feeds, real audio and real spend.

Work top to bottom. Do not skip to Phase 4.

---

## Before you start

```bash
cd ~/crochet-editorial/radar     # adjust if the repo lives elsewhere
node --version                   # must be 20 or newer
npm install
cp .env.example .env
```

Put the two real keys in `.env`. Then:

```bash
npx prisma migrate deploy
npm run build
npm test                         # 183 passing, no network
npm run radar -- status          # should print four empty blocks, exit 0
```

If `npm test` is not green, stop. Nothing below is meaningful against a red suite.

### Verify the two doc-pinned values

Both were pinned during the build, but one of them could not be checked against
its own documentation from inside the container. Confirm both now, from a
machine with unrestricted network:

**1. The Haiku model string.** Verified 2026-08-29 against
platform.claude.com → Models overview. Claude Haiku 4.5's Claude API ID is the
pinned snapshot `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`). Pinned
in `src/config.ts` as `DEFAULT_NAMING_MODEL`. No action unless Anthropic has
shipped a newer Haiku-class model since.

**2. The AssemblyAI parameter names — CHECK THIS ONE.**
`docs.assemblyai.com` and `www.assemblyai.com` are both blocked by the
container's network egress proxy, so these could not be read from the published
docs. They were verified instead against AssemblyAI's own OpenAPI-generated
TypeScript definitions shipped inside `assemblyai@4.37.0`
(`node_modules/assemblyai/dist/types/openapi.generated.d.ts`) — the same spec
the docs are generated from. Open
<https://www.assemblyai.com/docs/speech-to-text/speaker-diarization> and confirm:

| Where | Name | Expected |
|---|---|---|
| request | `speaker_labels` | boolean, enables diarisation |
| request | `speakers_expected` | number, hint, at most 10 |
| response | `utterances[]` | present when `speaker_labels` is on |
| response | `utterances[].speaker` | `"A"`, `"B"`, … |
| response | `utterances[].start` / `.end` | **milliseconds** |
| response | `audio_duration` | **seconds** |

These are pinned in `src/clients/transcriber.ts` with the verification note
beside them. If any differ, fix them there — the fixtures and tests key off the
same shapes, so a mismatch will show up as a failing test, not silent corruption.

---

## Phase 3 — attended live smoke

### 1. Resolve the feeds

```bash
npm run radar -- roster sync
```

Prints each show with the feed URL Apple returned. **Read every line.**

Two to look at hardest, because the names collide:

- `consulting-growth` — Joe O'Mahoney's *The Consulting Growth Podcast*
- `consultancy-growth-herd` — Craig Herd's *The Consultancy Growth Podcast*

If either resolved to the other's feed, fix `searchTerm` in `roster.json` and
re-run with `--force`. Anything unresolved stays `null` and is skipped by
`poll`; add the feed URL by hand if Apple cannot find it.

### 2. Confirm discovery against a live feed

```bash
npm run radar -- poll --since 60 --show 2bobs --dry-run
```

Expect a handful of episodes and no warnings. Writes nothing.

### 3. Episode A — 2Bobs, "Productization (Again)"

Two hosts, roughly 20 minutes, published 15 July 2026. One episode only.

```bash
npm run radar -- poll --since 60 --show 2bobs
npm run radar -- status                       # find the episode id
EP=<episode id from status>

npm run radar -- fetch --episode $EP
npm run radar -- transcribe --episode $EP --max-minutes 30
npm run radar -- name --episode $EP
npm run radar -- export --episode $EP
```

`--max-minutes 30` is deliberate: it caps this first live call at about
$0.09 even if something is wrong.

Then **record the real response as the fixture**, replacing the Session 1
placeholder:

```bash
cp data/raw/$EP.assemblyai.json fixtures/assemblyai/response.fixture.json
npm test
```

The suite must stay green. It reads its expectations out of the fixture rather
than hard-coding utterance counts, so a real response of any length should pass.

One thing will not survive automatically: `fixtures/export/expected.md` is
frozen against the *placeholder* transcript. If `npm test` fails only on the
byte-identical export test, regenerate it from the engine's own exporter and
**read the diff before accepting it**:

```bash
npm run radar -- export --episode $EP --format md
# compare the new data/exports/2bobs/*.md against fixtures/export/expected.md,
# confirm it is right by eye, then copy it over and re-run npm test
```

### 4. Episode B — The Rare Mind, the April Dunford episode

Host plus guest. Same sequence.

```bash
npm run radar -- poll --since 60 --show rare-mind
EP_B=<episode id>
npm run radar -- fetch --episode $EP_B
npm run radar -- transcribe --episode $EP_B --max-minutes 60
npm run radar -- name --episode $EP_B
npm run radar -- export --episode $EP_B
```

The point of this one is the **guest**: check the speaker map resolved April
Dunford from the episode title, and did not label her "Unknown speaker B".

If The Rare Mind's feed ships its own transcript, Radar will import it instead
of transcribing — that is correct and free. The speaker labels will then be
real names from the feed, and naming will map them to themselves without an API
call. Cost for that episode is $0.00.

### 5. Read both exports

Open the two `.md` files under `data/exports/`. Confirm:

- Names are right, and attached to the right voice.
- Timecodes are sane and monotonic.
- Merged turns read as paragraphs, not as a wall.
- No orphan `A:` / `B:` labels anywhere in the body.
- The header block is right: date, duration, source, URL, speakers, review flags.

If speakers are mis-split — three voices where there are two, or vice versa —
that is `speakersExpected` in `roster.json` being wrong for that show. **Fix the
roster, re-run `roster sync`, then `retry` and re-transcribe.** Do not edit the
export.

### 6. Reconcile the cost

Open the AssemblyAI dashboard and compare real spend against the `estCostUsd`
column in `npm run radar -- status`. If the rate is off, set `RATE_PER_HOUR` in
`.env` to the real figure. It only affects estimates, but the estimates are
what the `--max-minutes` cap is reasoned about with.

### 7. Sign-off

Phase 3 is done when both episodes are exported, read and approved, the suite
is green against the **real** AssemblyAI fixture, and
`npm run radar -- run --dry-run` and `npm run radar -- status` both read cleanly.

Nothing runs unattended before this point.

---

## Phase 4 — the launchd job

### Edit the paths first

`launchd/co.crochet.radar.plist` hard-codes
`/Users/marcus/crochet-editorial/radar` in three places. launchd does not
expand `~` and does not read your shell profile. Fix all three if the repo
lives anywhere else:

```bash
grep -n '/Users/marcus' launchd/co.crochet.radar.plist
```

Check node's path too — the wrapper falls back to `/usr/local/bin/node`:

```bash
command -v node    # if this is not /usr/local/bin/node, set RADAR_NODE
```

### Install

```bash
npm run build                    # launchd runs dist/, not the TypeScript
mkdir -p data/logs
launchctl bootstrap gui/$(id -u) launchd/co.crochet.radar.plist
launchctl print gui/$(id -u)/co.crochet.radar | head -20
```

### One manual run, end to end

```bash
launchctl kickstart -k gui/$(id -u)/co.crochet.radar
tail -f data/logs/radar-$(date +%Y-%m-%d).log
```

It must finish with a `RunLog` row:

```bash
npm run radar -- status          # the run appears under LAST 5 RUNS
```

If nothing happens, look at `data/logs/launchd.err.log` — that catches failures
that happen before the wrapper's own redirect (wrong node path, missing
`dist/`).

### Unload / reload

```bash
launchctl bootout gui/$(id -u)/co.crochet.radar
launchctl bootstrap gui/$(id -u) launchd/co.crochet.radar.plist
```

Reinstall after **any** change to the plist. launchd caches the old copy.

### Sleep and login — a real dependency

launchd runs a missed calendar job when the machine **wakes up**. It does not
run one that was missed because the machine was **shut down**, or because
nobody was logged in — this is a `gui/` domain job, so it needs your user
session to exist.

For a Sunday 22:00 job on a headless Mini:

- System Settings → Energy: **Prevent automatic sleeping when the display is
  off**, or schedule a wake before 22:00.
- System Settings → Users & Groups → **Automatic login on**, so the GUI session
  exists after a power cut.

Check on Monday morning: `npm run radar -- status` should show Sunday's run and
the week's exports under `data/exports/`.

### Why `--since 8`

The job polls 8 days, not 7, so a run that starts late or a feed that publishes
slowly still overlaps the previous window. De-duplication on `(show, guid)`
makes the overlap free.

---

## If something goes wrong

| Symptom | What to do |
|---|---|
| Episodes stuck at `failed` | `radar status` shows the real error per episode. Fix the cause, then `radar retry --all-failed`. |
| Episodes stuck at `skipped` | The minute cap deferred them. The next run picks them up; or raise `--max-minutes` and re-run. |
| A speaker is wrong | `radar speakers set <id> <label> "Name" --role guest`. Sticks permanently, re-exports immediately. |
| Speakers mis-split across an episode | `speakersExpected` for that show is wrong. Fix `roster.json`, `roster sync`, `retry`, re-transcribe. |
| A show discovers nothing | Check its `feedUrl` resolved, and that `active` is `true`. |
| Costs look wrong | Reconcile against the AssemblyAI dashboard, adjust `RATE_PER_HOUR`. |

Nothing auto-retries inside a run, by design. A failure stays put with its
message until you look at it.
