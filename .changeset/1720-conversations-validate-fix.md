---
"@hasna/conversations": patch
---

Fail-closed and resolver validation fixes for the `@hasna/contracts` credential
chain adoption (hasna/apps#1720, round-1 validator findings).

- `conversations events-drain` no longer opens the on-box SQLite store directly.
  The outbox worker is local-only by nature, and local is an explicit opt-in:
  without `HASNA_CONVERSATIONS_DB_PATH` it now exits non-zero through the same
  `CONVERSATIONS_STORE_CONFIG` refusal every other surface raises (JSON error
  contract honoured under `--json`), creates no `messages.db`/WAL/SHM under the
  app home, and prints no "scanned 0" line; with the opt-in it prints the
  LOCAL-mode notice before touching the store. Previously a hosted station with
  no credential got exit 0, an empty drain report and a freshly created local
  database.
- The MCP `send_feedback` tool is gated the same way: feedback is a local-only
  table with no hosted route, so on a hosted station it returns an MCP error
  naming `HASNA_CONVERSATIONS_DB_PATH` instead of silently creating
  `~/.hasna/conversations/messages.db` as a side effect of the session.
- `@hasna/conversations/sdk` gains the contracts-chain entry point every other
  adopter ships: `resolveConversationsSdkTransport(options)` feeds the
  conversations resolver inputs (identity-preserving, so the Keychain tier stays
  live — #1788) into the one `@hasna/contracts/client` chain and reports the
  origin-form `baseUrl` (no `/v1` duplication) plus the credential and authority
  SOURCES (never values); `createConversationsClient(options)` builds the
  generated `ConversationsClient` from it with the credential re-resolved on
  every request. Hosted-only: no credential anywhere throws
  `ConversationsSdkResolutionError` (`CONVERSATIONS_CREDENTIAL_MISSING`) naming
  every tier consulted and the local opt-in; the local opt-in itself is refused
  (`CONVERSATIONS_LOCAL_STORE_SELECTED`) pointing at `getStore()`, since an HTTP
  client cannot serve the on-box store. An explicit `baseUrl` with no `apiKey`
  stays unauthenticated — the ambient fleet key is never attached to a
  caller-chosen authority (#1794).
- The `./sdk` bundle is free of `bun:sqlite` again: `IdentityError` moved to the
  dependency-free `src/lib/identity-error.ts` (re-exported from `identity.ts`
  unchanged for existing imports), and a self-contained test builds the SDK
  entry and asserts its bundle imports node builtins only, with the root bundle
  as the positive control.
- `cloudApiUrl()` (and with it `status`, `status --json` and `/api/status`)
  reports the authority the chain actually resolved — a Keychain `api-url` item
  or a credentials-file authority included — instead of env-or-default.
- Admin redaction's attachment safety check canonicalises the attachment base
  directory the same way it canonicalises the file (`realpathSync`), so
  `safe_to_delete` is true on symlinked data roots (macOS `/var` →
  `/private/var`) and `apply` actually removes the leaked file.
- Test fixtures pin `HASNA_STATION` to a station no Keychain item uses
  (`HERMETIC_STATION`), so a fleet workstation's real `api-key`/`api-url` items
  can no longer answer for a hermetic case.
