# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.2.x | yes |

## Reporting A Vulnerability

Do not open a public GitHub issue for security vulnerabilities. Use GitHub
Security Advisories or contact the maintainer privately through GitHub.

Include the vulnerable command/API, reproduction steps, expected impact, and any
known mitigations.

## Local Safety Model

`@hasna/knowledge` is local-first. The default workspace is
`.hasna/knowledge` for project scope and `~/.hasna/knowledge` for
global scope. Legacy note data may be migrated from `~/.open-knowledge/db.json`
into `~/.hasna/knowledge/db.json`; source ingestion into `knowledge.db`
remains explicit.

Default policy:

- Writes are expected to stay inside the resolved `.hasna/knowledge`
  workspace.
- `open-files://` source access is read-only.
- Web search is disabled unless explicitly enabled.
- S3 manifest/outbox reads are disabled unless explicitly enabled and scoped to
  allowed buckets.
- Generated knowledge writes require an approval gate by default.
- Known secret patterns are redacted before source text is stored as chunks.
- Safety checks, approvals, redactions, source reads, and knowledge writes are
  recorded in `audit_events`.
- Prompt, embedding, web-search, reindex, and wiki operations record run ledgers
  in `runs` and `run_events`.

Inspect the active policy:

```bash
knowledge safety status --scope project --json
```

Approve a local generated write:

```bash
knowledge safety approve generated_write wiki://answer --scope project --json
```

Review the local audit log:

```bash
knowledge safety audit --scope project --json
```

## Network And S3

Network behavior is opt-in. For local CLI use:

```bash
HASNA_KNOWLEDGE_WEB_SEARCH=1 knowledge safety check web_search --json
HASNA_KNOWLEDGE_ALLOW_S3_READS=1 \
HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS=my-bucket \
knowledge ingest manifest s3://my-bucket/path/manifest.jsonl --json
```

For persistent config, set:

```json
{
  "safety": {
    "network": {
      "web_search_enabled": false,
      "s3_reads_enabled": true,
      "allowed_s3_buckets": ["my-bucket"]
    }
  }
}
```

Do not store AWS access keys in knowledge manifests or generated wiki files. Use
named AWS profiles or the runtime credential chain.

## Source And Artifact Boundary

`open-files` owns raw source bytes, source snapshots, connector credentials,
file revisions, hashes, MIME metadata, and storage locations. `knowledge`
stores source refs, derived chunks, citations, embeddings, generated wiki pages,
indexes, logs, and run ledgers.

Security expectations:

- Prefer `open-files://` refs for durable company knowledge.
- Treat `file://`, `s3://`, and `https://` ingestion as bootstrap paths that
  still store only redacted derived chunks.
- Do not put raw source files, connector credentials, or cloud storage secrets
  under `.hasna/knowledge/artifacts`.
- Generated wiki pages must cite source refs or explicit citation evidence.
- Semantic search and MCP resources must preserve provenance and must not expose
  raw source bytes.

## MCP

The MCP server defaults to stdio. Streamable HTTP mode binds to `127.0.0.1`.

```bash
knowledge-mcp
knowledge-mcp --http --port 8819
```

MCP clients should prefer stable tools such as `knowledge_search`,
`knowledge_ask`, `knowledge_build`, `knowledge_get`, `knowledge_lint`, and
`knowledge_run_status`. MCP resources such as `knowledge://project/sources`,
`knowledge://project/wiki/pages`, and `knowledge://project/runs` are inspection
surfaces for derived knowledge state. They must not be treated as raw-file
download endpoints.

## Hosted Mode

Hosted/SaaS mode must preserve the same boundaries with stronger enforcement:

- tenant-scoped workspaces and buckets;
- server-side approval gates for generated writes;
- central audit retention;
- provider and web-search allowlists;
- no direct raw-file writes from knowledge agents;
- source content resolved through `open-files` read-only APIs.

The OSS package must not contain hosted tenant secrets, connector OAuth tokens,
RDS passwords, billing state, or privileged cloud role credentials. Those belong
to the hosted wrapper described in
`docs/architecture/hosted-wrapper-responsibilities.md`.

## Secret Redaction

The local redactor catches common API keys, AWS access key ids, private key
blocks, and `token`/`secret`/`password` assignments. It is a guardrail, not a
complete DLP system. Treat redaction findings as evidence to improve source data
hygiene, not as proof that every secret has been removed.
