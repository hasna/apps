# connect-typesense

TypeScript connector for the [Typesense](https://typesense.org/) search engine REST API.

## Install

```bash
bun install
```

## Configuration

Set credentials via environment variables or profile:

```bash
export TYPESENSE_API_KEY=your-api-key
export TYPESENSE_HOST=https://xxx.a1.typesense.net

# or
bun run dev config set-key your-api-key
bun run dev config set-host https://xxx.a1.typesense.net
```

## Usage

```bash
# Health
bun run dev health check

# Collections
bun run dev collections list
bun run dev collections get books

# Documents
bun run dev documents get books doc-1
bun run dev documents import books --jsonl '{"id":"1","title":"Dune"}'

# Search
bun run dev search query books -q "dune" --query-by title,author

# API keys
bun run dev keys list
```

## Development

```bash
bun run dev          # Run CLI from source
bun run build        # Build dist + bin
bun run typecheck    # Type check
bun test             # Unit tests (mocked fetch)
```

## License

Apache-2.0
