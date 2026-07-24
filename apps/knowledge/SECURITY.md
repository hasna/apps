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
- All public and internal web-search execution, including fake mode, is
  unavailable during Stage A. Retained flags, schemas, and policy fields are
  metadata only and cannot enable execution.
- Public S3 manifest/outbox reads are unavailable during Stage A.
- Generated knowledge writes require an approval gate by default.
- Known secret patterns are redacted before source text is stored as chunks.
- Safety checks, approvals, redactions, source reads, and knowledge writes are
  recorded in `audit_events`.
- Executed prompt, embedding, reindex, and wiki operations record run ledgers in
  `runs` and `run_events`; retained web-search metadata does not create an
  executable path.

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

## Stage A Network And S3

All public and internal web-search execution is unavailable during Stage A,
including fake mode, result filing, private helpers, and provider-backed paths.
Environment variables, configuration, safety approvals, and explicit caller
options cannot enable it. Web-search CLI help and MCP schemas remain only for
base-compatible metadata and return typed containment before workspace,
provider, fetch, or persistence activity.

Public S3 source and artifact access is likewise unavailable during Stage A.
Retained S3 configuration fields describe compatibility contracts only. Do not
store AWS access keys in knowledge manifests or generated wiki files.

## Source And Artifact Boundary

`open-files` owns raw source bytes, source snapshots, connector credentials,
file revisions, hashes, MIME metadata, and storage locations. `knowledge`
stores source refs, derived chunks, citations, embeddings, generated wiki pages,
indexes, logs, and run ledgers.

Security expectations:

- Prefer `open-files://` refs for durable company knowledge.
- Treat anchored local `file://` inputs and already-cataloged `open-files://`
  refs as the Stage A source boundary. Remote URI schemes are contained before
  database or workspace creation.
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

Hosted/SaaS execution is unavailable during Stage A. A future hosted wrapper
must preserve the same boundaries with stronger enforcement:

- tenant-scoped workspaces and buckets;
- server-side approval gates for generated writes;
- central audit retention;
- provider policy controls for any post-Stage-A execution;
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
