---
"@hasna/shortlinks": patch
---

Resolver validation fixes for the `@hasna/contracts` credential chain adoption
(hasna/apps#1720, round-1 validator findings).

- `shortlinks-mcp` fails closed at startup: with no shortlinks credential
  resolvable (Keychain item, `~/.hasna/shortlinks/config/credentials`,
  `HASNA_SHORTLINKS_API_KEY`) and no explicit `HASNA_SHORTLINKS_LOCAL=1`, the
  bin now exits non-zero naming the credential chain BEFORE any transport
  starts. Previously it announced "stdio ready" and exited 0 when stdin closed
  — a server whose every tool would have refused. Hosted startup touches
  nothing on disk; the explicit local opt-in announces local mode at startup
  and opens the on-box database in the caller's home.
- `shortlinks-mcp --version` / `--help` and `shortlinks-serve --version` /
  `--help` answer on stdout with rc=0 without starting a transport, resolving a
  backend, or binding a port (they used to fall through to the stdio loop and
  the PostgreSQL pool factory respectively). The MCP server now reports the
  package version instead of a hard-coded `1.0.0`.
- The app home is derived from the environment each surface was handed, never
  from a silent `process.env` read behind a caller-built env: `LocalStore`,
  `ShortlinksStore`, and every config/machine-id/click-salt helper take the
  env they were resolved with. A local opt-in test used to plant
  `~/.hasna/shortlinks/shortlinks.db` in the REAL home on every `bun test`
  (station no-local-SQLite rule); the suite now guards against that. Path
  lookups (`getConfigPath`, `getDatabasePath`) create nothing — only a write
  creates the app home — so a hosted-mode `doctor` or MCP startup leaves no
  directory behind. `HASNA_HOME` relocates the app home
  (`$HASNA_HOME/shortlinks`) exactly as it does for the credential chain.
- Removed the stray `sdk/` scaffold that declared an unpublished
  `@hasna/shortlinks-sdk` split package (one package per app; the resolver-
  backed client ships at the `./sdk` export subpath). `bun run sdk:generate`
  writes `src/sdk/generated.ts` only.
