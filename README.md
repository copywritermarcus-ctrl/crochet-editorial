# crochet-editorial

Editorial working repository for Crochet Studio Ltd.

## Layout

| Path | Purpose |
|---|---|
| `radar/` | Radar — the podcast transcript pipeline (self-contained Node package). See `radar/README.md`. |
| `sources/` | Reserved: source material from other sessions. |
| `playbooks/` | Reserved: editorial playbooks. |
| `briefs/` | Reserved: build and editorial briefs. |

## Radar

Radar turns a roster of podcast RSS feeds into speaker-named, timestamped
transcripts stored locally, with Markdown and JSON exports. It runs weekly
on the Mac Mini under launchd.

Everything to do with Radar lives under `radar/` and is run from there:

```bash
cd radar
npm install
npm run radar -- status
```

Runbooks: `radar/README.md` (day-to-day) and `radar/PHASE3-RUNBOOK.md`
(first live smoke and launchd install).
