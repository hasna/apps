# Windmill API Platform Connector

TypeScript CLI and library for workspace-scoped Windmill REST APIs.

## Install

```bash
bun install
```

## Configuration

```bash
export WINDMILL_API_PLATFORM_API_KEY=your-api-key
export WINDMILL_API_PLATFORM_BASE_URL=https://your-windmill.example.com/api
export WINDMILL_API_PLATFORM_WORKSPACE=your-workspace
```

Or use profile-based config:

```bash
bun run dev config set-key your-api-key
bun run dev config set-base-url https://your-windmill.example.com/api
bun run dev config set-workspace your-workspace
```

## Usage

```bash
bun run dev scripts list
bun run dev scripts get u/admin/script
bun run dev scripts run-wait u/admin/script --body '{"name":"example"}'
bun run dev flows list
bun run dev resources list
bun run dev jobs list
bun run dev raw-request --path /w/your-workspace/scripts/list --method GET
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
