# @hasna/access

`open-access` is the scalable access gate for Hasna agents and services. Agents
request access, API keys, provider credentials, MCP scopes, and short-lived
bearer tokens here; `open-access` records the decision, exposes the same
operation through CLI/MCP/REST, and keeps an auditable inventory of which
identity can use which reference.

- **npm:** `@hasna/access` · **bins:** `access`, `access-mcp`, `access-serve`
- **serve port:** 3483 · **MCP HTTP port:** 8887
- **store:** local `bun:sqlite` at `~/.hasna/access/access.db`, or cloud
  Postgres (`HASNA_ACCESS_STORAGE_MODE=cloud`, pure remote, `sslmode=verify-full`)
  through the vendored `@hasna/contracts` storage kit

`open-access` is intentionally not a secret vault. It never stores raw provider
tokens, API keys, app passwords, private keys, or OAuth refresh tokens. Credential
records store `secret_ref` strings only; the values live in `@hasna/secrets`
(open-secrets) or in the provider's own system.

## Domain

| Resource | What it holds |
|---|---|
| **identities** | local access subjects for agents, services, and humans: home `entity_id`, optional `entity_slug`, owner ref, status, and metadata |
| **credentials** | credential references only: `secret_ref` values pointing at `@hasna/secrets` or an external provider, never raw values |
| **scopes** | MCP tool scopes granted per identity, such as `wallets:read` or `secrets:write` |
| **elevations** | just-in-time elevation requests with identity, scope, reason, approver, and expiry |
| **access_reviews** | scheduled recertification campaigns |
| **revocations** | one-click audited revocation for credentials, scopes, elevations, tokens, or an identity cascade |
| **tokens** | issued MCP bearer tokens; the raw token is returned once, then only its hash is stored |
| **audit** | append-only, hash-chained lifecycle events |

Every record is anchored to a home `entity_id` (an unguessable UUIDv4) and is
authorized against the caller's scopes plus allowed entity set. Knowing an id is
not authority.

## Access Gate Shape

The gate is designed around this flow:

1. Resolve or create the agent/service profile in `open-identities`.
2. Register the access identity in `open-access` with the same durable identity
   reference carried in `owner_ref` or metadata, and the tenant boundary carried
   by `entity_id`.
3. Record what the identity needs: a credential reference, an MCP/API scope
   grant, a pending JIT elevation request, or an issued access bearer token.
4. Store secret material outside this package, then register only the
   `@hasna/secrets` `secret_ref` in `open-access`.
5. Use reviews and revocations to recertify or remove access without exposing
   the underlying provider token.

The current policy is permissive and operational: if the authenticated caller has
the required access scope and entity reach, `open-access` records the request or
grant. It does not yet evaluate declarative policy definitions such as
`provider == npm`, approval quorum, maximum TTL, allowed package scope, or
environment-specific break-glass rules. Those policy definitions are the next
layer; the existing records are the audit and enforcement substrate they will
evaluate.

### NPM Token Workflow

For NPM publishing, do not paste the NPM token into `open-access`.

```bash
# 1. Create or resolve the agent identity in open-identities, then register it here.
access identity create \
  --entity-id <home-entity-uuid> \
  --kind agent \
  --name publish-bot \
  --owner-ref open-identities:agent:publish-bot

# 2. Store the token value in @hasna/secrets/open-secrets, then register only the ref.
access credential register \
  --identity-id <access-identity-id> \
  --kind api_key \
  --name npm-publish-token \
  --secret-ref hasna/access/npm/publish-token

# 3. Grant the least provider-policy scope the agent needs. This does not
#    authorize open-access API calls by itself.
access scope grant --identity-id <access-identity-id> --scope npm:publish

# 4. Issue short-lived access bearer tokens only for access/MCP calls.
#    Grant and issue access API scopes separately from provider scopes.
access scope grant --identity-id <access-identity-id> --scope access:read
access token issue \
  --identity-id <access-identity-id> \
  --scopes access:read \
  --ttl-minutes 60
```

The provider token remains in `@hasna/secrets` or NPM. The access-issued bearer
token is for the access/MCP cohort path; it is not a replacement for a provider
token.

## Relationship To open-identities

`open-identities` owns the canonical identity record: names, durable identifiers,
agent roster metadata, instruction sources, contact points, and narrative docs.
`open-access` owns the authorization inventory for those identities: credential
references, granted scopes, JIT elevations, access reviews, revocation state, and
access-issued bearer tokens.

The integration boundary is by reference, not by duplication:

- `owner_ref` should carry the durable identity reference, such as
  `open-identities:agent:publish-bot` or `agent:publish-bot`.
- `entity_id` remains the tenant/access boundary used by the authorization layer.
- Optional metadata may carry non-sensitive lookup fields such as
  `identity_ref`, `agent_role`, or `source`.
- `open-access` should not copy identity documents, prompt files, contact values,
  profile images, or instruction-source content from `open-identities`.

## SecretRef Contract

Credential and access-request records require strict `secret_ref` references.
The value is an opaque pointer, not a secret value. Valid examples are
namespaced references like `hasna/access/npm/publish-token` or provider-managed
references such as `provider:npm:automation-token:publish-bot`.

Rules:

- Store raw values in `@hasna/secrets`/open-secrets or the provider system.
- Register only the reference string in `open-access`.
- Rotate by updating the secret in the owning system, then update or revoke the
  access credential reference as needed.
- Revoke in both places when a provider token is compromised: revoke the provider
  token or vault item, then run the corresponding `access revocation execute`.
- Do not put secret values in metadata, audit comments, task comments, logs, or
  docs.

The services reject non-reference strings, common raw-secret prefixes, private
key blocks, bearer tokens, and raw-looking API key metadata as guardrails, but
those checks are not a substitute for using the secrets system correctly.

## Surfaces

CLI, MCP tools, and `/v1` REST all dispatch through one operation registry
(`src/services/registry.ts`), so a capability added to one surface appears on all
three.

```bash
# CLI (add --json for machine output)
access identity create --entity-id <uuid> --kind agent --name billing-bot
access credential register --identity-id <id> --kind api_key --name provider-key --secret-ref hasna/access/provider/key
access scope grant --identity-id <id> --scope wallets:read
access elevation request --identity-id <id> --scope secrets:write --reason "rotate key" --ttl-minutes 30
access token issue --identity-id <id>
access revocation execute --identity-id <id> --target-type identity --reason offboarded

# serve (Hono)
access-serve                 # GET /health /ready /version, /v1/*

# MCP (Streamable HTTP + mandatory bearer auth outside local loopback dev)
access-mcp --http --port 8887
```

## Cloud Mode

Local mode is for development and single-machine use. Cloud mode is pure remote:
reads and writes go to the app-owned cloud Postgres store, not to local SQLite.

```bash
export HASNA_ACCESS_STORAGE_MODE=cloud
export HASNA_ACCESS_DATABASE_URL_FILE=/run/secrets/access-database-url
export HASNA_ACCESS_API_CREDENTIALS='[{"id":"access-operator","token":"<redacted>","roles":["owner"],"entity_ids":["<entity-id>"]}]'
export HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE=/run/secrets/access-token-signing-key
access-serve
```

Cloud mode must run with API credentials configured. A non-loopback bind or cloud
mode without credentials fails closed at startup. Cloud mode and exposed bind
hosts also require a configured strong token signing key; the local dev signing
key is accepted only for local loopback development. Database status output is
redacted and never prints a DSN.

## Security

- **MCP HTTP** requires a per-caller bearer token; auth may be disabled only in
  local mode on a loopback bind.
- **`/v1`** uses the shared scope/role/entity-scoping stack, deny-by-default,
  CORS deny-by-default, rate limiting, and fail-closed startup posture.
- **Credentials store references only** - never secret values.
- **Issued access tokens** store only `token_hash` internally; normal read/list
  responses redact that hash, and the raw token is returned only at issuance.
- **Audit log** is append-only (SQLite triggers block update/delete) and
  hash-chained; it is excluded from storage push/pull/sync.
- **Storage status** is redacted; push/pull/sync are elevated-scope gated.

## Threat Model

`open-access` assumes provider tokens and API keys are high-value secrets. The
primary risks are accidental value storage, over-broad agent scopes, stale
credentials after offboarding, confused identity references, exposed unauthenticated
HTTP/MCP transports, and cloud/local storage misconfiguration.

Current mitigations:

- raw provider values stay outside `open-access`
- credential and access-request writes accept only strict `secret_ref` pointers
  and reject raw-looking secret values in sensitive fields
- records are scoped by `entity_id` and caller scopes
- bearer tokens are hashed at rest, expire, enforce TTL ceilings, and require a
  strong configured signing key outside local loopback development
- revocations and access reviews create auditable cleanup paths
- cloud and non-loopback serving fail closed without API credentials
- status/health/storage outputs avoid DSNs and credential values

Remaining policy work: declarative policy definitions should decide which
requesters, providers, scopes, packages, environments, TTLs, and approval paths
are allowed before access records become active.

## Non-Goals

- Secret vaulting or secret retrieval. Use `@hasna/secrets`/open-secrets or the
  provider's secret system for values.
- Provider provisioning. `open-access` records, gates, and previews provider
  access; provider-specific CLIs or workers create, rotate, and revoke
  provider-side tokens after approval.
- Replacing `open-identities`. Identity profiles, documents, contact points, and
  instruction sources remain there.
- A complete declarative policy engine in the current release. The records here
  are shaped so that later policy definitions can evaluate them.
- Storing raw NPM, GitHub, cloud, OAuth, SSH, or webhook credentials.

## Develop

```bash
bun install
bun run verify   # typecheck + test + build + conformance
```

## Migration From 0.1.0

This release adds a real forward migration. Existing local stores are backed up
before the shape-changing step, the `access_requests` table is added, and old
unapproved `active` elevation rows are demoted to `pending` so they are not
effective until approval. Existing approved active elevations, identities,
credentials, scopes, reviews, revocations, tokens, and audit rows remain valid.

To adopt the new operating model:

1. Inventory any provider/API token that an agent currently uses.
2. Move the raw value into `@hasna/secrets`/open-secrets or leave it in the
   provider system if the provider owns its lifecycle.
3. Register only a `secret_ref` in `open-access`.
4. Backfill `owner_ref` or metadata with the matching `open-identities` durable
   reference.
5. Replace broad or implicit access with explicit scope grants, JIT elevations,
   and access reviews.
6. Run revocation for stale credentials after the provider/vault value has been
   retired.

## Release Checklist

1. Confirm the branch and diff contain only intended changes:
   `git status --short --branch && git diff -- README.md docs package.json`
2. Run verification:
   `bun run verify`
3. Check the OpenAPI artifact if routes changed:
   `bun run openapi:check`
4. Run a staged secrets scan before any commit or publish. Use the repo/CI
   scanner if configured; otherwise inspect the staged diff for common credential
   markers and remove any hit before continuing.
5. Run package smoke:
   `bun run smoke:package`
6. Publish with an authorized npm profile:
   `npm publish --access public`
7. Post-publish smoke from the published package:
   `bun run smoke:package -- --package-spec @hasna/access@<version>`
8. Verify registry metadata:
   `npm view @hasna/access version dist-tags.latest`

Do not publish from a dirty tree, with unreviewed generated output, or with any
secret value present in the diff, logs, task comments, or release notes.

See [docs/access-gate-runbook.md](docs/access-gate-runbook.md) for the compact
operator runbook.

License: Apache-2.0.
