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

Errors use the same schema with `ok:false` and a typed `error`. Exit codes are fixed: `0` success; `2` usage, local validation, or configuration; `3` authentication; `4` permission; `5` not found/gone; `6` conflict; `7` network, TLS, or timeout; `8` remote/precondition/rate-limit/server/malformed response; `9` partial; `10` cancelled; `11` unsupported; and `70` internal.

Options are command-scoped. Unknown, duplicated, or misplaced options fail before configuration, credentials, or the network are touched. Machine-readable command metadata contains command names only, never option values.

## Profiles and credentials

```bash
hasna profiles add prod --api-url https://hasna.com --org hasna
hasna profiles use prod
hasna profiles list --json
hasna config path
hasna doctor --json
```

API URLs reject credentials and fragments and use HTTPS by default. Loopback HTTP requires `--allow-insecure-localhost` when adding the profile. Private, link-local, metadata, benchmark, multicast, reserved, and documentation destinations are rejected after DNS resolution, and the checked address is pinned for the connection.

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
printf '%s\n' "$PASSWORD" | HASNA_2FA=123456 hasna auth login --email owner@example.com --org hasna --password-stdin --two-factor-env HASNA_2FA
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

Two-factor codes are never accepted as command-line values. `--two-factor-env VAR_NAME` opts in without exposing the code in process arguments; omit it for accounts without 2FA. Secret stdin and hidden-terminal inputs are capped by UTF-8 bytes.

## Apps and accounts

```bash
hasna apps list
hasna apps search careers
hasna apps show cweb
hasna apps status cweb
hasna app cweb capabilities
```

App lifecycle and future account provisioning use short-lived, single-use deterministic plans. Install/update plans bind the profile, API origin, organization, provider version, and inspected OpenAPI hash. Compatible semantic API versions at or above `1.1.0` are accepted when required operations remain present. Apply refetches the OpenAPI description and must reproduce the exact digest:

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

Mutations support command-scoped `--dry-run`, `--file <json>`, and `--input -`. Input is limited to 1 MiB; files must be regular, single-link files. Job lifecycle and deletion require the server's integer version through `--version`. Application submissions require `name`, `email`, and `termsAccepted:true`; the current API intentionally accepts no resume field.

Token revoke/rotate/revoke-all, job publish/close/delete, and application status/anonymize use the same short-lived plan plus `--apply <digest> --yes`; `--dry-run` remains side-effect free. Idempotency keys are accepted only for job creation, application submission, and token rotation and must match `[A-Za-z0-9._:-]{8,128}`.

Token rotation requires an explicit idempotency key so plan and apply are identical. Apply atomically reserves a plan: concurrent apply and identical replanning while an apply is in flight are rejected, while an identical still-pending plan is safely reused without extending its expiry. Success or a definitive remote response consumes the reservation, and a transient network/TLS/timeout failure releases it for an explicit retry. Local settlement retries are short and bounded; if a successful remote mutation cannot be recorded after those retries, the CLI returns exit 9 with the request ID and must not be automatically rerun.

Private operators can inspect ambiguous state with `plans list` and `plans show <digest>`. After independently checking the remote system, resolve it with `plans resolve <digest> --outcome applied --yes`, or use `--outcome not-applied --yes` only when the mutation is verified not to have taken effect. Resolution changes local plan state only and performs no API request.

CSV export follows `X-Next-Cursor` until `X-Export-Complete:true`, preserves one header even when pages omit trailing newlines, and fails with exit 9 instead of reporting partial data as success when page or byte ceilings are reached. Output files are atomically written with mode `0600`.

## Provider boundary

The public type-only provider interfaces live at `@hasna/cli/provider-sdk`. A future package provider must have pinned integrity and an Ed25519 signature before loading. Version 0.2.0 deliberately has no loader for remote or untrusted packages; only `builtin:cweb` is registered.

See [SECURITY.md](SECURITY.md), [docs/threat-model.md](docs/threat-model.md), and [docs/release.md](docs/release.md).
