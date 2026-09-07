---
"@hasna/calendar": patch
---

MCP server fails closed at startup: `calendar-mcp` refuses to start — exit 1 with
`calendar-mcp: refusing to start — …` as the first stderr line naming the
Keychain item `hasna.credentials.calendar.api-key`, the credentials file
`~/.hasna/calendar/config/credentials`, and `HASNA_CALENDAR_API_KEY` /
`HASNA_CALENDAR_API_URL`, never a value — before the stdio transport connects
or the `--http` port is bound, so `initialize` is answered by nobody and no
socket is bound (hasna/apps#1720). The gate is one strict pass down the
`@hasna/contracts` 1.0.2 chain on the live process env (ambient tiers kept,
hasna/apps#1788) and covers every refusal class the CLI already fails loud on:
no credential, a URL without a key, a retired placement selector, a
secrets-vault pointer, an unsafe credentials file. Tool calls still re-resolve
the chain per request. `--help` / `--version` keep answering rc=0 without a
credential.