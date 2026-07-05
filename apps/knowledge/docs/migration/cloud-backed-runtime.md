# Cloud-Backed Runtime Preparation

`@hasna/knowledge` remains local-first. Cloud-backed operation is prepared as
explicit storage contracts and diagnostics; it does not provision AWS, create
secrets, run Terraform, migrate live data, or upload private knowledge by
itself.

## Runtime Modes

Local mode is the default:

- Catalog: `.hasna/knowledge/knowledge.db`.
- Generated artifacts: `.hasna/knowledge/artifacts/`.
- Source ownership: raw source bytes stay in `open-files`; `knowledge` stores
  source refs, revisions, chunks, citations, indexes, runs, and generated wiki
  artifacts.
- Cloud credentials: none required.

Hybrid catalog mode is opt-in:

- Set `HASNA_KNOWLEDGE_DATABASE_URL` or `KNOWLEDGE_DATABASE_URL`.
- Optionally set `HASNA_KNOWLEDGE_STORAGE_MODE=hybrid` or
  `KNOWLEDGE_STORAGE_MODE=hybrid`.
- Local SQLite remains the working catalog and sync metadata store.
- Explicit `knowledge db storage push|pull|sync` commands move selected catalog
  tables to or from PostgreSQL after approval.

Remote catalog mode is reserved for hosted/runtime wrappers:

- Set `HASNA_KNOWLEDGE_STORAGE_MODE=remote` or `KNOWLEDGE_STORAGE_MODE=remote`
  plus a database URL env var.
- `knowledge db storage status` reports the selected mode and active env var
  name, but it does not print or connect with the database URL.
- Hosted wrappers still own tenant auth, ACLs, queues, billing, observability,
  RDS provisioning, secret resolution, and live migration approval.

S3 artifact storage is independent of catalog mode:

- Configure `storage.type=s3` in `.hasna/knowledge/config.json`, or use the
  canonical example via `knowledge setup --mode hosted --canonical-example`.
- Only generated artifacts are S3 candidates: wiki pages, indexes, schemas,
  logs, runs, exports, and artifact manifests.
- Raw source bytes and connector credentials remain outside `open-knowledge`.

## Diagnostics

Use these commands before any migration or hosted handoff:

```bash
knowledge storage status --scope project --json
knowledge storage validate --scope project --json
knowledge db storage status --scope project --json
knowledge remote contracts --scope project --json
```

`knowledge storage status` reports `cloud_runtime`, including:

- local SQLite path and catalog env var names,
- local versus S3 generated artifact URI prefix,
- hosted API env var names,
- privacy gates for raw source bytes and secret values,
- approval gates for provisioning and live migration.

`knowledge db storage status` reports `runtime`, including:

- selected catalog mode: `local`, `hybrid`, or `remote`,
- active database env var name only,
- confirmation that status does not connect to PostgreSQL,
- explicit push, pull, and sync commands for catalog migration.

## Migration Gates

These operations require separate approval and should be represented as their
own task or infrastructure workflow:

- production AWS mutation,
- RDS or S3 provisioning,
- secret creation, rotation, or payload inspection,
- Terraform apply,
- bulk private source upload or migration,
- live catalog migration into a shared hosted database.

For an approved staged catalog sync, use table-scoped commands first:

```bash
knowledge db storage push --scope project --tables sources,chunks,storage_objects --json
knowledge db storage pull --scope project --tables sources,chunks,storage_objects --json
```

Run `knowledge sync doctor --scope project --json` afterward to verify artifact
manifests, source-boundary sentinels, provenance, and modified-time evidence.
