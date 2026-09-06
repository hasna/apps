---
"@hasna/projects": patch
---

Fail closed when no Projects credential resolves; the on-box SQLite registry is
opt-in only (hasna/apps#1720, #1613, #1668, #1690).

- **Hosted with no credential exits non-zero** — `resolveProjectStore()` no
  longer catches the `@hasna/contracts` resolver's refusal and reroutes a
  completely silent environment to the on-box SQLite registry. The resolver
  error propagates: non-zero exit, no SQLite opened, no local-fallback event.
  This was the class bug in 1.1.0 (its `list` could silently serve the local
  registry, or intermittently exit 1 as the resolver error raced the fallback
  probe).
- **Local mode only by explicit opt-in** — `HASNA_PROJECTS_LOCAL=1` (alias
  `PROJECTS_LOCAL`) selects the on-box registry, and only when the environment
  declares no authority or credential. The opt-in is answered before the
  resolver runs (it never touches the Keychain or a credentials file), any
  env-declared authority or credential outranks it, and a half-configured
  opt-in run still fails loud. The run prints one line saying it is local on
  stderr; the retired `*_STORAGE_MODE` switches and the implicit fallback are
  gone, not replaced.
- The `./sdk` keeps throwing with no resolvable credential — an explicit
  `baseUrl` with no `apiKey` never attaches the ambient fleet key (contracts
  `x-api-key` is only sent when the call resolved one).