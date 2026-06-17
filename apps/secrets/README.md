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
secrets set hasnaxyz/anthropic/live/api_key "$ANTHROPIC_API_KEY" \
  --type api_key \
  --label "Anthropic API Key (live)"
```

Read a secret value:

```bash
secrets get hasnaxyz/anthropic/live/api_key
```

List and search without printing secret values:

```bash
secrets list
secrets list hasnaxyz/anthropic
secrets search anthropic
```

Inspect audit history:

```bash
secrets audit hasnaxyz/anthropic/live/api_key
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

Export redacted JSON for review:

```bash
secrets export --redact
```

Delete a secret:

```bash
secrets delete hasnaxyz/anthropic/live/api_key
```

### Key Format

Use slash-delimited keys:

```text
<division>/<service>/<env>/<name>
```

Examples:

```text
exampleco/anthropic/live/api_key
example/local/dev-workstation/tool/exa/api-key
alumia-production/oauth/youtube_client_secret
```

### Secret Types

Supported types:

```text
api_key, password, token, credential, other
```

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

The MCP exposes these tools:

```text
list_secrets(namespace?)
search_secrets(query)
get_secret(key)
set_secret(key, value, type?, label?, ttl?)
delete_secret(key)
audit_log(key?, limit?)
register_user(id, name, type?)
list_users(type?)
```

`list_secrets` and `search_secrets` return metadata only. `get_secret` returns
the raw value, so use it only when the agent needs to pass the secret into a
tool or command.

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

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service secrets
cloud sync pull --service secrets
```

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

- `list`, `search`, and `export --redact` do not print secret values.
- `get` and MCP `get_secret` return raw secret values.
- Never paste secret values into commits, logs, issues, PRs, or chat messages.
- Keep `.env`, `.env.local`, `.secrets/`, and `.connect/` out of git.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
