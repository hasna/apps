---
"@hasna/messages": minor
---

`/v1/*` authenticates with fleet contracts keys instead of one static string
(hasna/apps#1595).

- `messages-serve` now verifies `hasna_messages_<body>.<sig>` tokens with
  `@hasna/contracts/auth`, enforcing `messages:read` on GET/HEAD and
  `messages:write` on every mutation, and layering revocation and expiry on the
  app's own Postgres (`api_keys`, created idempotently). This is what lets
  `hasna/oss/messages/api-key` be minted, rotated and revoked like every other
  hosted app's key; a single shared string had no kid, no scopes and no way to
  be revoked.
- The signing secret resolves `API_KEY_SIGNING_SECRET` →
  `HASNA_MESSAGES_API_SIGNING_KEY` → `HASNA_API_SIGNING_KEY`, trimmed
  (hasna/apps#1543).
- **Deprecated, accepted for one more release:** `HASNA_MESSAGES_API_KEY`. When
  set, the static key still authenticates and the server warns once on first
  use. Mint a fleet key and configure a signing secret before the next release,
  which removes the static branch.
- With no signing secret and no static key the server stays open on loopback
  only, unchanged and still enforced by the bind gate.
