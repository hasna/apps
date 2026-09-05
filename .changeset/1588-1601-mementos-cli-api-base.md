---
"@hasna/mementos": patch
---

Validate the CLI's API base URL and add `mementos status`.

`src/db/api-mode.ts` — the transport the `mementos` CLI actually uses — now
resolves its base URL through the same validated `resolveMementosApiBase`
helper as `@hasna/mementos/sdk`, instead of a bare string concatenation. A base
carrying a query, fragment, userinfo, or a non-http(s) scheme is rejected rather
than pasted into the request URL, where `https://api.hasna.com/mementos?debug=1`
silently became `…?debug=1/v1/memories` and a `user:pass@` base leaked operator
credentials into every printed endpoint (hasna/apps#1601; the SDK half landed in
hasna/apps#1763).

Adds `mementos status` (`--json`), which prints the fleet-uniform
`API: https://api.hasna.com/mementos/v1` line, the transport, and whether a key
is present — never the key itself (hasna/apps#1588). Like `storage mode`, it
opts out of the startup store access so it still answers when nothing is
configured.

`mementos status --json` reports `api_base: null` for a refused base instead of
echoing the raw value (a base refused for its userinfo must not come back,
password included, on the surface that gets pasted into issues), and a refused
base no longer reports `transport: http`. The shared resolver also refuses a
bare trailing `?` or `#` (previously concatenated into `…/mementos?/v1`) and no
longer quotes an unparseable input in its error. `mementos doctor` prints the
same `API: …/v1` line and `transport: http` diagnostic instead of
`Storage backend: self-hosted API (…)`.
