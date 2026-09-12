---
"@hasna/loops": minor
---

loops: the four MCP diagnostics and `loops import` now use the hosted `/v1` API instead of the on-box database

On a station flipped to the hosted Loops API these surfaces either refused outright or quietly read the
local SQLite island. They now speak to the control plane:

- `loops_doctor`, `loops_health`, `loops_health_scan` and `loops_diagnose` (MCP) answer from `/v1` using the
  same report builders the CLI's hosted `loops health` / `loops doctor` already used. Each answer names the
  backend it read and lists what it could not check. The machine-only parts of a scan (`daemon`, `doctor`
  findings) are refused on a hosted connection rather than reported as fleet state, and a control plane that
  cannot be reached fails the tool instead of falling back to the local store.
- `loops import <file>` plans against `/v1` reads and applies through `POST /v1/import` (the id-preserving
  bulk route). The preview uses the same plan builder as the local path, so a bundle is classified
  identically on both transports; rows the control plane already holds unchanged are skipped rather than
  re-posted; and the apply prints the route's backfill safety (imported workflows land archived, imported
  loops land paused with scheduling cleared).

The local file store remains reachable exactly as before behind the explicit local opt-in.
