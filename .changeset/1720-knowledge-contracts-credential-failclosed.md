---
"@hasna/knowledge": patch
---

Fail closed: a hosted Knowledge client with no resolvable credential exits
non-zero and touches nothing on-box — no SQLite, no `*-local-fallback` event
(hasna/apps#1720 class patch; knowledge 0.3.0/0.3.1 silently dropped an
unconfigured process onto the on-box store, the false green incident 715712
closes).

- The on-box store is now reachable ONLY by the explicit opt-in
  `HASNA_KNOWLEDGE_LOCAL=1` (or an explicit `--store <path>` argument), and
  local mode prints `local mode` once on stderr. The opt-in is answered before
  the shared `@hasna/contracts` resolver runs — no Keychain item and no
  credentials file is read for it — and an environment that configures an
  authority or credential outranks it (a half-configured run still fails
  closed).
- Every failure — no credential anywhere, a configured authority whose
  credential does not resolve, a deliberate tier that cannot be honoured —
  throws the same fail-closed diagnostic naming the opt-in, and the CLI exits
  non-zero from every surface (CLI, MCP tool, `./sdk`).
- The legacy `~/.hasna/knowledge/auth.json` is no longer a credential source:
  the chain never consults it (a fallback read from a different file would
  authenticate as a principal the operator did not name). `knowledge auth
  login` now writes the shared chain's DISK tier —
  `~/.hasna/knowledge/config/credentials` (0600) — so `auth whoami` right
  after a login probes through the file the resolver reads, and `auth logout`
  removes it. `email`/`org` metadata is not persisted (the canonical file
  format has no fields for it); the legacy auth.json helpers remain exported
  for migration only.
- `knowledge transport` reports `local-opt-in` for the opted-in on-box store
  and fails closed with no credential and no opt-in; the retired
  `*_MODE` / `*_STORAGE_MODE` selector ratchet still refuses stale variables
  loudly.
- Fixes the knowledge half of the fail-closed semantics ruling (hasna/apps
  #1720, #1788, #1794); `@hasna/contracts` stays pinned to exact 1.0.2.