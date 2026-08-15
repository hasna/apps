# MCP Server Reference

`otp-mcp` runs a Model Context Protocol server over stdio. It uses
`HASNA_OTP_HOME`, or `~/.hasna/otp/` when the variable is unset.

```bash
otp-mcp
```

The binary accepts `-V, --version` and `-h, --help`. It has no enrollment or
removal tools; use the `otp` CLI or SDK to change stored entries.

## Tools

### `otp_list_labels`

Takes no arguments. Returns a JSON array containing each entry's `id`,
`label`, optional `issuer`, `account`, `algorithm`, `digits`, and `period`.
Timestamps and seeds are not returned.

### `otp_generate_code`

Generates a TOTP code for a stored entry.

| Input | Required | Description |
|-------|----------|-------------|
| `target` | Yes | Entry id, label, `issuer:account`, or unique account. Matching is case-insensitive. |
| `at` | No | Unix timestamp in seconds or ISO date for deterministic generation. |

The result contains `id`, `label`, optional `issuer`, `account`, `code`,
`period`, `expires_at`, `expires_in`, and `counter`. An ambiguous account or
other target fails and must be replaced with an id.

### `otp_status`

Takes no arguments. Returns `home`, entry count, `storage`, and
`encrypted_at_rest`. It does not return store/key paths, key bytes, or seeds.

## Security boundary

The stdio parent process is trusted and can request generated codes repeatedly.
MCP responses never contain plaintext seeds or `encrypted_secret`, but a
generated code remains sensitive until it expires. See
[the security policy](../SECURITY.md) for the complete threat model.
