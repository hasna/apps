# @hasna/connect-tenable

A TypeScript client and CLI for the [Tenable Vulnerability Management (Tenable.io)](https://developer.tenable.com/reference) REST API, with multi-profile credential management.

## Features

- Typed API client for scans, workbench assets, workbench vulnerabilities, scanners, folders, and session
- `X-ApiKeys` access-key/secret-key authentication
- Multi-profile configuration (switch between different accounts)
- Pretty and JSON output formats
- TypeScript, strict mode, ESM

## Installation

```bash
bun install
```

## Authentication

Generate an API key pair in the Tenable UI (**Settings → My Account → API Keys**), then provide the
credentials via environment variables or a stored profile:

```bash
export TENABLE_ACCESS_KEY="your-access-key"
export TENABLE_SECRET_KEY="your-secret-key"
# optional, defaults to https://cloud.tenable.com
export TENABLE_BASE_URL="https://cloud.tenable.com"
```

or

```bash
bun run dev config set-keys <accessKey> <secretKey>
```

See `.env.example` for the full list of variables.

## CLI Usage

```bash
tenable [options] [command]

Global options:
  --access-key <key>       Tenable access key (overrides config)
  --secret-key <key>       Tenable secret key (overrides config)
  -f, --format <format>    Output format (json, pretty)
  -p, --profile <profile>  Use a specific profile
  -v, --verbose            Enable verbose output

Commands:
  session                          Show the current API session (verify credentials)
  scans list [--folder <id>]       List scans
  scans get <id>                   Get scan details
  scans launch <id> [--targets]    Launch a scan
  assets list [--days <n>]         List workbench assets
  assets get <id>                  Get asset info
  vulns list [--days] [--severity] List aggregated vulnerabilities
  vulns get <pluginId>             Get vulnerability/plugin info
  scanners                         List available scanners
  folders                          List scan result folders

  config set-keys <access> <secret>  Store API keys for the active profile
  config set-base-url <url>          Store a custom base URL
  config show                        Show current configuration
  config clear                       Clear configuration for active profile

  profile list                       List profiles
  profile use <name>                 Switch profile
  profile create <name>              Create a profile
  profile delete <name>              Delete a profile
  profile show [name]                Show profile configuration
```

## Library Usage

```typescript
import { Tenable } from '@hasna/connect-tenable';

const tenable = Tenable.fromEnv(); // reads TENABLE_ACCESS_KEY / TENABLE_SECRET_KEY

const { scans } = await tenable.listScans();
const assets = await tenable.listAssets({ dateRange: 30 });
const vulns = await tenable.listVulnerabilities({ severity: 'critical' });
```

## Development

```bash
bun install
bun run dev        # run the CLI
bun run typecheck  # type-check
bun run build      # build to dist/ and bin/
bun test           # run unit tests
```

## API Reference

Endpoints wrapped by this connector:

| Method | Endpoint | Client method |
|--------|----------|---------------|
| GET  | `/scans` | `listScans()` |
| GET  | `/scans/{id}` | `getScan()` |
| POST | `/scans/{id}/launch` | `launchScan()` |
| GET  | `/workbenches/assets` | `listAssets()` |
| GET  | `/workbenches/assets/{id}/info` | `getAssetInfo()` |
| GET  | `/workbenches/vulnerabilities` | `listVulnerabilities()` |
| GET  | `/workbenches/vulnerabilities/{plugin_id}/info` | `getVulnerabilityInfo()` |
| GET  | `/scanners` | `listScanners()` |
| GET  | `/folders` | `listFolders()` |
| GET  | `/session` | `getSession()` |

## License

Apache-2.0
