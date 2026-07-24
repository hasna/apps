# @hasna/connect-talend-api-platform

A TypeScript CLI and library for the [Talend Cloud Management Console Public API](https://api.us.cloud.talend.com/tmc/) (`/tmc/v1.2`). Manage Talend Cloud **tasks** (executables), **plans**, and **promotions**, run them, and track **executions** — all with a real REST client and Bearer (personal access token) authentication.

## Features

- Real Talend Cloud Management Console Public API client (no scraping)
- Region-aware base URLs (US, EU, AP) with a base-URL override
- Multi-profile configuration (switch between tenants/accounts)
- Task / plan / promotion listing and retrieval
- Task & plan execution plus execution status/stop
- Pretty, table, and JSON output formats

## Install

```bash
bun install
```

## Authentication

Generate a personal access token in Talend Cloud:
**Profile preferences → Personal access tokens → Add token**.

Provide it via environment variable or the CLI config:

```bash
export TALEND_API_TOKEN=your-personal-access-token
export TALEND_REGION=us   # us | eu | ap (default: us)

# or persist it in a profile
connect-talend-api-platform config set-token your-personal-access-token
connect-talend-api-platform config set-region eu
```

## CLI Usage

```bash
# Tasks (executables)
connect-talend-api-platform task list --limit 20
connect-talend-api-platform task get <executableId>
connect-talend-api-platform task run <executableId> --param key=value --log-level INFO

# Plans
connect-talend-api-platform plan list
connect-talend-api-platform plan run <planId>

# Promotions
connect-talend-api-platform promotion list

# Executions
connect-talend-api-platform execution status <executionId>
connect-talend-api-platform execution stop <executionId>
```

### Global flags

| Flag | Description |
|------|-------------|
| `-t, --token <token>` | Personal access token (overrides config) |
| `-r, --region <region>` | Region: `us`, `eu`, `ap` |
| `--base-url <url>` | API base URL override |
| `-f, --format <format>` | Output format: `pretty`, `table`, `json` |
| `-p, --profile <name>` | Use a specific profile |

## Library Usage

```typescript
import { TalendApiPlatform } from '@hasna/connect-talend-api-platform';

const talend = TalendApiPlatform.fromEnv(); // uses TALEND_API_TOKEN / TALEND_REGION

const tasks = await talend.listTasks({ limit: 50 });
const { executionId } = await talend.runTask({ executable: tasks[0].executable });
const status = await talend.getExecution(executionId);
console.log(status.status); // e.g. RUNNING, EXECUTED
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TALEND_API_TOKEN` | Personal access token (required) |
| `TALEND_REGION` | `us`, `eu`, or `ap` (default `us`) |
| `TALEND_BASE_URL` | Full API base URL override |

## Development

```bash
bun run dev <command>   # run the CLI from source
bun run typecheck       # type-check
bun test                # run tests
bun run build           # build dist/ and bin/
```

## License

Apache-2.0
