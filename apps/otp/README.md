# open-otp

Local encrypted OTP/TOTP manager for Hasna agent workflows.

`open-otp` provides:

- `otp` CLI for adding, importing, listing, showing, removing, and generating TOTP codes.
- `otp-mcp` MCP server with tools to list labels, generate codes, and inspect storage status without returning seeds.
- SDK exports for TypeScript/Bun automation.
- Local encrypted storage at `~/.hasna/otp/`.

TOTP seeds are credentials. Normal CLI, SDK metadata, and MCP responses never return seed values.

Reference documentation:

- [CLI commands and options](./docs/cli.md)
- [MCP server and tools](./docs/mcp.md)
- [SDK exports and types](./docs/sdk.md)

## Install

```bash
bun install -g @hasna/otp
otp bootstrap
otp --version
```

## Security

See [SECURITY.md](./SECURITY.md) for the threat model, key management, at-rest encryption format, per-surface non-exposure guarantees, and known limitations.

Summary: seeds are encrypted with AES-256-GCM using a locally generated 256-bit key (`vault.key`). Public APIs return `OtpEntry` metadata only; `encrypted_secret` and plaintext seeds are stripped before every CLI, SDK, and MCP response.

## Storage

The local store is bootstrapped at:

```text
~/.hasna/otp/
  entries.json
  vault.key
```

### Key lifecycle

On first use, `getMasterKey()` creates `vault.key` if it does not exist:

1. `randomBytes(32)` generates a 256-bit AES key (not derived from a password).
2. The key is written as a single hex-encoded line with mode `0600`.

The key is cached in-process after the first read. There is no remote key escrow in v1.

### Encryption format

Each TOTP seed is encrypted individually before being written to `entries.json`:

```text
enc:v1:{12-byte-iv-hex}:{ciphertext+16-byte-gcm-tag-hex}
```

- Algorithm: AES-256-GCM
- IV: 12 random bytes per secret
- `decryptSecret()` is called only inside `generateOtpCode()` to compute a code in-process

Entries are encrypted with AES-256-GCM using the local `vault.key`. The directory is chmod `700`; `entries.json` and `vault.key` are chmod `600`. Writes use an atomic temp-file + rename pattern.

Security limitation: this first release protects against accidental disclosure in source, logs, normal command output, backups, and shared file reads, but the local key lives on the same machine as the encrypted store. Use full-disk encryption and OS account isolation. Future releases can add hardware-backed or `open-secrets` remote key wrapping.

Set `HASNA_OTP_HOME=/path/to/store` to use a non-default local store.

## CLI

Initialize the key and store files explicitly:

```bash
otp bootstrap
otp status
```

Add an entry without printing the seed:

```bash
printf '%s' "$OTP_SEED" | otp add --issuer Example --account agent@example.com --secret-stdin
```

Import an authenticator URI without putting it in shell history:

```bash
printf '%s' "$OTPAUTH_URI" | otp import --stdin
```

List entries:

```bash
otp list
otp list --json
```

Show metadata:

```bash
otp show Example:agent@example.com
otp show Example:agent@example.com --json
```

Generate a TOTP code:

```bash
otp generate Example:agent@example.com
otp generate Example:agent@example.com --at 1710000000
otp generate Example:agent@example.com --json
```

Remove an entry:

```bash
otp remove Example:agent@example.com
```

Targets may be an id, label, `issuer:account`, or unique account. The `code`
and `rm` aliases map to `generate` and `remove`. Numeric `--at` values are Unix
timestamps in seconds; ISO dates are also accepted.

CLI commands return entry metadata (`id`, `label`, `issuer`, `account`, algorithm settings, timestamps), storage status, or generated codes. Seeds and `encrypted_secret` are never included in stdout. See the [CLI reference](./docs/cli.md) for every command, option, default, validation range, input precedence rule, and output shape.

## MCP

Run the stdio server:

```bash
otp-mcp
```

Tools:

- `otp_list_labels`: list ids, labels, issuer/account metadata, and TOTP settings.
- `otp_generate_code`: generate a code by `target` id/label/issuer:account/unique account.
- `otp_status`: show storage status without secrets.

MCP tools never return seeds.

See the [MCP reference](./docs/mcp.md) for tool inputs and response fields.

## SDK

```ts
import { addOtpEntry, generateOtpCode, listOtpEntries } from "@hasna/otp";

const entries = listOtpEntries();
const code = generateOtpCode(entries[0].id);
```

Common storage exports:

- `addOtpEntry(input)` — accepts `secret` as write input; returns `OtpEntry` without it
- `importOtpAuthUri(input)` — parses `otpauth://` URI; returns `OtpEntry` without secret
- `listOtpEntries()` — returns `OtpEntry[]` (no `encrypted_secret`)
- `getOtpEntry(target)` — returns `OtpEntry` (no `encrypted_secret`)
- `generateOtpCode(target)` — decrypts in-process; returns code + metadata only
- `removeOtpEntry(target)` — returns removed `OtpEntry` (no `encrypted_secret`)
- `getOtpStorageStatus()` — paths and counts; no key bytes or seeds

The root package also exports storage bootstrap/path helpers, `parseOtpAuthUri()`,
TOTP generation and normalization utilities, and their public types. Subpath
exports are available at `@hasna/otp/otpauth`, `@hasna/otp/storage`, and
`@hasna/otp/totp`.

Exported result types (`OtpEntry`, `GeneratedOtpCode`, `GeneratedTotp`,
`OtpStorageStatus`) never include `encrypted_secret` or plaintext seeds.
`StoredOtpEntry` with `encrypted_secret` is internal to the storage layer. See
the [SDK reference](./docs/sdk.md) for all exports, types, defaults, and option
semantics.

## Development

```bash
bun install
bun run build
bun run typecheck
bun test
```
