---
"@hasna/telephony": minor
---

The SQLite engine leaves the client bins; the on-box store is reachable only
through one gated runtime import.

- **`bun:sqlite` is no longer linked into `telephony` or `telephony-mcp`.** The
  on-box store moved out of `src/lib/store/index.ts` into its own module
  (`src/lib/store/local-store.ts`), emitted by the build as its own artifact
  `dist/local/local-store.js` and loaded through ONE gated runtime import
  (`src/lib/store/local-store-loader.ts`). `dist/cli/index.js`,
  `dist/mcp/index.js`, `dist/index.js`, `dist/sdk.js` and both server bundles
  now contain zero `bun:sqlite` references; a hosted station cannot open a
  local database even by accident, because the code is not in the process. A
  new suite bundles the real entrypoints and fails if the engine comes back,
  with a counter-control asserting the local-store entry still carries it.
- **The exported `LocalStore` is now a lazy facade** over that gated import.
  Same class name, same `transport: "local"`, same async method set — it just
  opens the door on the first operation instead of at import time, and the
  loader refuses unless the explicit `HASNA_TELEPHONY_LOCAL=1` (alias
  `TELEPHONY_LOCAL=1`) opt-in really selected local mode. This is the one
  behaviour change a consumer can observe: embedding `new LocalStore()` in a
  process that resolves a Hasna credential now rejects on first use with a
  line naming the opt-in, where it previously opened SQLite regardless of the
  environment. A resolved credential still outranks the opt-in, and with
  nothing configured the unchanged fail-closed error is raised.
  `getStore()` stays synchronous and every CLI, MCP and `./sdk` caller is
  unchanged.
- No command's behaviour changes. The CLI and MCP already failed closed
  without a credential and already honoured the opt-in; this release only
  moves where the store code lives and how it is reached.
