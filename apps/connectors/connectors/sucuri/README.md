# @hasna/connect-sucuri

A TypeScript CLI and library for Sucuri's documented Scanning API. It requests real-time scans for a domain or URL using the monitor-domain endpoint described in Sucuri's docs.

Reference: https://docs.sucuri.net/website-monitoring/scanning-api/

## Install

```bash
bun install
bun run build
```

## Authentication

The Scanning API uses a monitor domain plus API key from the Sucuri monitor dashboard under API > Scanning API.

| Variable | Description |
|----------|-------------|
| `SUCURI_API_KEY` | Scanning API key (required) |
| `SUCURI_MONITOR_DOMAIN` | Monitor domain, for example `monitorx.sucuri.net` (required) |

Copy `.env.example` to `.env` and fill in your values, or store them in a profile:

```bash
connect-sucuri config set-key <key>
connect-sucuri config set-monitor-domain monitorx.sucuri.net
```

## CLI Usage

```bash
# Configuration
connect-sucuri config set-key <key>
connect-sucuri config set-monitor-domain monitorx.sucuri.net
connect-sucuri config show

# Profiles
connect-sucuri profile create work --api-key <key> --monitor-domain monitorx.sucuri.net --use
connect-sucuri profile list

# Scan
connect-sucuri scan example.com
connect-sucuri scan https://example.com/path --scan-format text
```

Global flags: `-k, --api-key`, `--monitor-domain`, `-p, --profile`, `-f, --format <json|pretty|table>`.

## Library Usage

```typescript
import { Sucuri } from '@hasna/connect-sucuri';

const sucuri = Sucuri.fromEnv(); // reads SUCURI_API_KEY / SUCURI_MONITOR_DOMAIN

const result = await sucuri.scan({
  host: 'example.com',
  format: 'simple',
});

console.log(result.body);
```

## Development

```bash
bun run dev      # run the CLI from source
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
