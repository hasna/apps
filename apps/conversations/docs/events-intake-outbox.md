# PostgreSQL outbox to Events intake

This path captures new message creation, task creation and task transitions in the
same PostgreSQL transaction as their source mutation. It requires migration 15's
explicit, immutable corpus ownership and migration 16. Capture requires no Events
network access or credential. A refused or failed capture rolls back the source
mutation; malformed envelopes are retained as quarantined intent for inspection.

## Operator configuration

Run migrations with the owner connection, then serve with a non-owner role that
has no membership in the source, delivery-ledger, corpus-binding or API-key table
owners, and has neither SUPERUSER nor BYPASSRLS. The delivery ledger uses FORCE
RLS against the persisted corpus/tenant/authority binding. Runtime readiness
checks migration 16 and its enabled guards. PostgreSQL fsync/full_page_writes
must be on; source intent, claim, dispatch intent and receipt transactions set
synchronous_commit=on. No database transaction spans an HTTP request.

On the Conversations server, configure `HASNA_CONVERSATIONS_EVENTS_SINK_ID` and
`HASNA_CONVERSATIONS_EVENTS_PRODUCER_ID` for an Events producer already bound by
its administrator to this exact source corpus, source authority and tenant. The
corpus's `cor_` identity and opaque source authority remain unchanged. Events
credentials and authority use the shared Contracts resolver for the Events app,
including its saved credential and pointer-completion rules. The caller's
Conversations credential is never forwarded to Events. Do not put keys in CLI
arguments or logs.

`POST /v1/events/outbox/drain?limit=20` requires `conversations:events-drain`, and
rechecks that key and its tenant before dispatch and acknowledgement. A tick
claims 1–100 eligible intents (default 20), with a 25-second tick deadline,
10-second I/O deadline and 30-second lease. Server shutdown or caller abort stops
new I/O. Client, MCP and SDK operations use the authenticated Conversations API;
this worker never opens SQLite or writes a spool file.

## Receipt and retry semantics

The first claim freezes destination sink, producer and resolved API authority.
The source corpus, tenant, authority, event identity and canonical payload hash
were already frozen at capture. Credential rotation can retain those identities;
a changed destination quarantines the original intent rather than rebinding it.

A durable dispatch intent precedes HTTP. An interrupted or failed write remains
uncertain. Retry first asks Events for the exact receipt; only an authenticated
404 permits replay of the same immutable request, after a fresh source/lease and
configuration check. Other failures do not trigger another write in that tick.
Retries use bounded exponential backoff (at most 256 seconds) and retain attempt
history. Expired leases can be reclaimed; generation/token checks prevent a stale
worker from acknowledging another worker's claim.

`accepted` / compatibility `transported` count only exact validated
`accepted_durable` sink receipts whose source lease still matches at commit.
They do not mean downstream subscribers received the event. `spooled` is always
zero on this path. `retryable`, `quarantined` and `lost_claim` are separate counts.
There is no automatic retry daemon in this change; an authorized bounded tick
can be called again. `GET /v1/events/outbox/receipt?event_id=...` and
`events-receipt` expose metadata, hashes and receipt identity, never event content,
credential values or the server's destination URL. Unbound historical rows return
404 from this metadata endpoint and remain in the source registry.

## Redaction and historical work

Changing a bound source envelope invalidates its lease in the same transaction.
Message redaction retains the original delivery hash and receipt, quarantines the
intent, and adds `events_downstream_reconciliation` to both the response and the
redaction audit record. A completed or possibly dispatched copy remains explicitly
reconcilable; source redaction is not a claim of global erasure. No downstream
redaction/reconciliation operation is implemented by this change.

Migration 16 never binds or drains pre-existing outbox rows. Legacy pending,
spooled, delivered and dead rows retain their status and evidence. The explicit
local library's SQLite/spool compatibility remains separate. Historical corpus,
SQLite and spool migration and verified source deletion remain unfinished work;
new-path acceptance does not certify those transfers.

## Release and verification boundary

This source is stacked on the reviewed Events intake change (PR 2012), including
its opaque identity correction. The new `@hasna/events/intake` export is not yet
published. The Conversations registry dependency is pinned to the matching Events 0.1.18
candidate. That exact version must be published with this export before declaring
release dependency closure. The current workspace/frozen-lock build is source integration evidence,
not registry availability, deployment or live delivery proof. Protocol code is
imported from the public Events package and is never vendored into Conversations.

The required `test:postgres` gate runs real non-owner source/sink PostgreSQL and
HTTP fixtures, including CLI/MCP/SDK, immutable replay, redaction fences, lease
expiry, source drift, rollback, shutdown and legacy preservation. It requires an
explicit disposable loopback test database and rejects missing or skipped cases.
