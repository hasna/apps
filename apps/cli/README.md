# `@hasna/cli`

The Hasna CLI manages Hasna applications through documented APIs. Version 0.2.0 is a restricted, private package prepared for a future public registry and provider ecosystem. It ships one trusted provider, `builtin:cweb`; it never downloads or executes provider JavaScript.

## Installation

The package is published only with restricted access and the `internal` dist-tag:

```bash
npm install --global @hasna/cli@internal
hasna --json version
```

Node.js 20 or newer is required. Bun is used to build and test the repository, but the distributable contains no Bun runtime dependency or Bun globals.

## Output and errors

`--json` always emits one `hasna.cli_result.v1` envelope on stdout. It is stable across human-output changes:

```json
{
  "schema": "hasna.cli_result.v1",
  "ok": true,
  "data": {},
  "meta": { "command": "apps list", "durationMs": 4 }
}
```

Errors use the same schema with `ok:false` and a typed `error`. Exit codes are fixed: `0` success, `2` usage, `3` configuration, `4` authentication, `5` forbidden, `6` not found, `7` conflict, `8` validation/precondition, `9` network, `10` timeout, `11` unsupported capability, and `70` internal error.

Global options are accepted with every command: `--json`, `--profile`, `--api-url`, `--connect-timeout`, and `--request-timeout`.

## Profiles and credentials

```bash
hasna profiles add prod --api-url https://hasna.com --org hasna
hasna profiles use prod
hasna profiles list --json
hasna config path
hasna doctor --json
```

Configuration follows XDG (`$XDG_CONFIG_HOME/hasna/config.json`, otherwise `~/.config/hasna/config.json`) and is written with mode `0600`. Configuration stores references, never bearer tokens.

Credential resolution order is:

1. an explicit environment reference such as `--credential-env HASNA_TOKEN`;
2. the operating-system keychain (`secret-tool` on Linux or Keychain Services on macOS);
3. AES-256-GCM encrypted-file storage only after explicit `--credential-store encrypted-file` or `auth login --store encrypted-file` opt-in.

Environment references are read-only. Encrypted-file passphrases and login passwords are accepted only through a hidden TTY prompt or their explicit stdin option. They are never command-line arguments, configuration values, or child-process arguments.

## Authentication

```bash
hasna auth login --email owner@example.com --org hasna
printf '%s\n' "$PASSWORD" | hasna auth login --email owner@example.com --org hasna --password-stdin
hasna auth status --json
hasna auth whoami
hasna auth tokens list
hasna auth tokens create --name automation --scopes cweb:careers.jobs.read,cweb:careers.jobs.write
hasna auth tokens rotate TOKEN_ID --idempotency-key rotate-2026-01
hasna auth tokens revoke TOKEN_ID
hasna auth tokens revoke-all
hasna auth logout
```

The login token is immediately moved to the configured credential store and redacted from CLI output. Newly created or rotated token responses are one-time server responses; handle JSON output as sensitive and never save it to repository files.

## Apps and accounts

```bash
hasna apps list
hasna apps search careers
hasna apps show cweb
hasna apps status cweb
hasna app cweb capabilities
```

App lifecycle and future account provisioning use deterministic plans. First obtain a plan, then apply exactly that digest:

```bash
PLAN=$(hasna --json apps install cweb | jq -r .data.digest)
hasna apps install cweb --apply "$PLAN" --yes
```

The same gate applies to `apps update`, `apps uninstall`, and provider-backed account `provision`/`deprovision`. The cweb API does not currently expose account provisioning; account commands return typed `CAPABILITY_UNSUPPORTED` (exit 11). No lifecycle action executes shell commands.

## Careers

```bash
hasna careers jobs list --status ALL --limit 25
hasna careers jobs show executive-assistant
hasna careers jobs create --file job.json --idempotency-key job-ea-2026
hasna careers jobs update executive-assistant --file patch.json --expected-version 2
hasna careers jobs publish executive-assistant --version 3
hasna careers jobs close executive-assistant --version 4
hasna careers jobs delete executive-assistant --version 5

hasna careers applications list --job executive-assistant
hasna careers applications show APPLICATION_ID
hasna careers applications submit --job executive-assistant --file application.json --idempotency-key candidate-unique-key
hasna careers applications status APPLICATION_ID --status REVIEWING
hasna careers applications export --output applications.csv
hasna careers applications anonymize APPLICATION_ID
```

Mutations support `--dry-run`, `--idempotency-key`, `--file <json>`, and `--input -`. Input is limited to 1 MiB; files must be regular, non-symlink files. Job lifecycle and deletion require the server's integer version through `--version`. Application submissions require `name`, `email`, and `termsAccepted:true`; the current API intentionally accepts no resume field.

CSV export follows `X-Next-Cursor` until `X-Export-Complete:true`. Output files are atomically written with mode `0600`.

## Provider boundary

The public type-only provider interfaces live at `@hasna/cli/provider-sdk`. A future package provider must have pinned integrity and an Ed25519 signature before loading. Version 0.2.0 deliberately has no loader for remote or untrusted packages; only `builtin:cweb` is registered.

See [SECURITY.md](SECURITY.md), [docs/threat-model.md](docs/threat-model.md), and [docs/release.md](docs/release.md).
