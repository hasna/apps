# Catalog Transport Boundary — recorded strong reason (local-only-capability review)

Status: decision record for review. Owner: local-only-capability-removal workflow,
port lane `localonly-knowledge` (2026-08-18). Reviewed at `ea43dd336` (origin/main).

The owner rule under review: nothing should be local-only or carry a "local only"
mode unless there is a very strong reason, and that reason must be recorded and
reviewed, not assumed. This file records the reason for the one capability in the
knowledge app that remains on-box-only after the two-backend migration: the RAG
catalog pipeline (`knowledge db/ingest/source/embeddings/wiki/machines/sync`) and
the catalog half of default search. The reviewer rules on it via the PR.

## The capability and the measured state

The capability in the batch: "On-box RAG catalog pipeline (knowledge
db/ingest/source/embeddings/wiki/machines/sync) and default keyword+catalog search".

Measured at `ea43dd336` (origin/main, 2026-08-18):

1. **Keyword search over the shared item corpus is ALREADY ported to the hosted
   path.** `KnowledgeService.search` routes over HTTP to the server API and ranks
   the returned item page (`src/service.ts:2731-2741`,
   `hybridSearchFromProducerPage`). `tests/cloud-catalog.test.ts` proves search /
   context / ask return cited results over the HTTP item corpus "instead of
   throwing (the pre-fix behaviour via assertSqliteClientTransport)". A live probe
   on the installed CLI (0.2.106) with HTTP transport configured confirms `knowledge
   search` attempts the server API (connection error on a fake URL, rc=1) rather
   than hitting the sqlite guard.
2. **The catalog half of search and the whole catalog pipeline remain on-box-only,
   and the refusal is loud and transport-named.** `assertSqliteClientTransport`
   (`src/knowledge-db.ts:16-25`) throws before any sqlite open when
   `HASNA_KNOWLEDGE_API_URL` is set. Every catalog module opens the catalog only
   through that gate: `openKnowledgeDb` (knowledge-db.ts:563-570),
   `openKnowledgeDbReadonly` (579-582), `dbStats` (service.ts:1959-1966), and
   per-module calls in `embeddings.ts`, `reindex.ts`, `wiki-compiler.ts`,
   `sync.ts`, `source-ingest.ts` (via service). Live probe output, HTTP transport
   set, fake URL/key (no network reached):

   ```
   $ HASNA_KNOWLEDGE_API_URL=https://fake.invalid/v1 HASNA_KNOWLEDGE_API_KEY=fake knowledge db stats
   Error: knowledge: reading knowledge.db stats builds/reads the on-box sqlite RAG catalog
   (source ingestion, chunk embeddings, wiki compilation, cross-machine sync, machine registry).
   That local indexing pipeline is not available in the HTTP client. Shared item commands route
   through the server API. Unset HASNA_KNOWLEDGE_API_URL to use the full on-box catalog pipeline;
   run 'knowledge transport' to inspect the current route.
   ```
   rc=1, empty stdout. `knowledge db storage status` hits the same guard. Semantic
   search over HTTP throws `KnowledgeSemanticSearchUnavailableError`
   (`semantic_query_unavailable: the HTTP Knowledge item store has no configured
   vector index`, service.ts:1646-1653, thrown at 2711/2733/2840).

## Why porting is not a gate removal — the server half does not exist

The port is not "remove the gate"; it is "build the catalog service". Measured:

- The Postgres migration defines the catalog tables for schema parity
  (`src/db/pg-migrations.ts`: sources, source_revisions, chunks,
  chunk_embeddings, wiki_pages, wiki_backlinks, citations, knowledge_indexes,
  runs, run_events, provider_usage, vector_index_entries, reindex_queue,
  knowledge_machines, knowledge_sync_*), but **no server code reads or writes
  them**: `src/serve.ts` registers no catalog routes (grep for
  sources/chunks/embeddings/wiki/machines/reindex in the route surface returns
  nothing), and `src/generated/storage-kit` contains no catalog query surface.
- The previous client-side Postgres sync engine was **deliberately removed** as a
  forbidden DSN-on-client path (`src/db/remote-storage.ts` header comment; the
  `knowledge db storage` CLI error at `src/cli.ts:1770-1776`: "The client-side
  Postgres sync engine (push/pull/sync) was removed: it was a forbidden
  DSN-on-client path. The shared store is reached through the HTTP ApiStore"). A
  port that shipped an RDS DSN to clients would re-open that removed path.
- What remains is a full server-side catalog service: ingest routes, chunking,
  embedding jobs (provider calls and keys server-side), wiki compilation, FTS +
  vector search over Postgres, run ledgers, per-tenant ACL — with no partial
  implementation to extend. That is a feature build, not a port.

## What is machine-local by nature

- `machines.ts` (1690 lines): the machine registry records this box's identity,
  tailscale topology and preflight checks. A registry of machines is
  definitionally per-machine data.
- `sync.ts` (2599 lines): cross-machine sync moves on-box knowledge.db files
  between peer workspaces over ssh/tailscale. That substrate does not exist in a
  hosted world — the shared corpus already flows through the server API instead.
  The on-box sync engine is the local transport's data plane.
- Source ingestion reads local source files (workspace paths, `s3://` objects)
  and derives chunks; raw source bytes are owned by `open-files`
  (`docs/architecture/hosted-wrapper-responsibilities.md`, "Open-Files
  Integration").

## The recorded architecture already assigns the server half to a wrapper

`docs/architecture/hosted-wrapper-responsibilities.md` (in-tree, reviewed
architecture) records the boundary: the OSS package owns the local catalog
pipeline; the hosted wrapper owns tenants, permission checks, queue workers,
provider secrets, and implements the remote API families `search`, `ask`,
`build`, `sync`, `runs`, `artifacts` plus remote jobs for embedding index
refresh, wiki compile, manifest import and source sync. The current server
(`src/serve.ts`) implements the item/manifest/adoption surface; the catalog
remote APIs are the wrapper build, not yet built here or in any in-tree code.

## Blast radius of a wrong port

- Un-gating HTTP clients to touch on-box sqlite would recreate the split-brain
  the guard exists to prevent: two writers, one server-authoritative corpus and
  one machine-local catalog, with no reconciliation (the reconciliation
  machinery, sync, is itself on-box).
- A client-side embedding port would put provider keys on every fleet machine
  and diverge from the recorded wrapper design (embeddings are a hosted job).
- A silent partial search (items only, labeled as full) is the vacuous-result
  shape this fleet has repeatedly paid for.

## Decision

**Strong reason recorded, not ported.** The catalog pipeline's hosted half is a
feature-scale server build assigned by the recorded architecture to a hosted
wrapper; the machine registry and cross-machine sync are machine-local by
nature; the gate is loud, transport-named, split-brain protection rather than a
silent "local only" mode. The port is tracked as wrapper work, not as this
gate's removal. The reviewer rules on this record via the PR.

What was not checked: whether a hosted wrapper implementing the catalog remote
APIs exists in another tree (out of this repo's scope); this record covers
`hasna/apps` at `ea43dd336`.
