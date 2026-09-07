---
"@hasna/attachments": patch
---

Resolver validation fixes (#1720): a credential-chain refusal from any data
command is now one actionable `Error:` line on stderr (exit 1) instead of an
unhandled-rejection stack trace; `status` / `doctor` / `whoami` echo the
resolver's own diagnosis (an authority conflict is no longer relabelled as
"missing") and write BLOCKED reports to stderr; the unit suite pins
`HASNA_STATION` to a sentinel so a station's real Keychain items never leak
into tests; the stale standalone `@hasna/attachments-sdk` scaffold is removed
(the `./sdk` export subpath is the only SDK surface).
