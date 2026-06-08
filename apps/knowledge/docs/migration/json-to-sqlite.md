# JSON To SQLite Migration

`open-knowledge` began as a simple JSON note store. Current project mode uses a
Hasna app workspace and a versioned SQLite catalog:

```text
.hasna/apps/knowledge/
  db.json
  knowledge.db
  artifacts/
  indexes/
  logs/
  runs/
  schemas/
  wiki/
```

The JSON store remains available for compatibility with note commands such as
`add`, `list`, `get`, `update`, `delete`, and `export`. The SQLite catalog is
used for source refs, source revisions, chunks, citations, embeddings, wiki
pages, generated artifacts, runs, audit events, and reindex jobs.

## What Migrates Automatically

Global legacy notes are migrated on first use:

```text
~/.open-knowledge/db.json
```

to:

```text
~/.hasna/apps/knowledge/db.json
```

This happens only when the new Hasna JSON store does not already exist. The
legacy file is not deleted.

Project mode writes directly to:

```text
<project>/.hasna/apps/knowledge/db.json
```

when compatibility note commands are used with `--scope project`.

## What Requires Explicit Ingestion

SQLite knowledge records are not inferred from old JSON notes automatically.
Use explicit commands so provenance, permissions, citations, and redaction are
recorded correctly.

Initialize the project catalog:

```bash
open-knowledge db init --scope project --json
open-knowledge wiki init --scope project --json
```

Import open-files manifests:

```bash
open-knowledge ingest manifest ./open-files-manifest.jsonl --scope project --json
```

Import one allowed source ref:

```bash
open-knowledge ingest source file:///absolute/path/to/handbook.md \
  --purpose knowledge_index \
  --scope project \
  --json
```

Resolve indexed source evidence:

```bash
open-knowledge source resolve open-files://file/file_123/revision/rev_456 \
  --purpose knowledge_answer \
  --scope project \
  --json
```

## Recommended Migration Path

1. Keep the legacy JSON note store as an exportable compatibility layer.
2. Run `open-knowledge paths --scope project --json` and confirm the project
   workspace is `.hasna/apps/knowledge`.
3. Initialize `knowledge.db` with `open-knowledge db init --scope project`.
4. Ingest source manifests from `open-files` rather than copying raw files into
   `open-knowledge`.
5. Run `open-knowledge search --scope project --json` to verify source chunks.
6. Run `open-knowledge wiki compile` for durable cited pages.
7. Run `open-knowledge wiki lint --scope project --json` before treating pages
   as company knowledge.
8. Use `open-knowledge export --format jsonl` if legacy notes need to be
   archived or transformed outside the app.

## JSON Output Contracts

Use `--json` during migration. Commands return stable objects with `ok: true`
when successful and command-specific fields such as:

- `paths`: workspace paths and config.
- `db stats`: schema version and table counts.
- `ingest manifest`: sources, revisions, chunks, redactions, and skipped rows.
- `source resolve`: read-only source metadata, chunks, citations, and evidence.
- `search --context`: excerpts, citations, graph evidence, and warnings.
- `ask|build`: run id, answer, context, citations, proposed wiki updates, write
  policy, usage, and warnings.
- `wiki compile`: page id, artifact URI, citations written, index updates, and
  log shard key.

## Safety Rules During Migration

- Prefer `open-files://` refs for durable company sources.
- Keep raw source bytes in `open-files`; do not import them as generated wiki
  artifacts.
- Enable S3 reads only for allowed buckets:

```bash
HASNA_KNOWLEDGE_ALLOW_S3_READS=1 \
HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS=my-bucket \
open-knowledge ingest manifest s3://my-bucket/path/manifest.jsonl \
  --scope project \
  --json
```

- Enable web search only when current external context is required:

```bash
HASNA_KNOWLEDGE_WEB_SEARCH=1 \
open-knowledge web search "current policy source" --provider openai --json
```

- Use `--approve-write` only when a generated wiki artifact should be durable.

## Hosted Migration

Hosted mode should not change local migration semantics. It only records a
remote API boundary:

```bash
open-knowledge setup --mode hosted --api-url https://knowledge.hasna.xyz --scope project --json
open-knowledge remote contracts --scope project --json
```

A SaaS wrapper can later sync generated artifacts, run jobs, enforce tenant ACLs,
and store artifacts in S3, but the local package remains usable without a hosted
account.
