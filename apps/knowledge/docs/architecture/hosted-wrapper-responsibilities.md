# Hosted Wrapper Responsibilities

`open-knowledge` stays local-first and open source. A future hosted/SaaS wrapper
can implement remote APIs around the same contracts, but tenant state,
infrastructure ownership, and commercial controls must live outside this
package.

## Boundary

The OSS package owns:

- Local CLI and MCP behavior.
- `.hasna/apps/knowledge` workspaces.
- Local SQLite schema, local artifact catalog, generated wiki artifacts, local
  vector rows, run ledgers, and BYOK provider calls.
- Source refs, derived chunks, citations, provenance, and read-only resolver
  contracts.
- Remote client shapes for `registry`, `search`, `ask`, `build`, `sync`,
  `run_status`, `run_logs`, and `run_artifacts`.

The hosted wrapper owns:

- Tenants, users, orgs, projects, memberships, roles, invitations, sessions, API
  keys, and service accounts.
- Per-tenant permission checks before retrieval, generation, web search,
  artifact reads, artifact writes, and source sync.
- Hosted databases, object storage, queue infrastructure, workers, secret
  storage, web UI, billing, rate limits, moderation, observability, and admin
  operations.

Local mode must not require hosted identity, billing, queue workers, or hosted
object storage. Hosted mode is an explicit remote boundary selected through
`open-knowledge setup --mode hosted` plus `KNOWLEDGE_API_URL` and
`KNOWLEDGE_API_KEY`.

## Identity And Access

The hosted wrapper should model:

- `users`: human accounts, verified emails, auth identities, MFA state, disabled
  state, and profile metadata.
- `orgs`: billing/legal tenants, org slugs, data residency settings, default
  retention policies, and owner/admin contacts.
- `projects`: knowledge workspaces under an org, project slugs, connected
  source scopes, default model/search settings, and artifact storage policy.
- `memberships`: user to org/project role assignments.
- `api_keys`: scoped keys for CLI, MCP, CI, workers, and web UI sessions.
- `service_accounts`: non-human actors for ingestion, sync, indexing, and
  scheduled maintenance.

Permission checks must happen before context assembly. The wrapper should never
retrieve broad context and filter after generation. The retrieval API should
accept caller identity, project id, requested purpose, source refs, and requested
operations, then return only authorized source chunks, generated artifacts, and
citations.

## Open-Files Integration

`open-files` remains the source of truth for raw source bytes. The hosted wrapper
should own connector orchestration and source sync:

- Google Drive, Slack, GitHub, Notion, S3, local-upload, web crawl, and future
  connector credentials.
- Connector OAuth flows, refresh tokens, webhook registrations, cursor state,
  backoff, retries, and error recovery.
- Source snapshots, immutable object ids, revisions, hashes, MIME metadata,
  extracted text refs, ACL metadata, and change outboxes.
- Read-only resolver APIs that expose derived extracted text or allowed chunks
  to `open-knowledge` without exposing storage credentials.

`open-knowledge` should continue to consume manifests, source refs, and outbox
events. It should not own connector credentials or raw source object lifecycle.

## Storage And Secrets

The hosted wrapper should provision and enforce:

- Per-org/project generated-artifact prefixes in S3 or another object store.
- Bucket policies, KMS keys, retention rules, lifecycle rules, replication, and
  object lock settings where required.
- Secrets for provider keys, connector keys, AWS roles, RDS URLs, webhook
  secrets, and encryption material.
- Migration aliases from legacy bucket and secret names to canonical names.

The OSS package may know a storage contract, bucket name, prefix, region, and
profile. It must not contain tenant secret values, connector credentials, RDS
passwords, hosted KMS key material, or privileged AWS role assumptions.

For Hasna XYZ production, the OSS contract names
`hasna-xyz-opensource-knowledge-prod` and prefix
`.hasna/apps/knowledge/`, plus metadata-only secret paths under
`hasna/xyz/opensource/knowledge/prod/{env,aws,s3}`. Hosted code is responsible
for resolving those secrets, assuming AWS roles, enforcing tenant prefixes, and
provisioning `hasna/xyz/opensource/knowledge/prod/rds` only if a hosted runtime
database is introduced.

Generated artifacts are safe to sync remotely only when they remain derived:
wiki pages, index shards, schema files, logs, exports, run payloads, embeddings,
and citation metadata. Raw source bytes stay in `open-files`.

## Remote Jobs

The wrapper should implement durable jobs for:

- Manifest import and source sync from `open-files`.
- Extraction and redaction refresh.
- Embedding index refresh and stale-revision invalidation.
- Provider-native web search with audit logs and source capture.
- Wiki compile, answer filing, lint, and maintenance runs.
- Artifact sync between local clients and hosted storage.
- Remote search, ask, and build workflows.

Jobs should expose the same run contract as the local package: status, prompt or
query, provider/model, usage, citations, artifacts, events, logs, errors,
timestamps, and cost metadata. Workers should be idempotent and keyed by source
revision, artifact hash, or run id where possible.

## API Surface

The wrapper should implement the contract printed by:

```bash
open-knowledge remote contracts --scope project --json
```

Required endpoint families:

- `registry`: service capabilities, contract version, source contract, artifact
  contract, and limits.
- `search`: permission-aware hybrid retrieval.
- `ask`: retrieval plus answer generation.
- `build`: retrieval plus generated artifact proposals or approved writes.
- `sync`: source/artifact synchronization.
- `runs`: status, logs, events, usage, and artifacts.
- `artifacts`: generated artifact reads and writes with policy checks.

The web UI should use the same API surface as CLI/MCP clients. It should not
gain hidden write paths that bypass approval gates, source permission checks, or
run ledgers.

## Billing, Limits, And Abuse Controls

The hosted wrapper owns:

- Plan limits for seats, projects, sources, storage, embeddings, web search,
  provider tokens, and scheduled jobs.
- Per-user, per-org, per-project, and per-key rate limits.
- Provider cost attribution and billing events.
- Abuse detection for web search, provider calls, bulk exports, connector syncs,
  and artifact downloads.
- Admin controls to pause projects, rotate keys, disable connectors, revoke API
  keys, and quarantine generated artifacts.

Local OSS mode may report provider usage, but it must not require billing.

## Audit And Observability

The hosted wrapper should record:

- Authentication and API-key events.
- Source connector reads, source resolver reads, and source permission denials.
- Search, ask, build, compile, lint, web-search, sync, and export runs.
- Generated artifact writes, approvals, rejections, and rollbacks.
- Admin and moderation actions.
- Worker retries, dead-letter events, queue latency, token usage, cost, and
  storage growth.

Local run ledgers and audit events remain useful for offline workflows. Hosted
audit logs should add tenant identity, actor identity, IP/user-agent metadata,
request ids, and retention controls.

## Non-Goals For OSS

The OSS package should not implement:

- Hosted user/org/project management.
- Billing, plans, commercial rate limits, or invoices.
- Hosted connector OAuth flows or connector credential storage.
- Shared multi-tenant ACL enforcement.
- Hosted queue workers, RDS provisioning, bucket provisioning, KMS management,
  or admin/moderation workflows.
- A privileged web UI write path.

The OSS package can expose the contracts and local behavior needed to make those
systems straightforward to build on top.
