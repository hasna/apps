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
