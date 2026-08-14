# CLAUDE.md

HashiCorp Vault connector (`@hasna/connect-vault`) for self-hosted Vault HTTP API access.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Auth

- **Token header**: `X-Vault-Token` (required)
- **Namespace header**: `X-Vault-Namespace` (optional)
- **No default base URL** — `VAULT_BASE_URL` or profile `baseUrl` is required

## Structure

- `src/api/client.ts` — HTTP client (LIST → GET + `list=true`, Vault error parsing)
- `src/api/index.ts` — `Vault` facade (sys, token, KV, transit, leases, identity, wrap, audit)
- `src/cli/index.ts` — Commander CLI grouped by API area
- `src/utils/config.ts` — Profiles at `~/.hasna/connectors/vault/`

## Environment

| Variable | Description |
|----------|-------------|
| `VAULT_BASE_URL` | Vault API base URL |
| `VAULT_TOKEN` | Vault token |
| `VAULT_NAMESPACE` | Optional namespace |

## Notes

- Distinct from `hashicorp-vault` (HashiCorp Cloud Platform API at api.hashicorpvault.com).
- KV defaults to mount `secret`; transit defaults to mount `transit`.
- Response wrap uses `X-Vault-Wrap-TTL` header.
