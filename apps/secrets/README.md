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

Read a secret value:

```bash
secrets get example/anthropic/test/api_key
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

Inspect metadata-only secret reference health:

```bash
secrets status --json
```

The status contract reports package version, redacted local data paths, env
override names, and aggregate counts only. It does not include secret values,
secret key names, raw env values, provider inventory, or private key material.

```ts
import { getSecretReferenceStatus } from "@hasna/secrets/status";

const status = getSecretReferenceStatus();
console.log(status.counts.byType.api_key);
```

### Secret References For Automations

Deterministic automations and action manifests must reference secrets by key,
not embed raw values. In `@hasna/actions` manifests this appears as
`secrets[].ref`; in lower-level payloads it may be named `secretRef`. The
reference value is the same slash-delimited key used by this vault:

```json
{
  "secretRef": "example/connectors/prod/github",
  "scope": "repo:issues:write",
  "reason": "Create a GitHub issue from an approved automation action"
}
```

Minimum contract for OpenAutomations and `@hasna/actions` consumers:

- automation specs, queued action payloads, todos comments, and run evidence
  store `secretRef` strings only
- the runtime that resolves a reference must check the requested scope before
  handing a value to a connector or command
- audit records may include the secret key, type, scope, resolver package,
  and decision, but never the decrypted value
- redaction must treat keys named `secretRef`, `secret`, `token`, `apiKey`,
  `authorization`, and provider credential fields as sensitive
- replay should re-resolve the reference at execution time instead of storing a
  historical secret value in the automation queue

Export redacted compact JSON for review:

```bash
secrets export
```

Export plaintext only when a local restorable artifact is explicitly needed:

```bash
secrets export --show --pretty > secrets-backup.json
```

Scan the current workspace or bounded git history for exposed credentials:

```bash
secrets scan workspace --limit 50
secrets scan history --max-commits 200 --limit 50
```

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
secrets aws sync --credential-mode role --role-arn arn:aws:iam::123456789012:role/example --source-profile your-aws-profile --dry-run
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
storage_status()
storage_push(tables?)
storage_pull(tables?)
storage_sync(tables?)
scan_workspace_exposures(root?, limit?, maxFileBytes?, maxFiles?, maxBytesScanned?, timeoutMs?)
scan_history_exposures(root?, limit?, maxCommits?, timeoutMs?)
```

`list_secrets`, `search_secrets`, and `get_secret` return metadata only and do
not decrypt stored values. `get_secret` returns a `secretRef` for a trusted
runtime or connector broker to resolve outside model context. `get_vault_item`
similarly returns a `vaultItemRef` and metadata without the encrypted payload.

The scan tools return compact JSON with a stable schema, bounded redacted
findings, and path/line/commit references only. They do not return raw matching
values. MCP scan roots are constrained to the server working directory, and
workspace scans include hard file, byte, and timeout bounds.

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

Data is stored in `~/.hasna/secrets/`.

```bash
secrets path
secrets key
```

The vault database lives at `~/.hasna/secrets/vault.db`. Key material lives in
`~/.hasna/secrets/vault.key` for local-key mode or
`~/.hasna/secrets/vault.key.enc` for KMS envelope-encryption mode.

## Safety Notes

- `list`, `search`, `export`, and `scan` do not decrypt or print secret values
  by default.
- `export --show` and `export --plaintext` are explicit plaintext escape
  hatches for local restorable backups.
- CLI import refuses redacted export bundles so placeholders do not overwrite
  real secrets by accident.
- CLI `get` returns a raw value for explicit human/runtime use. MCP
  `get_secret` and `get_vault_item` return references and metadata only.
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
  behind **strict API-key auth** (`@hasna/contracts`). `secrets:read` is
  metadata-only; decrypted reads require `secrets:reveal`. Any of `read`,
  `write`, and `reveal` can be limited to a dotted key prefix, for example
  `secrets:read.openai` or `secrets:reveal.openai.prod`. `secrets:*` remains a
  trusted vault-wide bootstrap scope. Prefixes containing characters outside
  the scope grammar use the encoded form produced by `secretScope()` from
  `@hasna/secrets/security`.
- **`@hasna/secrets/sdk`** — a typed, dependency-free fetch client generated
  from the serve OpenAPI. Client `self_hosted` mode uses `SECRETS_API_URL` +
  `SECRETS_API_KEY` (never a DSN).

Storage is **PURE REMOTE (Amendment A1)** in cloud mode: `secrets-serve` reads
and writes the shared Postgres directly (no cache, no local mirror). Secret and
vault-item values are **encrypted at rest** (AES-256-GCM) with a master key
injected via `HASNA_SECRETS_MASTER_KEY` — the service fails closed without it.

```bash
# migrate the cloud database (one-shot), then serve
export HASNA_SECRETS_STORAGE_MODE=cloud
export HASNA_SECRETS_DATABASE_URL=postgres://…            # or DATABASE_URL
export HASNA_SECRETS_API_SIGNING_KEY=$(openssl rand -hex 32)
export HASNA_SECRETS_MASTER_KEY=$(openssl rand -base64 32)
secrets-serve db migrate
secrets-serve                                             # listens on $PORT (default 8080)

# issue an API key (@hasna/contracts issuer), then call the SDK
bunx @hasna/contracts issue-key --app secrets --agent my-agent --scopes 'secrets:read.openai,secrets:write.openai'
```

```ts
import { createSecretsClientFromEnv } from "@hasna/secrets/sdk";
const client = createSecretsClientFromEnv(); // SECRETS_API_URL + SECRETS_API_KEY
await client.putSecret({ key: "openai/api_key", value: "sk-…", type: "api_key" });
const secret = await client.getSecret({ key: "openai/api_key" });
```

Migrations live in [`migrations/`](migrations) (canonical checksummed set in
`src/server/cloud-migrations.ts`). Container image: `Dockerfile.package`
(ARM64/bun); local stack: `docker-compose.yml`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
