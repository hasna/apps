# HashiCorp Vault Connector

TypeScript connector for the [HashiCorp Vault HTTP API](https://developer.hashicorp.com/vault/api-docs). Targets self-hosted Vault clusters with token authentication (`X-Vault-Token`) and optional enterprise namespaces (`X-Vault-Namespace`).

## Install

```bash
bun install
bun run build
```

## Configuration

Set credentials via environment variables or CLI profiles (`~/.hasna/connectors/vault/`):

| Variable | Description |
|----------|-------------|
| `VAULT_BASE_URL` | Vault API base URL (required, no cloud default) |
| `VAULT_TOKEN` | Vault token |
| `VAULT_NAMESPACE` | Optional enterprise namespace |

```bash
connect-vault config set-base-url https://vault.example.com
connect-vault config set-token hvs.CAES...
connect-vault config set-namespace admin/team-a
```

## CLI

```bash
bun run dev sys health
bun run dev kv read service/api --mount kv
bun run dev transit encrypt app-key --plaintext cGxhaW4=
bun run dev token lookup-self
```

Grouped commands: `sys`, `token`, `mounts`, `auth`, `policies`, `kv`, `transit`, `leases`, `identity`, `wrap`, `audit`, `profile`, `config`.

## Library

```typescript
import { Vault } from '@hasna/connect-vault';

const vault = Vault.fromEnv();
const health = await vault.getHealth();
const secret = await vault.readKvSecret({ mount: 'kv', path: 'service/api' });
```

## API surface

Covers system health/seal, token lifecycle, mounts, auth methods, ACL policies, KV v2, transit encrypt/decrypt/sign/verify, leases, identity entities, response wrapping, and audit devices.

## License

Apache-2.0
