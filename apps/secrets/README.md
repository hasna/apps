# @hasna/secrets

A local encrypted secrets vault for AI agents, CLIs, and developer machines.
Store API keys, passwords, tokens, and other credentials without committing them
to source control.

[![npm](https://img.shields.io/npm/v/@hasna/secrets)](https://www.npmjs.com/package/@hasna/secrets)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/secrets
```

## CLI Usage

```bash
secrets --help
secrets docs
```

### Common Commands

Store a secret:

```bash
secrets set example/anthropic/test/api_key "$ANTHROPIC_API_KEY" \
  --type api_key \
  --label "Anthropic API Key (test)"
```

Consume a secret without ever printing it (the value only exists in the child
process's environment):

```bash
secrets exec example/anthropic/test/api_key --as ANTHROPIC_API_KEY -- my-tool sync
```

Consume an AWS Secrets Manager value from an account configured in the standard
shared AWS profile files. `--env` names the child variable and its account-scoped
secret selector; the value is never printed or written into the local vault:

```bash
secrets exec --provider your-source-profile --account <account-id> \
  --env EXAMPLE_NPM_TOKEN -- my-tool sync
```

The account route must resolve to exactly one configured profile whose standard
role, SSO, or account fields match the requested provider and account. A literal
remote secret name remains supported. Otherwise canonical names shaped as
`<provider>/oss/<workload>/<key>` map to the normalized environment name
`<PROVIDER>_<WORKLOAD>_<KEY>`. All metadata pages are considered, and missing,
ambiguous, non-current, or non-string selections fail before the child runs.

Prove a secret exists or compare values without revealing them:

```bash
secrets get example/anthropic/test/api_key --check   # prints length + sha256 only
```

Copy a secret to a new path without the value ever rendering anywhere (the
value-safe migration primitive; works on non-TTY without `get --show`):

```bash
# carries type/label/expiry from the source and auto-records "migrated from <old>"
secrets copy example/anthropic/test/api_key anthropic/test/api_key
# override metadata and demand an internal verify (length + sha256) in the same call
secrets copy example/anthropic/test/api_key anthropic/live/api_key \
  --type api_key --label "Anthropic (live)" --reason "taxonomy 2026-08-20" --verify
```

The copy reads the source value in-process and writes the destination in the
same call; the value never touches stdout, stderr, a transcript, a log, or a
child environment. The source key is left intact (deletion is a separate
explicit operation), and `--verify` exits 0 only when the source and
destination values are internally equal.

Store a value without putting it in argv (ps/shell-history safe):

```bash
secrets set example/anthropic/test/api_key --stdin < value-file
```

Explicitly print a plaintext value (escape hatch — `get` is redacted by default
and refuses captured, non-TTY output entirely):

```bash
secrets get example/anthropic/test/api_key --show
```

List and search without printing secret values:

```bash
secrets list
secrets list example/anthropic
secrets search anthropic
```

Inspect audit history:

```bash
secrets audit example/anthropic/test/api_key
```

#### What the `agent` column attributes

`agent` is the **issued-to subject of the credential that made the call**, not
the process, session, host, or person behind it.

In cloud mode the server derives it once per request from the verified API-key
claims, and never from request input:

```ts
const actor = decision.principal.agent ?? decision.principal.kid;
```

That subject is fixed at issuance — `issue-key --agent <name>`, see
[Cloud service](#cloud-service-self_hosted) — and is covered by the token
signature, so a caller can neither assert nor override it. No endpoint accepts an
agent *identity* parameter: `/v1/secrets/get` takes `key` and nothing else, and
an unknown `agent` query parameter or header is ignored rather than rejected.
(`POST /v1/users` does take a `type` of `human` or `agent`; that is a user record
kind, not the identity of the caller.) In local mode the same column is instead
filled from `AGENT_ID ?? USER ?? hostname()`, which *is* self-asserted. The two
modes populate one column from two sources with different trust properties; read
the mode before reading the value.

The consequence that matters when interpreting a row: **every caller sharing one
key collapses to one `agent` value.** A deployment in which many callers share a
single API key records a single constant, and each row then attributes the access
to that key rather than to whoever used it. Such a row is *key-attributed* — and
where the key is shared, key-attributed means **unattributed**. It does not
narrow the access to a machine either, so it must not be described as
machine-attributed; that claims a narrowing the record does not contain.

Distinct per-caller attribution therefore comes from distinct credentials, each
issued with its own `--agent`. In cloud mode it is not reachable by any
client-side change, because the client does not supply this value at all; in
local mode the value is whatever the calling process asserts, which is a
different property and not a substitute for it.

Inspect metadata-only secret reference health:

```bash
secrets status --json
```

The status contract reports package version, redacted local data paths, env
override names, and aggregate counts only. It does not include secret values,
secret key names, raw env values, provider inventory, or private key material.

```ts
import { getSecretReferenceStatus } from "@hasna/secrets/status";

const status = await getSecretReferenceStatus();
console.log(status.counts.byType.api_key);
```

### Secret References For Automations

Deterministic automations and action manifests must reference secrets by key,
not embed raw values. In `@hasna/actions` manifests this appears as
`secrets[].ref`; the scoped resolver request below names it `secretRef`. A
reference is the exact, case-sensitive, slash-delimited vault key. It has no URI
scheme, query, fragment, embedded value, or authority of its own. Access comes
from a separate resolver-side grant.

The persistable request contract is:

```json
{
  "contractVersion": 1,
  "secretRef": "example/connectors/prod/github",
  "grantId": "github-issue-writer-prod",
  "automationId": "issue-triage",
  "action": "issue.create",
  "connector": "github",
  "scopes": ["repo:issues:write"],
  "reason": "Create a GitHub issue from an approved automation action"
}
```

`reason` is audit context, not authorization. `grantId` is a non-secret policy
selector, not a bearer token. The grant itself is configured in the trusted
resolver and must not be accepted from an automation payload:

```json
{
  "contractVersion": 1,
  "grantId": "github-issue-writer-prod",
  "policyRevision": 3,
  "secretRef": "example/connectors/prod/github",
  "automationId": "issue-triage",
  "allowedBindings": [
    {
      "action": "issue.create",
      "connector": "github",
      "allowedScopes": ["repo:issues:write"]
    }
  ],
  "allowedRuntimes": [
    {"machine": "runner-prod-01", "profile": "production"}
  ],
  "notBefore": "2026-07-01T00:00:00Z",
  "expiresAt": "2026-08-01T00:00:00Z"
}
```

The resolver obtains `machine` from an authenticated workload or host identity
and `profile` from trusted runner configuration. Those values are execution
context and are never trusted when supplied by a queued action. Profile here
means the named automation execution profile, not an AWS credential profile.

Before every invocation, the resolver must deny unless all of these checks pass:

1. The contract version, grant ID, secret reference, and automation ID match.
2. The action/connector pair exactly matches one `allowedBindings` entry, and the
   authenticated machine/profile pair exactly matches one `allowedRuntimes`
   entry. Keeping pairs intact prevents unintended cross-product permissions.
3. Every requested scope is present in the matched binding's `allowedScopes`;
   grants cannot be widened by a request.
4. The current time is in the half-open grant interval
   `notBefore <= now < expiresAt`. `expiresAt` is required; `notBefore` may be
   omitted to make the grant valid immediately.
5. The referenced secret exists and its own `expires_at`, if set, has not passed.

Timestamps are RFC 3339 UTC instants. Invalid timestamps and unavailable runtime
identity are authorization failures. Comparisons are exact and case-sensitive.
All request fields except `reason` are required; `scopes` and all grant allowlists
must be non-empty. Omitted bindings and wildcard values deny. `policyRevision` is
a monotonically increasing, non-secret audit value and is not client-selected.
The resolver should audit the decision, grant ID, secret key, requested bindings,
scopes, machine, profile, and policy revision, but never the decrypted value.

#### Persistence and rotation

- automation specs, action manifests, queued payloads, retries, todo comments,
  and run evidence may persist the reference request, but never a decrypted
  value or a raw value encoded into another field
- grants persist bindings and metadata only; they never contain the raw secret
- resolve immediately before connector invocation, inject the value directly
  into that invocation, discard it afterwards, and never place it in a durable
  cache, event, log, error, or audit record
- re-resolve on every retry and replay; do not copy the historical value from an
  earlier attempt
- rotate a credential by atomically replacing the value under the same stable
  `secretRef`; the next invocation receives the new value without changing the
  automation or grant
- secret expiry and grant expiry are independent and the earlier one wins; renew
  a grant by issuing a new policy revision, and revoke a grant or secret to deny
  all subsequent resolutions immediately
- a resolver may return an opaque invocation handle instead of plaintext; if a
  connector requires plaintext, it may exist only in invocation-scoped memory

Minimum integration boundary for OpenAutomations and `@hasna/actions` consumers:

- redaction must treat keys named `secretRef`, `secret`, `token`, `apiKey`,
  `authorization`, and provider credential fields as sensitive
- scoped consumers must use the resolver boundary rather than the generic
  `get`/`get_secret` plaintext APIs
- authorization failure must not reveal whether the reference exists or include
  a value in its error

#### Secret access audit event contract

The existing `get` / `set` / `delete` audit actions describe direct vault CRUD.
They do not prove that a scoped grant was checked or that a resolved value was
actually handed to a consumer. A grant-aware resolver must append the following
versioned events. Event names are past tense because audit records describe facts
that have already occurred.

| `action` | Emit when | Required event metadata |
| --- | --- | --- |
| `secret.grant.created` | A grant is durably issued. | `grant_id`, `scopes`, `grant_expires_at`, `decision=allowed`, `reason_code=grant_created` |
| `secret.grant.resolved` | The referenced secret exists and the grant, scope, and expiry checks pass. No value has crossed the vault boundary yet. | `grant_id`, `scopes`, `resolver_package`, `decision=allowed`, `reason_code=scope_allowed`, `secret_version` |
| `secret.used` | The vault hands the value to the named resolver or connector. Emit once per hand-off, not once per downstream API call. | `grant_id`, `scopes`, `resolver_package`, `decision=allowed`, `reason_code=value_handed_off`, `secret_version` |
| `secret.access.denied` | Resolution is rejected. Never emit `secret.used` for the same attempt. | Available identifiers, `decision=denied`, and a bounded `reason_code` |
| `secret.grant.expired` | A sweeper or access attempt first transitions an issued grant to expired. | `grant_id`, `grant_expires_at`, `decision=denied`, `reason_code=grant_expired` |
| `secret.rotated` | A new secret version is durably committed. | `decision=allowed`, `reason_code=secret_rotated`, `previous_secret_version`, `secret_version` |

All six actions use the following output contract. It extends the current flat
`AuditEntry` shape so old readers can continue to display `id`, `action`, `key`,
`agent`, and `timestamp`. Optional fields are omitted rather than filled with
values copied from request context.

The `agent` field below describes the intended contract for these grant-aware
events. On the existing `get` / `set` / `delete` rows it is not a per-caller
identity but the identity resolved for the caller by the active mode — the
credential's issued-to subject in cloud mode, the process environment in local
mode — and it carries exactly the attribution that source carries; see
[What the `agent` column attributes](#what-the-agent-column-attributes).
A resolver implementing these events inherits that limit: it cannot narrow an
access below the granularity of the identity available to it.

```ts
interface SecretAccessAuditEventV1 {
  id: number;
  schema_version: 1;
  action:
    | "secret.grant.created"
    | "secret.grant.resolved"
    | "secret.used"
    | "secret.access.denied"
    | "secret.grant.expired"
    | "secret.rotated";
  key: string;                 // secretRef; metadata, never the secret value
  agent: string;               // authenticated human or workload identifier
  timestamp: string;           // UTC ISO 8601
  correlation_id: string;      // joins events from one access attempt
  grant_id?: string;           // opaque identifier, never a bearer grant/token
  scopes?: string[];           // normalized, sorted requested scopes
  resolver_package?: string;   // package/service name, not command arguments
  resolver_version?: string;
  decision: "allowed" | "denied";
  reason_code: string;         // bounded enum; never free-form error text
  grant_expires_at?: string;
  secret_version?: string;     // opaque version id, not a value-derived hash
  previous_secret_version?: string;
}
```

Denials use a bounded reason code such as `grant_missing`, `grant_expired`,
`scope_mismatch`, `secret_missing`, or `policy_denied`. Operator-facing clients
may collapse these to `access_denied` when revealing whether a key or grant
exists would create an oracle. Stack traces and provider responses belong in a
separately protected diagnostic channel, not in the audit record.

Example metadata-only output:

```json
{
  "id": 184,
  "schema_version": 1,
  "action": "secret.access.denied",
  "key": "example/connectors/prod/github",
  "agent": "automation:issue-sync",
  "timestamp": "2026-01-15T12:00:00.000Z",
  "correlation_id": "request-example-184",
  "grant_id": "grant-example-12",
  "scopes": ["repo:issues:write"],
  "resolver_package": "@example/issue-connector",
  "decision": "denied",
  "reason_code": "scope_mismatch"
}
```

Audit serialization is an allowlist. It must never contain decrypted values,
ciphertext, value hashes or fingerprints, bearer grants, API keys, session
tokens, authorization headers, environment values, command arguments, connector
request/response bodies, raw authentication claims, or free-form reasons and
exceptions. Implementations must not accept an arbitrary `metadata` object and
must not serialize request context with object spread. Identifiers and scope
strings are length-bounded and control characters are rejected before storage.

Emission and storage rules:

- a grant-aware resolver commits grant creation and rotation events in the same
  transaction as the state change; `secret.rotated` links opaque version ids only
- allowed resolution is followed by use under the same `correlation_id`; a
  resolution may have no use, but a use may not exist without a resolution
- an allowed path fails closed if its audit event cannot be persisted before the
  value leaves the vault; a denial stays denied even if denial logging fails
- expiry uses the grant state transition as its idempotency boundary, so a
  sweeper and concurrent access attempt cannot create duplicate expiry events
- audit rows are append-only, use server-side UTC timestamps, and are subject to
  the same tenant authorization as the referenced secret

Implementation plan:

1. Extend `AuditEntry` and both audit tables with the explicit nullable columns
   above; do not add an unbounded JSON metadata column. Keep legacy CRUD rows and
   actions readable.
2. Add one typed store operation that accepts only the six event variants. Make
   local and cloud implementations validate fields and write parameterized SQL.
3. Emit from the future grant/resolver boundaries described in the table. Do not
   reinterpret the current raw `get` action as proof of `secret.used`.
4. Make `/v1/audit`, the CLI, MCP, SDK, and OpenAPI return an explicitly selected
   audit DTO rather than `SELECT *`, preserving the allowlist end to end.
5. Test all six actions in local and cloud stores, lifecycle ordering, denied
   access producing no use event, expiry idempotency, rotation version linkage,
   migration of existing rows, and the absence of sentinel secret material from
   every JSON and text output.

### Redaction Before Persistence

OpenLoops, OpenEvents, and OpenAutomations should create one redactor with all
secret values resolved for a run, then invoke the matching hook immediately
before every durable write or event publish. The hooks copy their input and
deep-redact registered values, sensitive fields, credential-shaped text, error
messages/stacks, stdout, and stderr.

```ts
import { createPersistenceRedactor } from "@hasna/secrets/redaction";

const redactor = createPersistenceRedactor({
  secretValues: resolvedSecrets.map((secret) => secret.value),
});

await runs.save(redactor.hooks.run({ stdout, stderr, error }));
await runOutput.append(redactor.hooks.stdout(stdoutChunk));
await audits.append(redactor.hooks.audit(auditEntry));
await events.publish(redactor.hooks.event(event));
```

Pass registered raw values whenever possible: field-name and token-shape
matching are defense in depth, not substitutes for registering arbitrary secret
values. Apply the hook at the final persistence boundary so later formatting or
error wrapping cannot reintroduce a raw value.

Export redacted compact JSON for review:

```bash
secrets export
```

Export plaintext only when a local restorable artifact is explicitly needed:

```bash
secrets export --show --pretty > secrets-backup.json
```

Scan the current working tree or full git history for exposed credentials. Each
JSON response is bounded; when `nextCursor` is present, pass it back with
`--cursor` to continue:

```bash
secrets scan workspace --limit 50
secrets scan history --max-commits 200 --limit 50
secrets scan history --cursor "$NEXT_CURSOR" --limit 50
```

Findings contain deterministic `secret-exposure:` IDs, remediation metadata, and
`evidencePath` locations suitable for task bodies. `detector`, `line` and
`column` locate the finding; `preview` is a constant `***REDACTED***` marker and
carries no bytes from the scanned line — not the matched value, and not the
surrounding context. Read the coordinates rather than the content: a scan result
is safe to paste into a transcript, a task, or a channel.

Create secure loop evidence and deduped Todos tasks for unsafe sensitive-file
permissions:

```bash
secrets security permissions \
  --report-dir ~/.hasna/loops/evidence/secret-file-permissions \
  --upsert-tasks \
  --todos-project ~/.hasna/loops \
  --task-list secret-file-permissions \
  --max-task-actions 20 \
  --json
```

The permissions report is written with private file permissions and contains
paths, modes, fingerprints, and task routing metadata only. It does not include
secret values.

Delete a secret:

```bash
secrets delete example/anthropic/test/api_key
```

### Key Format

Use slash-delimited keys:

```text
<division>/<service>/<env>/<name>
```

Examples:

```text
example/anthropic/test/api_key
example/local/dev-workstation/tool/exa-api-key
example-app/oauth/youtube_client_secret
```

### Hasna XYZ Canonical Keys

Generic keys still work as before. Keys under `hasna/xyz/` are validated so
new Hasna XYZ app resources follow the canonical migration shape:

```text
hasna/{division}/{app_type}/{app}/{env}/{component}
hasna/{division}/infra/{resource_group}/{env}/{component}[/role]
```

Allowed app types are:

```text
opensource, internalapp, companywebsite, project
```

`infra` is reserved for shared infrastructure ownership. Deprecated migration
taxonomies such as `connector`, `website`, and `platform` are rejected under
`hasna/xyz/`. App names should omit repo prefixes such as `open-`, `iapp-`,
`cweb-`, and `project-`.

Examples (illustrative placeholders only — substitute your own resource names;
no real production resource names are shipped in this package):

```text
hasna/xyz/opensource/example-app/dev/api_key
hasna/xyz/infra/example-group/dev/postgres/master
```

## AWS Secrets Manager Sync

`secrets aws` can use the legacy static-key config written by
`secrets aws configure`, or AWS profile/default-chain credentials. Supply your
own AWS profile and secret paths — none are hardcoded:

```bash
AWS_PROFILE=your-aws-profile secrets aws sync --dry-run
secrets aws push example/app/prod/s3 --profile your-aws-profile --dry-run
secrets aws sync --credential-mode role --role-arn <iam-role-arn> --source-profile your-aws-profile --dry-run
```

Credential source precedence is command flags, `HASNA_SECRETS_AWS_*`
environment variables, `~/.hasna/secrets/aws.json`, then the standard AWS
provider chain. If `aws.json` contains static keys and no explicit override is
provided, static-key behavior is preserved for compatibility.

Use `--dry-run` or `--plan` before live sync. Plan output is metadata-only JSON:
it reports names, regions, prefixes, credential source descriptors, and
intended actions without printing secret values or writing AWS/local vault
state.

### Secret Types

Supported types:

```text
api_key, password, token, credential, other
```

## Structured Vault Items

The generic key/value store remains supported. For browser autofill and
LastPass-like records, use structured vault items. Item payloads are encrypted;
titles, domains, tags, and item kind are stored as searchable metadata.

Create a login item:

```bash
secrets items add-login \
  --title "GitHub" \
  --url "https://github.com" \
  --username "you@example.com" \
  --password "$GITHUB_PASSWORD"
```

Create an address item:

```bash
secrets items add-address \
  --title "Home" \
  --name "Example User" \
  --line1 "1 Main St" \
  --city "New York" \
  --state "NY" \
  --postal-code "10001" \
  --country "US" \
  --email "you@example.com"
```

List, search, inspect, or delete items:

```bash
secrets items list
secrets items list login
secrets items search github
secrets items get <id>        # redacted payload
secrets items get <id> --show # decrypted payload
secrets items delete <id>
```

Supported item kinds:

```text
login, address, identity, payment_card, secure_note, api_key, custom
```

## Chrome Extension

The `extension/` directory contains a Manifest V3 Chrome extension that can fill
logins, addresses, identities, and payment-card fields from structured vault
items. Legacy username/password pairs still work when stored as slash-delimited
secrets with a common prefix.

Run the local bridge:

```bash
secrets serve
```

Then load `extension/` from `chrome://extensions` with Developer Mode enabled,
open the extension settings, and paste the token from `secrets serve token`.
The extension talks only to `http://127.0.0.1:27462` and asks for decrypted item
payloads only when you click Fill or Copy.

Optional TTL values can be attached when setting a secret:

```bash
secrets set temp/session "$TOKEN" --type token --ttl 24h
secrets gc
```

## MCP Usage

Install the MCP server into local AI agents:

```bash
secrets mcp install --target codex
secrets mcp install --target claude
secrets mcp install --target gemini
```

Agents connect over stdio by running:

```bash
secrets mcp
```

`secrets mcp` is the canonical MCP entry used by generated agent
configuration. The package also exposes `secrets-mcp` as an explicit direct
binary; it uses stdio by default and accepts `--http --port 8848` for the
Streamable HTTP transport.

Start the shared Streamable HTTP MCP server explicitly:

```bash
secrets mcp http --port 8848
```

The MCP exposes these tools:

```text
list_secrets(namespace?)
search_secrets(query)
get_secret(key)
set_secret(key, value, type?, label?, ttl?)
delete_secret(key)
list_vault_items(kind?)
search_vault_items(query)
get_vault_item(id)
set_vault_item(kind, title, data, id?, subtitle?, domains?, tags?, favorite?)
delete_vault_item(id)
audit_log(key?, limit?)
register_user(id, name, type?)
list_users(type?)
send_feedback(message, email?, category?)
scan_workspace_exposures(root?, cursor?, limit?, maxFileBytes?, maxFiles?, maxBytesScanned?, timeoutMs?)
scan_history_exposures(root?, cursor?, limit?, maxCommits?, timeoutMs?)
```

`list_secrets` and `search_secrets` return metadata only and do not decrypt
stored values. `get_secret` returns the raw value, so use it only when the agent
needs to pass the secret into a tool or command.

The scan tools return compact JSON with a stable schema, bounded redacted
findings, deterministic `secret-exposure:` ids, remediation metadata,
path/line/commit references, and opaque chunk cursors. They do not return raw
matching values. MCP scan roots are constrained to the server working directory,
and workspace scans include hard file, byte, and timeout bounds. The same
scheduler-neutral contract is available programmatically:

```ts
import { scanWorkspaceExposures } from "@hasna/secrets/scanner";

const result = scanWorkspaceExposures({ root: process.cwd(), limit: 50 });
```

## Env-File Bridge

The vault can import from and export to the conventional machine-local
`~/.secrets` tree:

```text
~/.secrets/{division}/{service}/live.env
~/.secrets/{division}/{business}/{service}/live.env
```

Import `.env` files into the vault:

```bash
secrets import-env --dir ~/.secrets --dry-run
secrets import-env --dir ~/.secrets --overwrite
```

Export vault entries back to `.env` files:

```bash
secrets export-env --dir ~/.secrets --dry-run
secrets export-env --dir ~/.secrets --force
```

## Storage Sync

This package supports optional remote storage sync directly against a Postgres/RDS
database. Local SQLite remains the default.

```bash
export HASNA_SECRETS_DATABASE_URL=postgres://...

secrets storage status
secrets storage push
secrets storage pull
secrets storage sync
```

The remote storage URL can also be provided as the short non-deprecated fallback
`SECRETS_DATABASE_URL`.

For a managed deployment, point `HASNA_SECRETS_DATABASE_URL` at your own
Postgres/RDS database. Deployment-specific infrastructure identifiers (the
database cluster name and the AWS Secrets Manager path that holds the runtime
`database_url`) are supplied by your hosting layer — this package ships no real
cluster names or secrets-manager paths. `SECRETS_DATABASE_URL` remains supported
as a rollback/local fallback. Do not print rows or values from the database;
status commands expose only redacted URLs, table names, and non-secret metadata.

MCP exposes the same flow through `storage_status`, `storage_push`,
`storage_pull`, and `storage_sync`.

## Data Directory

The secrets data home resolves through the `@hasna/paths` resolver (XDG/macOS
home layout). The legacy default is `~/.hasna/secrets`; once the resolver (XDG)
data home is adopted (`HASNA_DATA_HOME` set, or the vault already migrated to
`~/.local/share/hasna/secrets` on Linux / `~/Library/Application Support/Hasna/secrets`
on macOS), the vault database, key material and the AWS sync state resolve
there instead. Nothing moves on disk until the store is physically migrated.
The `~/.secrets` env-file bridge (import-env/export-env) is a separate legacy
credential store and is unchanged. File-level overrides (`HASNA_SECRETS_DB_PATH`,
`HASNA_SECRETS_KEY_DIR`, `HASNA_SECRETS_AWS_SYNC_STATE`) still win on top of
the effective root.

```bash
secrets path
secrets key
```

The vault database lives at `<data home>/vault.db`. Key material lives in
`<data home>/vault.key` for local-key mode or `<data home>/vault.key.enc` for
KMS envelope-encryption mode.

## Safety Notes

- `list`, `search`, `export`, and `scan` do not decrypt or print secret values
  by default.
- `export --show` and `export --plaintext` are explicit plaintext escape
  hatches for local restorable backups.
- CLI import refuses redacted export bundles so placeholders do not overwrite
  real secrets by accident.
- `get` and MCP `get_secret` return raw secret values.
- Never paste secret values into commits, logs, issues, PRs, or chat messages.
- Keep `.env`, `.env.local`, `.secrets/`, and `.connect/` out of git.

## Running the tests

A test process cannot reach a real vault. This is enforced by the code, not by
convention, because convention already failed: the suite wrote fixtures into a
hosted production vault on four separate runs, because a machine's shell
environment exports `HASNA_SECRETS_STORAGE_MODE` / `_API_URL` / `_API_KEY` and
`getStore()` reads them.

```bash
bun test
```

What holds, and where:

| Guarantee | Enforced in |
| --- | --- |
| A test process may only reach a **loopback** vault. Any other host throws `SecretsTestIsolationError`. | `src/test-isolation.ts`, applied at the one HTTP egress point (`createHasnaHttpTransport`) and at ambient-env store resolution (`getStore()`). |
| A test that configures nothing still never opens the operator's `~/.hasna/secrets` vault or key. It gets a throwaway per-process one. | `src/db.ts`, `src/crypto.ts` |
| The hosted-vault selectors are stripped from the environment before any test file runs. | `bunfig.toml` → `tests/setup/isolate-vault.ts` |

Notes:

- The preload is a convenience, not the guarantee. Delete `bunfig.toml` and the
  suite fails loudly with `SecretsTestIsolationError` rather than writing to a
  hosted vault.
- There is **no environment variable that turns the guard off**. The only env key
  it reads, `HASNA_SECRETS_TEST_ISOLATION=1`, can force it on.
- Test context is detected from the runner (the preload marker, `NODE_ENV=test`)
  and from a `*.test.ts` entrypoint — never from something a test author must
  remember to write.
- Two thresholds, because the two guards fail differently:

  | Signal | Loud guards — hosted-vault egress, explicit-path refusal | Silent guard — redirect vault files to a throwaway |
  | --- | --- | --- |
  | preload marker `HASNA_SECRETS_TEST_ISOLATION=1` | yes | yes |
  | `*.test.ts` entrypoint (what `bun test` sets) | yes | yes |
  | bare `NODE_ENV=test` | yes | **no** |

  So running the shipped CLI with `NODE_ENV=test` in the environment — which every
  JS test runner exports across its whole process tree — reads and writes your
  **real local vault**, normally. It does not silently swap in an empty throwaway;
  that would make `secrets get` report a live credential as missing and `secrets
  set` print `✓ Stored` for a value it discarded, both at exit code 0. What
  `NODE_ENV=test` *does* still do is bar the **hosted** vault: resolution throws
  `SecretsTestIsolationError` and exits non-zero. Refusal, loudly, rather than a
  quiet wrong answer.
- A test that genuinely needs to exercise the hosted transport should inject a
  fake `fetchImpl`, not point a real one at a remote host.

## Cloud service (`self_hosted`)

Beyond the local vault, `@hasna/secrets` ships a deployable HTTP service and a
typed SDK. Four surfaces cover the same core:

- **`secrets`** — the CLI.
- **`secrets-mcp`** — the MCP server (stdio by default, `--http` for Streamable HTTP).
- **`secrets-serve`** — the HTTP API. Unauthenticated probes `GET /health`,
  `/ready`, `/version` (`{status, version, mode}`) and `GET /openapi.json`; a
  versioned `/v1` surface (secrets + vault-item CRUD, search, audit, users)
  behind **strict API-key auth** (`@hasna/contracts`). Scopes: `secrets:read`,
  `secrets:write`.
- **`@hasna/secrets`** — the typed, dependency-free SDK package root generated
  from the serve OpenAPI. The compatibility subpath `@hasna/secrets/sdk`
  exports the same API. Client `self_hosted` mode uses `SECRETS_API_URL` +
  `SECRETS_API_KEY` (never a DSN).

Storage is **PURE REMOTE (Amendment A1)** in cloud mode: `secrets-serve` reads
and writes the shared Postgres directly (no cache, no local mirror). Secret and
vault-item values are **encrypted at rest** (AES-256-GCM) with a master key
injected via `HASNA_SECRETS_MASTER_KEY` — the service fails closed without it.

```bash
# migrate the cloud database (one-shot), then serve
export HASNA_SECRETS_STORAGE_MODE=cloud
export HASNA_SECRETS_DATABASE_URL=postgres://...          # or DATABASE_URL
export HASNA_SECRETS_API_SIGNING_KEY=$(openssl rand -hex 32)
export HASNA_SECRETS_MASTER_KEY=$(openssl rand -base64 32)
secrets-serve db migrate
secrets-serve                                             # listens on $PORT (default 8080)

# issue an API key (@hasna/contracts issuer), then call the SDK
bunx @hasna/contracts issue-key --app secrets --agent my-agent --scopes 'secrets:read,secrets:write'
```

`--agent` is the sole input that populates the `agent` column of every audit row
written under that key, so issue one key per caller you intend to tell apart. A
key shared between callers makes their accesses indistinguishable in the audit
log, and no client-side setting recovers the difference — see
[What the `agent` column attributes](#what-the-agent-column-attributes).

```ts
import { createSecretsClientFromEnv, type SecretInput } from "@hasna/secrets";
const client = createSecretsClientFromEnv(); // SECRETS_API_URL + SECRETS_API_KEY
const input: SecretInput = {
  key: "example/service/dev/api_key",
  value: process.env.EXAMPLE_SERVICE_API_KEY!,
  type: "api_key",
};
await client.putSecret(input);
const secret = await client.getSecret({ key: input.key });
```

Migrations live in [`migrations/`](migrations) (canonical checksummed set in
`src/server/cloud-migrations.ts`). Container image: `Dockerfile.package`
(ARM64/bun); local stack: `docker-compose.yml`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
