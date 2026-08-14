# Windmill Connector

TypeScript CLI and library for the [Windmill](https://www.windmill.dev/) workflow script platform REST API.

## Install

```bash
bun install
```

## Configuration

```bash
export WINDMILL_API_KEY=your-api-key
# optional
export WINDMILL_BASE_URL=https://api.windmill.dev/v1
export WINDMILL_WORKSPACE=your-workspace
```

Or use profile-based config:

```bash
bun run dev config set-key your-api-key
```

## Usage

```bash
bun run dev scripts list
bun run dev scripts get f/scripts/hello
bun run dev scripts create --body '{"path":"f/scripts/hello","summary":"Example"}'
bun run dev events list
bun run dev search --body '{"query":"example"}'
bun run dev raw-request --path /scripts --method GET
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
