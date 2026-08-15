# Security Policy

## Reporting

Report security issues privately to the maintainers before opening public issues.

Do not include API keys, TOTP seeds, backup codes, recovery codes, passwords, session cookies, or live OTP codes in reports, logs, screenshots, or chat messages. Redact values and include only metadata needed to reproduce the issue.

## Threat Model

### Assets

| Asset | Location | Sensitivity |
|-------|----------|-------------|
| TOTP seeds (plaintext) | In-memory only during `generateOtpCode` / TOTP computation | Critical — equivalent to account takeover |
| `encrypted_secret` blobs | `entries.json` per entry | High — ciphertext only; useless without `vault.key` |
| `vault.key` | `~/.hasna/otp/vault.key` (or `HASNA_OTP_HOME`) | Critical — 256-bit AES key material |
| `entries.json` | `~/.hasna/otp/entries.json` | High — metadata + encrypted secrets |
| Generated TOTP codes | CLI/MCP/SDK output | Time-limited; still sensitive |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  CLI / SDK / MCP surfaces (metadata + codes only)           │
│  ─────────────────────────────────────────────────────────  │
│  publicEntry() strips encrypted_secret before every return  │
└──────────────────────────┬──────────────────────────────────┘
                           │ decryptSecret() only inside
                           │ generateOtpCode() (in-process)
┌──────────────────────────▼──────────────────────────────────┐
│  On-disk store (~/.hasna/otp/)                              │
│  entries.json (enc:v1 blobs) + vault.key (hex-encoded)      │
│  dir 700, files 600                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │ OS file permissions
┌──────────────────────────▼──────────────────────────────────┐
│  OS user account + full-disk encryption                     │
└─────────────────────────────────────────────────────────────┘
```

- **CLI / SDK / MCP** are trusted to call the storage layer correctly; they never serialize `encrypted_secret` or plaintext seeds in normal outputs.
- **On-disk store** is encrypted at rest; plaintext seeds exist only transiently in process memory during code generation.
- **OS user boundary** is the primary isolation layer. Any process running as the same user that can read both `vault.key` and `entries.json` can decrypt all seeds.

### Adversaries Considered

| Adversary | Mitigation | Residual risk |
|-----------|------------|---------------|
| Accidental log/disclosure (stdout, agent transcripts) | `publicEntry()` strips secrets; CLI `compactEntry()` omits them; MCP tools return metadata + codes only | User piping `--secret` on command line bypasses storage protections |
| Co-tenant file read (other Unix users) | Store directory `chmod 700`, files `chmod 600` | Misconfigured permissions or shared home directories |
| Compromised same-user process | File permissions do not isolate processes sharing the UID | Full decryption if attacker reads `vault.key` + `entries.json` |
| Backup/snapshot exposure | Encrypted blobs in `entries.json` | `vault.key` in the same backup defeats encryption |
| MCP stdio peer | MCP server runs locally; stdio transport trusts the parent process | Malicious parent can invoke tools and receive codes |

## Key Management

`open-otp` v1 uses a **locally generated random key**, not password-based key derivation (no PBKDF2, Argon2, or passphrase KDF).

On first bootstrap (`otp bootstrap` or any operation that calls `getMasterKey()`):

1. `randomBytes(32)` generates a 256-bit key.
2. The key is written to `vault.key` as a single hex-encoded line.
3. The file is created with mode `0600` and re-chmodded on every read.

Subsequent reads load the hex key from disk and cache it in-process. There is no remote key escrow, HSM wrapping, or `open-secrets` integration in v1.

**Implication:** whoever possesses `vault.key` can decrypt every `encrypted_secret` in `entries.json`. Protect the key file with the same care as a password database.

## At-Rest Encryption

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Key | 32 bytes from `vault.key` |
| IV | 12 bytes, random per encryption (`randomBytes`) |
| Auth tag | 16 bytes (GCM), appended to ciphertext |
| Wire format | `enc:v1:{iv_hex}:{ciphertext+tag_hex}` |

### File Layout

```text
~/.hasna/otp/          (mode 0700; override with HASNA_OTP_HOME)
  vault.key            (mode 0600; hex-encoded 32-byte key)
  entries.json         (mode 0600; atomic write via pid-suffixed temp + rename)
```

`entries.json` schema: `open-otp.store.v1` with an `entries` array. Each stored entry includes `encrypted_secret` (internal); this field is never returned by public APIs.

`decryptSecret()` refuses values that do not start with `enc:v1:`.

## Non-Exposure Guarantees

Plaintext TOTP seeds and `encrypted_secret` values are **never** returned by normal CLI, SDK, or MCP surfaces. `generateOtpCode()` decrypts in-process solely to compute a TOTP code; only the code and metadata are returned.

| Surface | Command / export | Returned | Never returned |
|---------|------------------|----------|----------------|
| CLI | `otp bootstrap` | Storage status (paths, counts) | Seeds, `encrypted_secret` |
| CLI | `otp add` / `otp import` | Entry metadata (`compactEntry`) | Seed (accepted as input only) |
| CLI | `otp list` / `otp show` | Entry metadata | Seeds, `encrypted_secret` |
| CLI | `otp generate` | Code + expiry metadata | Seed |
| CLI | `otp remove` | Removed entry metadata | Seeds, `encrypted_secret` |
| CLI | `otp status` | Storage status | Seeds, `encrypted_secret` |
| SDK | `listOtpEntries()` | `OtpEntry[]` | `encrypted_secret` |
| SDK | `getOtpEntry()` | `OtpEntry` | `encrypted_secret` |
| SDK | `addOtpEntry()` / `importOtpAuthUri()` | `OtpEntry` (public fields) | Plaintext seed in return value |
| SDK | `removeOtpEntry()` | `OtpEntry` | `encrypted_secret` |
| SDK | `generateOtpCode()` | `GeneratedOtpCode` (code + metadata) | Seed |
| SDK | `getOtpStorageStatus()` | Paths, counts, `encrypted_at_rest` | Seeds, key bytes |
| MCP | `otp_list_labels` | id, label, issuer, account, algorithm, digits, period | Seeds, `encrypted_secret` |
| MCP | `otp_generate_code` | Code + expiry metadata | Seed |
| MCP | `otp_status` | home, entries count, storage flags | Seeds, paths to key material omitted from response |

**Input-only secret surfaces:** `addOtpEntry({ secret })`, `importOtpAuthUri({ uri })`, and CLI `--secret` / `--secret-stdin` / `--secret-env` accept seeds as write inputs. These are intentional enrollment paths, not read-back surfaces.

Type separation enforces this at compile time: `OtpEntry` (public) vs `StoredOtpEntry` (adds `encrypted_secret`, internal to `storage.ts`).

## Limitations and Out of Scope (v1)

- **Same-user attacker:** A process running as the store owner with read access to `vault.key` and `entries.json` can decrypt all seeds offline.
- **No rate limiting:** `otp generate` and `otp_generate_code` can be called repeatedly; codes are short-lived but not throttled.
- **No hardware-backed keys:** `vault.key` is a plaintext file on disk.
- **Backup exposure:** Backups that include both `vault.key` and `entries.json` are equivalent to a plaintext seed export.
- **MCP trust model:** The stdio MCP server trusts its parent process. It does not authenticate callers.
- **Command-line secrets:** Passing `--secret` on the argv exposes the seed to shell history and process listings; prefer `--secret-stdin` or `--secret-env`.
- **Memory:** Plaintext seeds exist briefly in heap during TOTP generation; there is no secure-memory zeroing guarantee.

Future releases may add remote key wrapping (`open-secrets`), hardware-backed keys, or stronger isolation. v1 prioritizes preventing accidental disclosure through normal tool outputs and protecting against cross-user file reads.

## Secret Handling

TOTP seeds are credentials.

`open-otp` stores seeds encrypted at rest in `~/.hasna/otp/entries.json` and stores local key material in `~/.hasna/otp/vault.key`. Both files are created with owner-only permissions. Normal CLI and MCP surfaces return labels and generated codes only, never seed values.

This local encryption model does not protect against a compromised OS user account that can read both the encrypted store and local key. Use full-disk encryption, keep backups encrypted, and restrict access to the user account running agents.

## Supported Versions

Only the latest published version receives fixes.
