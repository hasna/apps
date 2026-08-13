# Access Gate Runbook

This runbook covers the scalable access-gate path for agents requesting provider
access or API keys. It is intentionally operational and concise; the full public
contract lives in the root README.

## Operator Flow

1. Identify the requester in `open-identities`.
   - Use the durable identity reference as the `open-access` `owner_ref`.
   - Keep identity documents, contact data, and instruction sources in
     `open-identities`.
2. Register or find the local access identity.
   - `entity_id` is the authorization boundary.
   - `kind` should be `agent`, `service`, or `human`.
3. Decide the current request under the permissive policy.
   - Today, `open-access` enforces authenticated caller scope and entity reach.
   - It does not yet evaluate declarative provider policies.
   - Record the resulting credential ref, scope grant, pending elevation request,
     token issue, or revocation so the decision is auditable.
4. Put secret values in the owning system.
   - Use `@hasna/secrets`/open-secrets for Hasna-managed values.
   - Use the provider system when the provider owns the value lifecycle.
   - Never put raw provider tokens in `open-access`.
5. Register only the `secret_ref`.
   - Example reference shape: `hasna/access/npm/publish-token`.
   - Provider reference shape: `provider:npm:automation-token:publish-bot`.
6. Grant least scope and shortest useful TTL.
   - Use scope grants for durable MCP capabilities.
   - Use JIT elevations for temporary capability; requests are not effective
     until approval.
   - Use access bearer tokens for access/MCP authentication, not as provider
     token substitutes.
7. Review and revoke.
   - Schedule access reviews for durable access.
   - Revoke both the provider/vault value and the `open-access` record when
     offboarding or responding to compromise.

## Current Policy Boundary

The current policy is intentionally permissive after transport authorization:
an authorized operator or automation can record access. The future policy layer
should evaluate provider, package scope, environment, requester identity,
approval requirements, TTL ceilings, and break-glass reasons before records are
created or activated.

Until that policy layer exists, reviewers should check:

- requester identity reference resolves in `open-identities`
- `entity_id` matches the intended tenant or home entity
- `secret_ref` is a reference and not a value
- provider scopes such as `npm:publish` are least privilege and are not treated
  as access API authority unless a provider policy consumes them
- token/elevation TTL is short enough for the job
- revocation path is clear for the provider and the access record

## NPM Publishing Request

Use this shape for an agent that needs NPM publish rights:

```bash
access identity create \
  --entity-id <home-entity-uuid> \
  --kind agent \
  --name publish-bot \
  --owner-ref open-identities:agent:publish-bot

access credential register \
  --identity-id <access-identity-id> \
  --kind api_key \
  --name npm-publish-token \
  --secret-ref hasna/access/npm/publish-token

access scope grant --identity-id <access-identity-id> --scope npm:publish
access elevation request --identity-id <access-identity-id> --scope npm:publish --reason "release task" --ttl-minutes 60
```

The NPM token value is created, rotated, and revoked in NPM and the secrets
system after approval. `open-access` stores only the reference, safe command
preview, and audit history.

## Cloud Mode Checks

Before running cloud mode:

```bash
export HASNA_ACCESS_STORAGE_MODE=cloud
export HASNA_ACCESS_DATABASE_URL_FILE=/run/secrets/access-database-url
export HASNA_ACCESS_API_CREDENTIALS='<redacted-json-credentials>'
export HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE=/run/secrets/access-token-signing-key
access-serve
```

Check:

- DSN is mounted by file when possible and uses `sslmode=verify-full`.
- API credentials are configured before any non-loopback or cloud serve.
- A strong token signing key is configured; the local dev key is not allowed in
  cloud mode or exposed bind mode.
- `/ready` is green after migrations.
- No health/status output prints a DSN, token, or secret value.

## Release Hardening

Run before publishing:

```bash
bun run verify
bun run openapi:check
bun run smoke:package
```

Before commit or publish, scan the staged diff with the repo/CI scanner when one
exists. If there is no configured scanner, at minimum inspect staged changes for
common credential markers and stop on any hit:

```bash
git diff --cached -- README.md docs package.json
```

Post-publish:

```bash
npm view @hasna/access version dist-tags.latest
bun run smoke:package -- --package-spec @hasna/access@<version>
```

Do not include raw credential values in release notes, task comments, terminal
logs, screenshots, or audit payloads.
