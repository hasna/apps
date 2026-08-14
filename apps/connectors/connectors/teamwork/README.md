# @hasna/connect-teamwork

A TypeScript connector and CLI for the [Teamwork.com](https://www.teamwork.com/) project management API, with multi-profile configuration support.

Built against the public Teamwork API v3. Endpoints live under `/projects/api/v3` and authenticate with an API token over HTTP Basic auth.

## Features

- Projects, tasks, task lists, milestones, people, companies, time entries, and comments
- HTTP Basic authentication using a Teamwork API token
- Multi-profile configuration (switch between sites / accounts)
- Automatic retries with exponential backoff for `429` and `5xx` responses
- Pretty, table, and JSON output formats
- Usable as a library or a CLI

## Installation

```bash
bun install
bun run build
```

## Authentication

1. In Teamwork, open the profile menu → **Edit My Details** → **API & Mobile** and reveal your API token.
2. Note your site name — the `{installation}` in `https://{installation}.teamwork.com`.
3. Configure the connector:

```bash
connect-teamwork config set-key <your-api-token>
connect-teamwork config set-installation <your-site-name>
```

Or use environment variables:

```bash
export TEAMWORK_API_KEY=your-api-token
export TEAMWORK_INSTALLATION=your-site-name
# Optional full override:
# export TEAMWORK_BASE_URL=https://your-site-name.teamwork.com
```

## CLI Usage

```bash
connect-teamwork [options] [command]

Global options:
  -k, --api-key <key>          API token (overrides config)
  -s, --installation <name>    Teamwork site name
      --base-url <url>         Full base URL override
  -f, --format <format>        Output format (json, table, pretty)
  -p, --profile <profile>      Use a specific profile
  -v, --verbose                Verbose output
```

### Examples

```bash
# Projects
connect-teamwork projects list --limit 20
connect-teamwork projects get 12345 --include companies
connect-teamwork projects create --name "Website Relaunch"

# Tasks
connect-teamwork tasks list --project 12345
connect-teamwork tasks get 67890
connect-teamwork tasks create <tasklistId> --name "Draft copy" --priority high
connect-teamwork tasks complete 67890

# Task lists, milestones, people, companies
connect-teamwork tasklists list 12345
connect-teamwork milestones list --project 12345
connect-teamwork people me
connect-teamwork companies list

# Time entries and comments
connect-teamwork time list --project 12345
connect-teamwork comments list --task 67890
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-teamwork';

const tw = new Connector({
  apiKey: process.env.TEAMWORK_API_KEY!,
  installation: process.env.TEAMWORK_INSTALLATION!,
});

const { projects } = await tw.projects.list({ pageSize: 20 });
const { task } = await tw.tasks.get(67890);

// Or build from environment variables directly:
const fromEnv = Connector.fromEnv();
```

## API Resources

| Resource     | Operations                                             |
| ------------ | ------------------------------------------------------ |
| `projects`   | list, get, create, update, delete                      |
| `tasks`      | list, listByProject, get, create, update, complete, delete |
| `tasklists`  | listByProject, get, create, delete                     |
| `milestones` | list, listByProject, get                               |
| `people`     | list, listByProject, get, me                           |
| `companies`  | list, get                                              |
| `time`       | list, listByProject, listByTask                        |
| `comments`   | list, listByTask                                       |

## Development

```bash
bun install
bun run dev        # run the CLI from source
bun run typecheck  # tsc --noEmit
bun run build      # bundle to dist/ and bin/
bun test           # run unit tests
```

## License

Apache-2.0
