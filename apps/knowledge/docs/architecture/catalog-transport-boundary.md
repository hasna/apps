# Catalog Transport Boundary — superseded (owner directive 2026-08-15)

Status: decision record. The previous "local-only-capability review"
(2026-08-18, reviewed at `ea43dd336`) recorded a strong reason for gating the
client-side sqlite RAG catalog behind the HTTP-transport guard
(`assertSqliteClientTransport` in `src/knowledge-db.ts`). That review is
**overturned** by the owner directive of 2026-08-15: the storage-mode axis is
retired, and every command of every app must work in ANY transport — hosted
API (any API URL + API key) or local (sqlite/postgres).

## What changed

- `assertSqliteClientTransport` is deleted. `openKnowledgeDb`,
  `openKnowledgeDbReadonly`, and `getKnowledgeDbStats` open the machine-local
  derived catalog unconditionally: the item transport only selects where the
  SHARED ITEM CORPUS lives (server API or on-box `db.json`), and the
  machine-local catalog (`knowledge db/ingest/source/embeddings/wiki/machines/
  sync/safety/web` plus catalog search) is not transport-gated.
- `KnowledgeSemanticSearchUnavailableError` is deleted. Semantic/fake/model
  requests over the HTTP item corpus degrade to keyword results with the
  `semantic_search_requires_local_catalog` warning (the items-level contract
  `hybridSearchItems` already defines), never a transport refusal. `embeddings
  search` reads the local vector index in every transport.
- The MCP `knowledge_get` tool reads catalog record kinds (source/wiki_page/
  run/index/decision) from the machine-local catalog in every transport; only
  the `item` kind follows the transport-appropriate item store.
- `inventory --store <path>` honors the explicit store path as an on-box
  override in every transport (same rule as `resolveItemStore`).

## Why this is not the split-brain the old record feared

The old guard existed because two writers (server-authoritative corpus and a
machine-local catalog) looked like a reconciliation hazard while the
storage-mode axis still existed. With the axis retired there is no "mode" to
get wrong: the server corpus and the machine-local derived catalog are
different stores with distinct, documented roles. The machine registry and
cross-machine sync remain machine-local data planes by nature (they move
on-box `knowledge.db` files between peers); running them is not a transport
decision.

## Server half

The hosted wrapper build (remote catalog APIs: search vectors, embedding jobs,
wiki compile, manifest import, source sync) is still tracked as wrapper work
per `docs/architecture/hosted-wrapper-responsibilities.md`; removing the client
gate does not remove that lane, it just stops blocking client commands on a
credential's presence. The `src/serve.ts` item/guarded/artifact surface is
unchanged.