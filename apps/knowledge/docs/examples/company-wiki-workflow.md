# Company Wiki Workflow

This workflow shows how to use `open-knowledge` as an AI-native company wiki
layer over source files owned by `open-files`.

## 1. Initialize The Project Workspace

```bash
open-knowledge paths --scope project --json
open-knowledge db init --scope project --json
open-knowledge wiki init --scope project --json
```

Project state is created under:

```text
.hasna/apps/knowledge/
  config.json
  knowledge.db
  artifacts/
  indexes/
  logs/
  runs/
  schemas/
  wiki/
```

## 2. Import Source Metadata From Open-Files

Use an `open-files` manifest with source refs, revisions, permissions, hashes,
and extracted text:

```json
{
  "source_ref": "open-files://file/file_handbook/revision/rev_20260608",
  "file_id": "file_handbook",
  "path": "Handbook/Policy.md",
  "name": "Policy.md",
  "mime": "text/markdown",
  "hash": "sha256:...",
  "status": "active",
  "permissions": {
    "mode": "read_only",
    "allowed_purposes": ["knowledge_answer", "knowledge_index"]
  },
  "extracted_text": "Policy text..."
}
```

Then ingest it:

```bash
open-knowledge ingest manifest ./open-files-manifest.jsonl --scope project --json
```

The knowledge app stores source refs, revisions, redacted chunks, offsets, and
citations. It does not store raw source bytes or connector credentials.

## 3. Search And Build Context

Run local keyword/catalog search first:

```bash
open-knowledge search "expense policy" --scope project --json
```

Add deterministic local semantic indexing for a smoke test:

```bash
open-knowledge embeddings index --scope project --fake --dimensions 8 --json
open-knowledge search "expense policy" --scope project --semantic --fake --dimensions 8 --json
```

Ask for an agent-ready context pack:

```bash
open-knowledge search "expense policy" --scope project --context --json
```

## 4. Answer With Citations

Create a local citation draft:

```bash
knowledge "How do we approve expenses?" --scope project --json
```

Use provider generation explicitly:

```bash
OPENAI_API_KEY=... \
knowledge "How do we approve expenses?" \
  --scope project \
  --generate \
  --model openai:gpt-5-mini \
  --json
```

Every prompt run records `runs`, `run_events`, provider/model metadata, usage,
citations, and proposed wiki updates.

## 5. Compile Durable Wiki Pages

Compile a cited page from indexed chunks:

```bash
open-knowledge wiki compile "expense policy" \
  --title "Expense Policy" \
  --scope project \
  --json
```

File an approved answer note:

```bash
open-knowledge wiki file-answer "How do we approve expenses?" \
  --content "Use manager approval and cite the policy source." \
  --approve-write \
  --scope project \
  --json
```

Lint the generated wiki:

```bash
open-knowledge wiki lint --scope project --json
```

Generated pages are written through the artifact store and cataloged in
`knowledge.db`; index rows and logs are sharded rather than stored in one large
Markdown file.

## 6. Keep Sources Fresh

Consume open-files outbox events after source changes:

```bash
open-knowledge reindex outbox ./open-files-outbox.jsonl --scope project --json
open-knowledge reindex enqueue --scope project --json
open-knowledge reindex embeddings --scope project --fake --dimensions 8 --json
```

This invalidates stale source chunks and refreshes embeddings without losing the
source refs and citation provenance.

## 7. Expose The Wiki To Agents Through MCP

Run MCP over stdio:

```bash
open-knowledge-mcp
```

Or run local Streamable HTTP:

```bash
open-knowledge-mcp --http --port 8819
```

Agents should prefer stable tools such as `knowledge_search`, `knowledge_ask`,
`knowledge_build`, `knowledge_get`, `knowledge_lint`, and
`knowledge_run_status`. They can inspect project resources such as
`knowledge://project/wiki/pages`, `knowledge://project/runs`, and
`knowledge://project/open-files`.

## 8. Optional Hosted And S3 Mode

Hosted mode is only a remote client boundary:

```bash
open-knowledge setup --mode hosted --api-url https://knowledge.hasna.xyz --scope project --json
open-knowledge remote contracts --scope project --json
```

Generated artifacts may use S3 when configured, but raw source files still stay
in `open-files`.
