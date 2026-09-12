---
"@hasna/instructions": minor
---

Keep the on-box SQLite store out of the CLI and MCP bundles, and stop `status` from looking hung against the hosted API.

- The local store is now reached through ONE dynamic import (`src/db/local.ts`, loaded from `LocalConfigStore`), and the CLI and MCP builds emit it as a chunk outside their own directories. `dist/cli/index.js` and `dist/mcp/index.js` now contain zero `bun:sqlite` references; the code still ships (as `dist/chunks/local-*.js`) so `HASNA_INSTRUCTIONS_LOCAL=1` keeps working exactly as before. A two-sided test runs the real build commands and fails if a static import puts SQLite back in a client bundle.
- `uuid` / `now` / `slugify` moved to `src/lib/ids.ts` (re-exported from `src/db/database.ts`, so no import breaks). They are pure helpers, and importing them from the database module was dragging `bun:sqlite` into every surface that needed a slug.
- `instructions status` no longer counts profile links and snapshots against a hosted store by default: each of those needs one HTTP read per profile and per config, which on a 258-config store took over two minutes and made the command look hung (the fleet probe killed it at 40 s). `counts.profileLinks` and `counts.snapshots` are now `null` in that case — never a made-up number — and the new `status --deep` flag counts them anyway with a bounded fan-out. The on-box SQLite store still counts them by default, where they are free. A default hosted `status` now answers in about two seconds.

No change to routing or fail-closed behaviour: with no credential and no opt-in the CLI and the MCP server still exit non-zero naming the credential tiers and the opt-in, and no SQLite file is created.
