# Radar — decision log

Append-only. Every numbered decision taken at a stop-and-wait gate, with the
one-line reason it went that way.

**Read this before changing anything in `radar/`.** Several of these look like
arbitrary choices until you know what they were weighed against. If you are
about to reverse one, the rationale is the thing to argue with.

Owner: Marcus Efstratiou, Crochet Studio Ltd.
Build: Transcript Pipeline v1, Session 1 (attended), 2026-08-29.

Format: decision — rationale. "Overruled" means Claude proposed one thing and
Marcus decided another; that is recorded deliberately.

---

## Phase 0 — Preflight

Claude listed eleven assumptions the brief did not settle. Marcus ruled on each.

1. **Split execution: Phases 0–2 in the remote container, Phases 3–4 on the Mac
   Mini.** The build session ran on headless Linux with no API keys, so nothing
   in it could make a live call or install a launchd job. The plist and
   `PHASE3-RUNBOOK.md` are authored here and executed there.
2. **Nest everything under `radar/` as a self-contained package.** *Overruled* —
   Claude proposed the repo root. The repo root is reserved for editorial
   content from other sessions (`sources/`, `playbooks/`, `briefs/`).
3. **`.env.example` with key names only; `.env` and `radar/data/` gitignored
   from the first commit.** Secrets never enter the repository, not even once.
4. **Both vendor pins verified against live docs, each carrying a "verified
   against docs 2026-08-29" comment at the pin.** Stop and report if docs are
   unreachable — never pin from memory. See Phase 2 for how this played out.
5. **Prisma pinned to the newest stable, exactly, with no prereleases anywhere
   in the tree.** npm's `latest` tag for `prisma` was `8.0.0-rc.12`; the pin is
   `7.10.0`. A weekly unattended job is no place for a release candidate.
6. **Import first, fall through to fetch + transcribe in the same run, and
   persist the refusal reason.** A feed transcript is free, so try it first; but
   "usable" is only knowable after downloading it. Recording *why* an import was
   refused (`Episode.providedTranscriptRefusedReason`) stops retries
   re-attempting a known-bad import forever.
7. **`retry` infers the last good status from persisted state:** utterances
   present → `transcribed`; `audioPath` present → `fetched`; otherwise
   `discovered`. The database already knows how far an episode got; storing a
   second "previous status" column would be a thing that can disagree with it.
8. **`estCostUsd` bills on the vendor's reported `audio_duration`, falling back
   to the feed's `durationSec`. The pre-call cap check uses the feed duration.**
   Bill on what was actually processed; gate on the only figure known *before*
   spending anything.
9. **Export slug: lowercased, non-alphanumerics collapsed to a single hyphen,
   trimmed, capped at 60 characters on a word boundary where possible.**
   Filenames that survive being emailed, zipped and read aloud.
10. **`speakersExpected` is per-show configuration, not the formula
    `hosts.length + 1`.** *Changed at the gate* — Claude proposed the formula;
    Marcus ruled that interview shows are hosts + 1 but no-guest panel shows are
    just hosts, so 2Bobs is **2**, not 3. A nullable per-episode override column
    is reserved for later; it has no CLI surface yet.
11. **Phase 3 smoke uses `--since 60`.** Episode A published 15 July 2026, well
    outside the default 7-day window.

---

## Phase 1 — Fixtures and failing tests

Six open questions at the gate.

1. **The Markdown export deviates from the brief's "exact" format: a blank line
   before `---`, after `---`, and between turns.** The brief's literal layout put
   `---` directly after the "Review flags:" line, which makes that line render as
   a setext H2 heading — an objective Markdown bug, not a matter of taste. The
   five header lines stay adjacent exactly as written. Approved on the grounds
   that "exact format" was never meant to freeze a rendering mistake. Documented
   in `fixtures/README.md`; reverting is one constant in
   `src/stages/export.ts` plus a regenerated `expected.md`.
2. **Unverified `speakersExpected` values carry `"formatGuess": true` in
   `roster.json`.** Only 2Bobs (2), The Rare Mind (2) and Ditching Hourly (1) are
   confirmed; the other eleven shows are format guesses and are flagged as such
   so Phase 3 review knows which values have earned no trust. Ditching Hourly's
   solo default is corrected per-episode via the Phase 0 §10 override, not by
   changing the roster. **If a smoke run mis-splits speakers, fix the roster and
   re-run — never patch the export.**
3. **The naming request's `tail` excludes utterances already in `head`.** A short
   episode would otherwise send the model the same utterance twice. With the
   12-utterance fixture the tail is empty by design; the 40/10 boundary has its
   own synthetic 60-utterance test. The rule is commented where the request is
   built.
4. **Slug collision handled by distinct slugs plus host surnames in
   `searchTerm`:** `consulting-growth` is Joe O'Mahoney's *Consulting Growth
   Podcast*, `consultancy-growth-herd` is Craig Herd's *Consultancy Growth
   Podcast*. Flagged for close inspection at Phase 3 step 1, where Apple's search
   results get reviewed.
5. **The `deepmerge-ts` advisory (GHSA-ggr8-5vv4-36mx, high) is accepted, not
   fixed, and recorded in `README.md` under Known issues.** It reaches us only
   through the `prisma` CLI — a devDependency, running at migration time on our
   own config file, with no attacker-controlled input. `npm audit fix --force`
   "fixes" it by downgrading Prisma a whole major version, which is the worse
   trade. **Never run `npm audit fix --force` on this project.**
6. **TypeScript pinned to 5.9.3, not the newest stable (7.0.2, the Go port).**
   Toolchain safety alongside Prisma 7 and vitest 4. Still stable, so the
   no-prereleases rule holds. The 7.x port waits until Prisma and vitest both
   certify against it.

Also settled here, structurally: `src/` carried typed skeletons that threw
rather than being absent, so the red suite proved the tests *executed* rather
than merely failing to import; and negative-path assertions go through
`tests/helpers/expectThrows`, which rejects `NotImplementedError` by name so no
test could sit green on an unbuilt engine. The scaffold was deleted in Phase 2;
**the guard in the helper was kept**, so a future stub cannot quietly re-green
those tests.

---

## Phase 2 — Engine

### Documentation pins

1. **Naming model pinned to `claude-haiku-4-5-20251001`** — the dated snapshot,
   not the `claude-haiku-4-5` alias. Verified 2026-08-29 against
   platform.claude.com's Models overview; Claude Haiku 4.5 is still the current
   Haiku-class model. Determinism beats freshness here: an alias repoint must not
   silently change naming behaviour mid-season. Pinned as
   `DEFAULT_NAMING_MODEL` in `src/config.ts`.
2. **AssemblyAI parameters verified against the vendor's shipped OpenAPI types,
   not the published docs.** `docs.assemblyai.com` and `www.assemblyai.com` are
   both blocked by the build container's network egress proxy. Rather than stop
   the build or pin from memory, the names were read from
   `assemblyai@4.37.0`'s own OpenAPI-generated TypeScript definitions — the same
   spec the docs are generated from, and the binding contract for calls made
   through that pinned SDK. Confirmed: request `speaker_labels` (boolean),
   `speakers_expected` (number, max 10); response `utterances[]` with `speaker`
   as sequential capitals, `start`/`end` in **milliseconds**, `text`,
   `confidence`; `audio_duration` in **seconds**. Pinned in
   `src/clients/transcriber.ts` with the full note.
   **A live-docs check remains mandatory in the Phase 3 preflight** — it is step
   2 of `PHASE3-RUNBOOK.md`, as a table to tick off.

### Engine decisions beyond the brief

1. **A feed-provided transcript skips the naming API call entirely.** §5.6 says
   name every transcribed episode, but a provided transcript already labels its
   segments with real names. Asking a model to map "April Dunford" onto a name
   spends money for a chance of getting it wrong. Those labels map to themselves,
   with role taken from the roster hosts list; only anonymous diarisation labels
   (`A`, `B`, `Speaker C`, `1`) reach the API. Found by a failing orchestration
   test, not by inspection.
2. **API keys resolve on first use, not at wiring time.** `radar run --dry-run`
   therefore rehearses the entire pipeline on a machine with no keys at all —
   which is exactly the machine you check the plumbing on before keys go near it.
3. **`--dry-run` and `--json` are accepted before *or* after the subcommand.**
   Commander defaults to before-only; the brief writes `radar run [--dry-run]`,
   and so will anyone's fingers.
4. **`transcribe` bills on the vendor's `audio_duration`, gates on the feed's.**
   The implementation of Phase 0 §8.
5. **Audio streams to a `.partial` file and is renamed on completion.** An
   aborted download must not be able to impersonate a finished one to the next
   run.
6. **launchd runs `launchd/run.sh`, not `node` directly.** Solely because
   launchd does not expand dates in `StandardOutPath`, and the brief asks for
   dated log filenames. The wrapper does nothing else. `StandardOutPath` /
   `StandardErrorPath` still catch failures that happen before the wrapper's own
   redirect takes effect.
7. **Two Phase 1 test bugs fixed, both authored in Phase 1.** The poll window
   test was masked by the fixture show's own `maxEpisodesPerRun` (it measured the
   cap, not the window); the run fall-through test surfaced deviation 1 above.

---

## Standing rules

Carried forward. Breaking one of these is a decision, not a detail.

- **Never `npm audit fix --force`.** See Phase 1 §5.
- **Never pin a vendor value from memory.** Verify against docs, or against the
  vendor's own shipped contract, and say which in a comment at the pin.
- **Never patch an export to fix a speaker problem.** Fix the roster
  (`speakersExpected`) or the speaker map (`radar speakers set`), then re-export.
- **A `manual = true` speaker row is never overwritten** by any later naming run.
- **`transcribe` refuses to run without `--max-minutes`.** No uncapped spend.
- **Nothing auto-retries inside a run.** A failure stays put with its message
  until a human looks at it.
- **The test suite makes no network calls.** Every vendor call goes through an
  injectable client. If a change needs the network to test, the change is wrong.
- **Fixtures under `fixtures/` are frozen.** Change a fixture and the engine
  together, in one commit, with a note in `fixtures/README.md` saying why.

---

## Phase 4 — Scheduling (decided 2026-08-30)

Taken at the PR gate, before Phase 3 ran.

1. **Radar is scheduled by launchd on the Mac Mini.** The machine already holds
   the keys, the audio and the database; the job is a weekly local batch, not a
   service. `launchd/co.crochet.radar.plist`, Sunday 22:00.
2. **The sleep and auto-login dependency is resolved** as of 30 August 2026. It
   was a genuine blocker, not a footnote: a `gui/` domain job needs the user
   session to exist, and launchd runs a missed calendar job on **wake** but not
   after a shutdown or with nobody logged in.
3. **GitHub Actions considered and declined.** Two reasons, either sufficient:
   *key custody* — it would put the AssemblyAI and Anthropic keys in a
   third-party secret store for no gain, when the only consumer is one Mac in
   the office; and *audio handling* — a hosted runner has no persistent disk, so
   `data/audio/`, `data/raw/` and the SQLite database would all need redesigning
   around object storage to survive between runs. That is a rewrite of the
   storage layer to solve a problem we do not have.

### Merge protocol for the Phase 0–2 pull request

**Do not merge on build gates alone.** Green tests prove the engine does what
the fixtures say; they prove nothing about real feeds, real audio or real spend.

Phase 3 runs attended on this same branch, per `PHASE3-RUNBOOK.md`. Its evidence
commits to the branch alongside the build:

- corrected `formatGuess` values in `roster.json`, from what the smoke actually
  showed about each show's format;
- the regenerated `fixtures/export/expected.md`, with its diff reviewed by eye
  before acceptance;
- the ticked live-docs verification table for the AssemblyAI parameter names
  (Phase 2 pin 2), which the build container's egress proxy blocked.

Merge only when the pull request carries **build gates and smoke results
together**.
