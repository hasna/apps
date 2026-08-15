# CLI Reference

The `otp` CLI manages the encrypted store selected by `HASNA_OTP_HOME`, or
`~/.hasna/otp/` when the variable is unset. Commands that return entry metadata
never include plaintext seeds or `encrypted_secret`.

## Global options

| Option | Description |
|--------|-------------|
| `-V, --version` | Print the package version. |
| `-h, --help` | Print help. Use `otp <command> --help` for command help. |

Errors are written to stderr as `otp: <message>` and exit with status 1.

## Commands

### `otp bootstrap`

Creates the store directory, `vault.key`, and `entries.json` when missing. It
is safe to run against an existing store.

| Option | Description |
|--------|-------------|
| `--json` | Print the full storage status object. |

Without `--json`, the command prints the resolved store directory.

### `otp status`

Reports storage state without creating a key or store file. Resolving status
does create or reapply mode `0700` to the store directory.

| Option | Description |
|--------|-------------|
| `--json` | Include `home`, store/key paths and existence flags, entry count, storage type, and encryption flag. |

Plain output includes `home`, `entries`, `storage`, and `encrypted_at_rest`.

### `otp add`

Adds one TOTP entry:

```bash
printf '%s' "$OTP_SEED" | otp add \
  --issuer Example \
  --account agent@example.com \
  --secret-stdin
```

| Option | Description |
|--------|-------------|
| `--account <account>` | Required account or user label. |
| `--issuer <issuer>` | Issuer metadata. |
| `--label <label>` | Custom display label. Defaults to `issuer:account`, or `account` without an issuer. |
| `--id <id>` | Custom stable id. Defaults to a UUID. |
| `--secret <secret>` | Base32 seed on argv. Prefer stdin or an environment variable. |
| `--secret-stdin` | Read the base32 seed from stdin. |
| `--secret-env <name>` | Read the base32 seed from the named environment variable. |
| `--algorithm <algorithm>` | `SHA1`, `SHA256`, or `SHA512`. Defaults to `SHA1`; matching is case-insensitive. |
| `--digits <n>` | Integer code length from 6 through 8. Defaults to 6. |
| `--period <seconds>` | Integer period from 1 through 300 seconds. Defaults to 30. |
| `--json` | Print the added entry metadata. |

One secret source is required. If multiple sources are supplied, precedence is
`--secret-stdin`, then `--secret-env`, then `--secret`. Base32 input is
uppercased and ignores spaces, hyphens, and `=` padding.

Labels must be unique case-insensitively. Custom ids must not duplicate an
existing id.

### `otp import [uri]`

Imports an `otpauth://totp` URI. HOTP URIs are not supported.

```bash
printf '%s' "$OTPAUTH_URI" | otp import --stdin
```

| Option | Description |
|--------|-------------|
| `--stdin` | Read the URI from stdin. |
| `--file <path>` | Read the URI from a file. |
| `--id <id>` | Override the generated id. |
| `--label <label>` | Override the parsed display label. |
| `--json` | Print the imported entry metadata. |

The URI may instead be passed as `[uri]`. If multiple URI sources are
supplied, precedence is `--stdin`, then `--file`, then the argument. The URI
must contain a label and `secret`; `algorithm`, `digits`, and `period` use the
same validation and defaults as `otp add`. A query-string `issuer` takes
precedence over an issuer embedded in the URI label.

### `otp list`

Lists all entries without seeds. Plain output is tab-separated and prints
`No OTP entries.` for an empty store. `--json` returns an array of entry
metadata.

### `otp show <target>`

Shows one entry without its seed.

| Option | Description |
|--------|-------------|
| `--code` | Include a freshly generated code. |
| `--at <time>` | Generate at a Unix timestamp in seconds or an ISO date; used with `--code`. |
| `--json` | Print JSON. |

With `--code --json`, the output contains entry metadata plus `code`,
`expires_at`, and `expires_in`.

### `otp generate <target>`

Generates a code and prints only the code by default. `otp code` is an alias.

| Option | Description |
|--------|-------------|
| `--at <time>` | Generate at a Unix timestamp in seconds or an ISO date. |
| `--json` | Print code and entry metadata, including expiry, period, and counter. |

`expires_at` is based on the selected generation time. `expires_in` is the
remaining lifetime relative to the current wall clock and is therefore zero
for expired historical times.

### `otp remove <target>`

Removes an entry. `otp rm` is an alias. `--json` returns the removed entry
metadata under the `removed` key.

## Targets

`show`, `generate`, and `remove` resolve `<target>` case-insensitively against:

- entry id
- display label
- `issuer:account`
- account, when unique

If a target matches multiple entries, the command fails and asks for an id.

## JSON metadata

Entry metadata includes `id`, `label`, optional `issuer`, `account`,
`algorithm`, `digits`, `period`, `created_at`, and `updated_at`. Generated-code
JSON additionally includes `code`, `expires_at`, `expires_in`, and `counter`.
No CLI JSON response includes a seed or `encrypted_secret`.
