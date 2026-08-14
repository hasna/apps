# @hasna/connect-tettra-api-platform

TypeScript connector and CLI for the [Tettra Api Platform](https://api.tettraapiplatform.com/v1) API.

## Install

```bash
bun install
```

## Configuration

```bash
export TETTRA_API_PLATFORM_API_KEY=your-api-key
# optional
export TETTRA_API_PLATFORM_BASE_URL=https://api.tettraapiplatform.com/v1
```

Or use the CLI profile:

```bash
bun run dev config set-key your-api-key
```

## Usage

```bash
bun run dev items list
bun run dev items get <itemId>
bun run dev items create --body '{"title":"Example"}'
bun run dev events list
bun run dev search "query text"
bun run dev raw GET /items
```

## License

Apache-2.0
