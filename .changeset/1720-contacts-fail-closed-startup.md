---
"@hasna/contacts": patch
---

Fail-closed delivery hardening (hasna/apps#1720): `contacts-mcp` refuses to RUN
unauthenticated — it resolves the API key and authority through the one
`@hasna/contracts` client chain BEFORE the stdio transport is connected or the
HTTP port is bound, exits non-zero with a value-free first-stderr-line
diagnosis naming where the credential should live (the Keychain item, the
credentials-file path, `HASNA_CONTACTS_API_KEY`), and creates nothing under the
app home; `--help` / `--version` still answer ahead of the gate and every tool
re-resolves per request. The `contacts` CLI fail-closed message now starts on
the FIRST stderr line instead of behind a leading blank line, so the missing
credential and its expected sources are the first thing a caller (or an agent
reading the negative control) sees. Hermetic spawn probes cover the stdio and
HTTP startup gate, the first-line contract on both the CLI and the MCP server,
and the value-free diagnosis, all under fake homes with the station pinned
away.