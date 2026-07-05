# Windmill Api Platform Connector

TypeScript CLI and library for the [Windmill Api Platform](https://api.windmillapiplatform.com/v1) REST API.

## Install

```bash
bun install
```

## Configuration

```bash
export WINDMILL_API_PLATFORM_API_KEY=your-api-key
# optional
export WINDMILL_API_PLATFORM_BASE_URL=https://api.windmillapiplatform.com/v1
```

Or use profile-based config:

```bash
bun run dev config set-key your-api-key
```

## Usage

```bash
bun run dev items list
bun run dev items get item-1
bun run dev items create --body '{"name":"example"}'
bun run dev events list
bun run dev search --body '{"query":"example"}'
bun run dev raw-request --path /items --method GET
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
