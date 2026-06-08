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
`.hasna/apps/knowledge` for project scope and `~/.hasna/apps/knowledge` for
global scope.

Default policy:

- Writes are expected to stay inside the resolved `.hasna/apps/knowledge`
  workspace.
- `open-files://` source access is read-only.
- Web search is disabled unless explicitly enabled.
- S3 manifest/outbox reads are disabled unless explicitly enabled and scoped to
  allowed buckets.
- Generated knowledge writes require an approval gate by default.
- Known secret patterns are redacted before source text is stored as chunks.
- Safety checks, approvals, redactions, source reads, and knowledge writes are
  recorded in `audit_events`.

Inspect the active policy:

```bash
open-knowledge safety status --scope project --json
```

Approve a local generated write:

```bash
open-knowledge safety approve generated_write wiki://answer --scope project --json
```

Review the local audit log:

```bash
open-knowledge safety audit --scope project --json
```

## Network And S3

Network behavior is opt-in. For local CLI use:

```bash
HASNA_KNOWLEDGE_WEB_SEARCH=1 open-knowledge safety check web_search --json
HASNA_KNOWLEDGE_ALLOW_S3_READS=1 \
HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS=my-bucket \
open-knowledge ingest manifest s3://my-bucket/path/manifest.jsonl --json
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

## Hosted Mode

Hosted/SaaS mode must preserve the same boundaries with stronger enforcement:

- tenant-scoped workspaces and buckets;
- server-side approval gates for generated writes;
- central audit retention;
- provider and web-search allowlists;
- no direct raw-file writes from knowledge agents;
- source content resolved through `open-files` read-only APIs.

## Secret Redaction

The local redactor catches common API keys, AWS access key ids, private key
blocks, and `token`/`secret`/`password` assignments. It is a guardrail, not a
complete DLP system. Treat redaction findings as evidence to improve source data
hygiene, not as proof that every secret has been removed.
