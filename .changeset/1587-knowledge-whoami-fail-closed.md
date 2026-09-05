---
"@hasna/knowledge": patch
---

`knowledge auth whoami` (and `auth status`) answer the live question — "can this
credential read the API right now?" — instead of reporting on env presence.
The configured snapshot is overlaid with a one-request probe through the read
transport, so a key that is present in the environment but rejected by the
server reports `authenticated: false` with the server's reason, HTTP status and
the failing key's kid. A negative verdict is also a NON-ZERO exit with
`ok: false`, in `--json` and human output alike, so `knowledge auth whoami` is
usable as a station health gate: a revoked key no longer passes `set -e`,
`$?`, or `--json | jq -e .ok`.

Fixes hasna/apps#1587 (a revoked fleet key passed `whoami` while failing every
read with 401). The probe landed in #1594 and the exit code in #1761; this
release is the first one that carries either to npm — @hasna/knowledge 0.2.116
on the registry still answers a bogus key with
`{"ok":true,"authenticated":true}`, so stations must upgrade to get the fix.
