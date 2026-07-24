# connect-toggl

TypeScript connector for the [Toggl Track REST API v9](https://engineering.toggl.com/docs/).

## Features

- Multi-profile configuration
- Basic token authentication
- Workspaces, projects, clients, tags, tasks, and time entries
- Pretty and JSON output formats
- TypeScript with strict mode

## Quick Start

```bash
bun install
bun run dev config set-token <your-api-token>
bun run dev me show
bun run dev me workspaces
```

Get your API token from https://track.toggl.com/profile

## CLI Commands

```bash
connect-toggl [options] [command]

Commands:
  profile list|use|create|delete|show   Manage profiles
  config set-token|show|clear|path      Manage configuration
  me show|workspaces|projects|clients List personal resources
  workspace get|users <workspaceId>     Workspace operations
  project list|get|create|update|delete Project management
  client list|create|update|delete      Client management
  tag list|create|delete                Tag management
  task list|create                      Task management
  time-entry list|current|get|create|update|stop|delete
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOGGL_API_TOKEN` | API token (overrides profile config) |

## Development

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
