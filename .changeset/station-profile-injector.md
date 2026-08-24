---
"@hasna/instructions": patch
---

feat: global station-profile injector (owner request 2026-08-24). New `instructions station-profile refresh|show|path|preview` commands generate a compact (<600 B) per-station block — station id/name, hostname, platform/arch, user, home, workspace, best-effort live status, and installed @hasna/* + @hasna-internal/* package counts (top-N names) — cached at `~/.hasna/instructions/station-profile.md`. Every `session plan`/`session apply` now injects the cached block as a machine-layer source by default (opt out with `--no-station-profile`); renders without a cache are byte-identical to before. Idempotent refresh (writes only on change), additive (never touches existing files), no secrets, macOS + Linux safe.
