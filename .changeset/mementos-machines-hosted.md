---
"@hasna/mementos": minor
---

Move the machine registry to authenticated `/v1/machines` routes and make its
registration invariants database-enforced.

- The configured authority remains the app base (`https://api.hasna.com/mementos`)
  and clients append `/v1` exactly once. Hosted machine operations never fall
  back to SQLite.
- A canonical hostname (trimmed, lowercased, trailing dots removed) is the
  account-local registration idempotency key, not an authorization boundary.
  The server-issued machine `id` is the stable registry identity used by
  mutations and memory attribution. Renaming changes only the display name,
  and repeat registration cannot take over or rename a row.
- Migration 41 transactionally preflights legacy rows and refuses ambiguous
  canonical-hostname collisions, control-bearing/invalid names, noncanonical
  platform or hostname data, reversed liveness timestamps, or multiple-primary
  state for explicit reconciliation. It never deletes a machine or rewrites memory
  attribution. PostgreSQL migration bodies and their receipts are serialized
  with an advisory lock and committed atomically.
- Registration is one `ON CONFLICT(hostname) DO UPDATE ... RETURNING` statement
  backed by a unique canonical-hostname index. Concurrent callers converge on
  one stable row; there is no SELECT-then-INSERT or conflict-lookup race.
- Hosted registration, list, read, rename, primary, touch, and delete responses
  carry versioned contracts. CLI/MCP/SDK clients reject malformed 2xx responses,
  invalid timestamps, duplicate IDs/hostnames/names, false mutation receipts,
  wrong returned IDs, and operation postcondition mismatches.
- The current-machine cache is bound to authority, a non-exported credential
  fingerprint, hostname, and platform. Credential changes and identity deletion
  invalidate/re-register rather than reusing another account's cached ID.
- Hosted `memory_save` refuses machine-resolution failures rather than widening
  machine-local attribution to a machine-null memory. Administrative rename and
  primary changes no longer falsify `last_seen_at`; only registration/touch do.
- PostgreSQL lock expiry predicates now bind one ISO timestamp parameter instead
  of comparing `timestamptz` columns to translated text. Normal empty
  `GET /v1/locks` reads return `200 []`; the live PostgreSQL gate exercises the
  route, acquisition, lookup, and release.
- Machine mutation routes require the exact stable machine ID. Display-name
  addressing remains discovery-only on the explicit local API.
- The MCP machine tools remain available only through the `admin` and `full`
  profiles introduced by the bounded-profile release; the default `core`
  discovery payload remains unchanged.
- The public SDK adds strict `listMachines`, `registerMachine`, `getMachine`,
  `renameMachine`, `setPrimaryMachine`, `touchMachine`, and `deleteMachine`
  methods plus public machine input/receipt types.

After merge, apply migration 41 first and deploy the matching server second.
Only then may a separately authorized release publish a client version that
depends on these machine contracts.
