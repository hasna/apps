---
"@hasna/logs": patch
---

Every command now works on every transport (owner directive 2026-08-15, the
storage-mode axis is retired). The CLI/MCP/serve no longer fail closed when no
fleet credential resolves: the on-box SQLite store is the default transport,
`HASNA_LOGS_LOCAL=1` forces it even when a credential resolves (previously
the opt-in was silently ignored once the disk credential tier was populated),
and the `db doctor` raw-store maintenance family runs identically on both
transports instead of throwing the "local-only operation" guard in hosted
mode. `logs-serve` serves the on-box SQLite collector by default when no
`HASNA_LOGS_DATABASE_URL` is configured instead of refusing to start. A
declared authority that cannot be honoured (blank variable, URL without a
key, disagreeing aliases) still fails loud as a misconfiguration and is never
silently routed. Legacy `*_MODE` selectors remain inert. Tests replaced the
fail-closed regressions with hermetic every-transport regressions (default
local fallback, opt-in precedence over a resolved credential, inert
`*_MODE` vars, misconfiguration refusal, doctor-on-hosted).