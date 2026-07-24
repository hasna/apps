# connect-trybloom

TypeScript connector for the [Bloom](https://www.trybloom.ai/) on-brand creative API.

## Features

- Bearer token authentication
- Multi-profile configuration
- Brands, generations, and image operations
- Raw request escape hatch
- CLI and library exports

## Quick Start

```bash
bun install
export TRYBLOOM_API_KEY=your-api-key-here
bun run dev brands list
```

## CLI

```bash
connect-trybloom brands list
connect-trybloom brands get <brandId>
connect-trybloom brands create --name "Acme" --body '{"palette":["#111111"]}'
connect-trybloom generations create --prompt "launch image" --brand-id <id>
connect-trybloom generations get <generationId>
connect-trybloom images edit --image-url <url> --prompt "brighter"
connect-trybloom images resize --image-url <url> --width 1200
connect-trybloom images upload --image-url <url>
connect-trybloom raw-request --path /brands --method POST --body '{"name":"Raw"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRYBLOOM_API_KEY` | API key (overrides profile) |
| `TRYBLOOM_BASE_URL` | Override base URL (default `https://www.trybloom.ai/api/v1`) |

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
