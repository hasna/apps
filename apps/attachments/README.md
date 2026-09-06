# @hasna/attachments

Authenticated HTTPS attachment clients and a PostgreSQL-backed service.

## Client usage

Every hosted surface — the `attachments` CLI, `attachments-mcp`, the package
root and `@hasna/attachments/sdk` — resolves its credential and service
authority through the ONE shared resolver in `@hasna/contracts` (1.0.2),
fresh on every call. There is no per-app chain, no local database and no
fallback: hosted mode with no resolvable credential fails loudly.

### Resolver chain (per call)

| Tier | Credential | Authority |
|---|---|---|
| 1 argument | `--api-key` / `--profile` (CLI flag or `credentials` option) | explicit `baseUrl` (SDK) |
| 2 pointer | `HASNA_ATTACHMENTS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_ATTACHMENTS_API_KEY_REF` | — |
| 3 Keychain (macOS) | `hasna.credentials.attachments.api-key`, account `HASNA_STATION` \| `hostname -s` \| `USER` | `hasna.credentials.attachments.api-url` |
| 4 disk (0600) | `~/.hasna/attachments/config/credentials` (`HASNA_HOME` / `HASNA_CONFIG_HOME` move the root) | same file |

| Env variable | Meaning |
|---|---|
| `HASNA_ATTACHMENTS_API_URL` | HTTPS service origin (or path prefix). Blank/conflicting = error. |
| `HASNA_ATTACHMENTS_API_KEY` | API key. Blank/conflicting = error. |
| `HASNA_ATTACHMENTS_API_KEY_OVERRIDE` | Deliberate per-process override, outranks disk. |
| `HASNA_ATTACHMENTS_API_KEY_REF` | Secrets-vault pointer (resolved through @hasna/secrets at request time). |
| `HASNA_PROFILE` | Selects a named identity's credential file. |
| `ATTACHMENTS_API_URL` / `ATTACHMENTS_API_KEY` | Legacy unprefixed aliases — accepted by the resolver below the canonical names for one release only. |

With a credential resolved and no URL configured, the fleet gateway
`https://api.hasna.com/attachments` applies (the client appends `/v1`), so a
key alone is a complete configuration. A URL without a key, a declared-but-blank
pair, or conflicting aliases refuse loudly — every failure names the tiers it
consulted. URLs must not contain userinfo, query strings or fragments.

Nothing reads `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`,
`$XDG_CONFIG_HOME`, a `~/.attachments/config.json` key store, or any
`*_MODE` / `*_STORAGE_MODE` switch. The retired `--client-mode` flag always
fails. Credentials are never included in diagnostics.

The package root exports `resolveStore`, `ApiStore` and `resolveAttachmentsV1`.
`@hasna/attachments/sdk` and the separate SDK export `AttachmentsApiClient`
(required `baseUrl` and `apiKey` options) plus `resolveAttachmentsSdkTransport`
and `createAttachmentsApiClient`, which put the resolver behind the generated
client — resolved per request, so a key rotation heals a long-lived process
without a rebuild. An explicit `baseUrl` with no `apiKey` never attaches the
ambient fleet key. All authenticated requests refuse redirects.

attachments-mcp exposes attachment operations over MCP. Client S3
configuration, LocalStore and the old unauthenticated /api SDK are retired.
S3 credentials and PostgreSQL DSNs belong only on the service.

## Service

attachments-serve uses validated server-side PostgreSQL configuration
(`HASNA_ATTACHMENTS_DATABASE_URL`, `HASNA_ATTACHMENTS_API_SIGNING_KEY` and
object storage). See [configuration](docs/configuration.md) for environment
requirements, [migration status](docs/canonical-migration.md) before
attempting a release, and [S3 storage](docs/s3-storage.md) for the canonical
object layout and the bucket configuration end state.

Local configuration follows @hasna/paths. Existing legacy files are preserved
untouched; there is no automatic import or migration.