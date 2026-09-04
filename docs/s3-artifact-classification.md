# S3 artifact-remote classification — all hosted apps + unhosted packages

> Issue: hasna/apps#1644 · Date: 2026-09-04 · Status: authoritative classification (v1)
> Taxonomy: knowledge `hasna-s3-bucket-taxonomy` (k_mtmtexu6_gsctz1) · Kit: #1631 (prototype #1639 MERGED — skills versioned bundles push/pull/pin in `apps/skills/src/server/artifact-storage.ts` + `apps/skills/src/mcp/storage-tools.ts`).

## Method

For each app in `apps/*` with a `hasna.contract.json` and a hosted deploy descriptor
(Dockerfile + fleet placement; root `.github/workflows/deploy-*.yml` for the ported
lanes conversations/mementos/projects/skills/todos, infra-managed for the rest) the
classification reads:

- migrations / schema / serve storage code under `apps/<app>/` (bytea columns, object
  keys, artefact concepts, S3 SDK/env usage);
- live deployment evidence where it exists in the repo (deploy lane env vars, deploy
  descriptors);
- the deploy-facing issues in this batch (#1645–#1650) and the owner's live census in
  the issue report (row counts, bucket names, task roles).

Classes:

- **A — versioned artefacts**: the app produces immutable, digest-addressed bundles that
  must be pushed to a durable per-app remote and pulled anywhere (kit consumer:
  push/pull/pin by version).
- **B — bytes**: the app holds non-versioned bytes (media, attachments, MIME) that need a
  bucket for durability, but not the kit's versioning surface.
- **C — rows-only**: DB rows only; no bytes today and none planned.
- **D — unhosted package**: not in the hosted fleet today; may need a bucket if it is
  ever hosted.

## Hosted fleet (25 apps)

| # | App | Class | Current storage (verifiable in repo) | Target remote (taxonomy + prefix) | Dependencies | Issue |
|---|-----|-------|--------------------------------------|-----------------------------------|--------------|-------|
| 1 | skills | A | bundle bytes in Postgres `skills_bundles.body_blob BYTEA` (migrations 0002/0006, `storage_kind 'db'` default); S3 path wired but unused (`storage_kind 's3'` + `storage_key`, artifact-storage.ts `putBundle`, mcp `storage-tools.ts`) | `hasna-apps-skills-artifacts-…` · `skills/<org>/<slug>/<version>/` (content-addressed `bundle.tar.gz` keyed on sha256) | kit `@hasna/contracts` artifact kit (in-tree, #1639); bucket; ECS task role: `s3:Put/Get/DeleteObject` on bucket+prefix | #1630 |
| 2 | projects | A | workspaces live only on stations (`workspaces.primary_path`); `workspaces.s3_bucket`/`s3_prefix` columns already in schema (`src/db/schema.ts`), unused in prod | `hasna-stations-state-…` · `workspaces/<wks>/` | kit for workspace bundle push/pull; bucket; task role grant | #1593 |
| 3 | knowledge | A | markdown pages in Postgres; sources are `file://` refs on station disks (wiped with the box); `s3` source refs + bucket config already supported in code (`src/source-ref.ts` `S3SourceRef`, `src/workspace.ts` s3 layout) | `hasna-apps-knowledge-artifacts-…` · `sources/`, `exports/` | kit (knowledge lane #1633 depends on #1631); bucket; task role grant | #1633 |
| 4 | recordings | A+B | 1,327 rows; `recordings.audio_path TEXT` names a file that exists only on the recording machine — audio is **not durable anywhere**; transcripts in `raw_text`/`processed_text` rows | `hasna-apps-recordings-media-…` · `recordings/<id>/<sha>` | kit upload at capture (native CLI); bucket; task role grant | #1645 |
| 5 | todos | A | `artifacts` table rows carry `local_path` + `content_hash` + `size_bytes` (files stay on the producing station); full S3 artifact store + sync implemented (`src/storage/s3-artifacts.ts` SigV4 store, `s3-artifact-sync.ts`) but bucket env (`HASNA_TODOS_S3_BUCKET`) unset in prod | `hasna-apps-todos-artifacts-…` · `artifacts/<task>/<sha>` | kit (or existing store); bucket; task role grant | #1647 |
| 6 | logs | A | raw JSONL segment files + manifests live only on-box; hosted `event_records` rows carry redacted metadata + content hash with `raw: null` by design (`src/store/index.ts`, `src/server/cloud/store.ts`) | `hasna-apps-logs-artifacts-…` · `artifacts/<run>/<sha>` | kit; bucket; task role grant | #1648 |
| 7 | conversations | B | `message_attachments.content BYTEA` in the shared RDS (migration 6, `sr/lib/pg-migrations.ts`) — attachment bytes bloat the shared DB | `hasna-apps-conversations-attachments-…` · `attachments/<sha>` | bucket only (bytes, no versioning); migrate table → S3 with content-addressed keys; task role grant | #1646 |
| 8 | telephony | B | call recordings/voicemail exist only at the provider (`media_url`/`recording_url` columns, `src/server/cloud-serve.ts`) — hosted rows keep the URL, bytes are not in our control | `hasna-apps-telephony-media-…` · `media/<id>/<sha>` | bucket only; copy-on-arrival worker; task role grant | #1649 |
| 9 | attachments | B (live) | production S3 today; keys `attachments/<yyyy-MM-dd>/<id>/<filename>` (`src/api/routes/attachments.ts`), versioning off, no lifecycle, grandfathered bucket | keep bucket (grandfathered), align layout + versioning + lifecycle | bucket ops in infra-live #41; no kit needed (non-versioned bytes) | #1650 |
| 10 | files | B (live) | production S3 with **two key layouts** and a second `EVIDENCE` bucket (`HASNA_FILES_S3_BUCKET` + `HASNA_FILES_EVIDENCE_BUCKET`, `src/lib/evidence.ts`, `src/server/pg-store.ts` object_key rows) | keep bucket, collapse to one layout + one bucket | bucket ops in infra-live #41 | #1650 |
| 11 | emails | B (live) | inbound MIME in the mail-plane S3 (`EMAILS_INGEST_S3_BUCKET`/prefix, `hasna-emails-prod-inbound-<acct>`); attachments addressed by `object_key` columns into the MIME (`src/server/self-hosted/migrations.ts`, `ingest-worker.ts`); Postgres holds metadata rows | keep; retire copies in other accounts | bucket already exists; cleanup sequenced via infra-live #41 | #1589/#41 |
| 12 | instructions | C | `configs` + `config_snapshots.content TEXT` + `profiles` JSONB in Postgres (`migrations/0001_instructions.sql`) | — | — | — |
| 13 | hooks | C | `hooks`/`hook_versions` rows: `manifest_json`, `script_sha256`, `artifact_key` text only (D1/SQLite, `src/cf/d1-migrations.sql`) | — | — | — |
| 14 | loops | C | `loops`/`loop_runs`/`daemon_lease` rows; `tenant-backfill-s3.ts` is a one-off restore tool (approved `sha256-*` bundles), not a storage dependency | — (template bundles could join A later) | — | — |
| 15 | mementos | C | notes graph rows (SQLite/Postgres, `src/storage.ts`) | — | — | — |
| 16 | contacts | C | rows only (`avatar_url TEXT` is an external URL, no stored bytes; migrations 0001–0008) | — | — | — |
| 17 | calendar | C | rows only (migrations 0001–0002; attachment mention is a metadata comment) | — | — | — |
| 18 | domains | C | rows only | — | — | — |
| 19 | notes | C | rows only | — | — | — |
| 20 | shortlinks | C | rows only | — | — | — |
| 21 | economy | C | rows only (migrations 0001) | — | — | — |
| 22 | secrets | C | values stored encrypted as TEXT in DB (`src/db.ts` value/value_blob, AES-GCM); no object store | — | — | — |
| 23 | messages | C | rows only | — | — | — |
| 24 | identities | C | (source in hasna-internal/internal-apps) JSONB identity store + audit rows; voice/avatar media generated **on stations** (`src/media.ts` → home-dir writes), nothing hosted | — | — | — |
| 25 | subscriptions | C | (source in hasna-internal/internal-apps) `subscriptions`/`custom_tools` JSONB rows, aliases, auth status (migrations 0001–0008); no bytes | — | — | — |

**Totals: A = 6 · B = 5 · C = 14 (25 hosted).** No other hosted app stores bytes today.

## Unhosted packages (20)

| Package | Needs bucket if hosted? | Evidence/notes |
|---------|------------------------|-----------------|
| connectors | yes | 700+ connector catalog; connector state/media tables include bytea columns (owner live-schema census: bytea ×24); media/upload flows (e.g. `src/core/connectors/googledrive.ts` media handling). No hosted placement today — hosting it first requires a bucket. |
| repos | yes | artefact/release-provenance concepts (`src/release/provenance.ts`, rungs, write/verify-provenance); owner census: bytea ×22. |
| computers | yes | machine snapshots (`src/storage/index.ts`, `src/server.ts`) — bytes today on the box. |
| prompts | yes | render artefacts + registry S3 refs already in code (`PROMPTS_REGISTRY_S3_BUCKET` handling in `src/db/`). |
| monitor | yes | snapshot delivery via S3 already wired (`MONITOR_S3_BUCKET`/`MONITOR_S3_PREFIX`, `src/cloud-runtime.ts`). |
| clip | yes | screenshots; note: **no `apps/clip` directory on origin/main** — package is not in this repo; classification recorded for the owner's registry. |
| automations | no | rows/text only (no S3/bytea in src). |
| bridge | no | rows/text only. |
| changelog | no | rows/text only. |
| dispatch | no | rows/text only (route config). |
| events | no | rows/text only (webhook channel rows). |
| feedback | no | rows/text only. |
| guardrails | no | rows/text only. |
| orgs | no | rows/text only. |
| releases | no | rows/text only. |
| servers | no | rows/text only. |
| snapshots | no | rows/text only in this repo (distinct from computers/clip snapshot bytes). |
| statusline | no | rows/text only. |
| workflows | no | rows/text only. |
| contracts | no | `@hasna/contracts` is the **kit vendor itself** (publish-only, no storage of its own; ships the artifact-remote kit for the A-class consumers). |

**Unhosted: 6 need a bucket before any hosted placement; 13 stay local-only; contracts = kit vendor, publish-only.**

## Sequencing (S3 family)

Dependency chain that every subsequent issue in this family must respect:

1. **kit** — #1631 (+ prototype #1639 MERGED: skills bundles push/pull/pin live in-tree). A-class consumers import the kit surface from `apps/contracts`/skills reference.
2. **#1645 recordings** — audio is actively being lost (only filename on the recording machine); highest urgency.
3. **#1646 conversations** — BYTEA in shared RDS: bloat + backup weight; mechanical migration to content-addressed objects.
4. **#1647 todos** — set the prod bucket (`HASNA_TODOS_S3_BUCKET`), upload at artifact creation (store + sync already implemented).
5. **#1648 logs** — per-app bucket, upload segments at creation.
6. **#1649 telephony** — copy provider media into bucket on arrival.
7. **#1650 attachments + files** — align the two live stores (one key layout, versioning + lifecycle, one evidence bucket).
8. **Buckets in infra-live** — create/align buckets + task-role policies per the taxonomy; retire the emails copies in other accounts (#41 comment list).

Kit consumers: skills (#1630), projects (#1593), knowledge (#1633), recordings (#1645), todos (#1647), logs (#1648). Reactions: all six need `s3:PutObject/GetObject/DeleteObject` on their bucket+prefix granted to their ECS task role; B-class apps need the same grant for plain byte storage, and conversations additionally needs a table→object migration path.

## Verification notes

- Read on origin/main: migrations/schema + storage code for all 25 hosted apps; S3 env-var/API usage across `apps/*`; deploy lanes `.github/workflows/deploy-{conversations,mementos,projects,skills,todos}.yml`.
- identities and subscriptions sources live in hasna-internal/internal-apps (read-only via API); both classified C.
- attachments/files/emails are the only hosted apps with production S3 today (all class B).
- No hosted app ships versioned immutable artefacts to a durable remote today; skills is the only A-class app with the kit mechanics merged and unexercised in prod.