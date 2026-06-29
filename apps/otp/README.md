# open-otp

Local encrypted OTP/TOTP manager for Hasna agent workflows.

`open-otp` provides:

- `otp` CLI for adding, importing, listing, showing, removing, and generating TOTP codes.
- `otp-mcp` MCP server with tools to list labels and generate codes without returning seeds.
- SDK exports for TypeScript/Bun automation.
- Local encrypted storage at `~/.hasna/otp/`.

TOTP seeds are credentials. Normal CLI, SDK metadata, and MCP responses never return seed values.

## Install

```bash
bun install -g @hasna/otp
otp bootstrap
otp --version
```

## Storage

The local store is bootstrapped at:

```text
~/.hasna/otp/
  entries.json
  vault.key
```

Entries are encrypted with AES-256-GCM using a locally generated 256-bit key. The directory is chmod `700`; `entries.json` and `vault.key` are chmod `600`.

Security limitation: this first release protects against accidental disclosure in source, logs, normal command output, backups, and shared file reads, but the local key lives on the same machine as the encrypted store. Use full-disk encryption and OS account isolation. Future releases can add hardware-backed or `open-secrets` remote key wrapping.

Set `HASNA_OTP_HOME=/path/to/store` to use a non-default local store.

## CLI

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
otp generate Example:agent@example.com --json
```

Remove an entry:

```bash
otp remove Example:agent@example.com
```

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

## SDK

```ts
import { addOtpEntry, generateOtpCode, listOtpEntries } from "@hasna/otp";

const entries = listOtpEntries();
const code = generateOtpCode(entries[0].id);
```

Key exports:

- `addOtpEntry(input)`
- `importOtpAuthUri(input)`
- `listOtpEntries()`
- `getOtpEntry(target)`
- `generateOtpCode(target)`
- `removeOtpEntry(target)`
- `getOtpStorageStatus()`

## Development

```bash
bun install
bun run build
bun run typecheck
bun test
```
