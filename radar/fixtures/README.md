# Fixtures

Every fixture here is frozen. Tests assert against them byte-for-byte or
field-for-field, so changing one is a deliberate act: change the fixture and
the engine together, in the same commit, with a note here saying why.

Nothing in this directory touches the network. The whole suite runs offline.

| File | What it is | Notes |
|---|---|---|
| `roster.fixture.json` | Three shows: `2bobs` (two hosts), `rare-mind` (host + guest), `marketing-week` (inactive). | `speakersExpected` is per-show config, not a formula: 2Bobs is a no-guest panel show so it is 2, not `hosts + 1`. |
| `feeds/plain.xml` | 2Bobs feed, four items. | Three inside a 7-day window from `2026-08-29T12:00:00Z`, one outside. Durations cover `HH:MM:SS` (`01:02:03`), bare seconds (`1500`), `MM:SS` (`23:45`) and absent. The newest item's enclosure sits behind a `pdst.fm` tracking prefix. |
| `feeds/with-transcript.xml` | The Rare Mind feed, two items. | The first carries three `podcast:transcript` tags in SRT, VTT, JSON document order — JSON must still win the preference order. The second carries VTT only. |
| `transcripts/provided.json` | Podcasting 2.0 JSON transcript, six segments across two speakers. | The importable happy path. |
| `transcripts/provided-no-speakers.json` | Same shape, `speaker` field removed. | Import must refuse this and leave the episode eligible for `fetch`. |
| `transcripts/provided.vtt` | VTT with both `<v Name>` voice tags and a bare `Name:` prefix. | Both speaker-attribution styles in one file, plus a cue past the one-minute mark. |
| `transcripts/provided-no-speakers.vtt` | VTT with no attribution at all. | Import must refuse. |
| `assemblyai/response.fixture.json` | **PLACEHOLDER (Session 1).** Synthetic response: 12 utterances, two speakers, `audio_duration` 1500. | Replaced in Session 2 (Phase 3) by the real recorded response for 2Bobs "Productization (Again)". The suite must stay green against both, so tests assert on structure and on values derived from the file — never on hard-coded utterance counts. `words` is present on the first two utterances only, to prove the parser tolerates the key without depending on it. |
| `naming/input.fixture.json` | The exact request `name` builds for the 2Bobs fixture episode. | `head` is the first 40 utterances, `tail` the last 10 **excluding any already in head** — so a short episode never sends the model the same utterance twice. With 12 utterances, `tail` is empty by design; the truncation boundary is covered separately by a synthetic 60-utterance test. |
| `naming/expected-speaker-map.json` | The map the namer is expected to return and the map that must be persisted. | A is Blair Enns (he self-identifies in utterance 1); B is David C. Baker. |
| `export/expected.md` | Byte-exact Markdown for the fixture episode after naming. | Derived from `assemblyai/response.fixture.json` + `naming/expected-speaker-map.json`. Regenerating it by hand is not allowed; if the AssemblyAI fixture is replaced in Session 2, regenerate this from the engine's own exporter and read the diff before accepting it. |

## Deviation from the brief's "exact" Markdown format

The brief (§5.7) shows the header block, the `---` rule and the turns with no
blank lines anywhere. Rendered as Markdown that is wrong in one place and ugly
in another:

1. `---` immediately after a text line makes that line a setext H2. "Review
   flags: none" would render as a heading. **A blank line before `---` is
   required.** This is not a preference.
2. Turns run together into a single wrapped paragraph without a blank line
   between them.

`expected.md` therefore inserts a blank line before `---`, after `---`, and
between turns. The header block's five lines stay adjacent exactly as the brief
has them. Everything else — field order, separators, the `·` middot, timecode
format, the merge rule — is verbatim from the brief.

Reverting to the literal layout is a one-line change in `src/stages/export.ts`
plus a regenerated `expected.md`.
