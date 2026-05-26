# connect-gitea

Gitea API connector with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-gitea
```

## Quick Start

```bash
# Set your API key
connect-gitea config set-key YOUR_API_KEY

# Or use environment variable
export GITEA_API_KEY=YOUR_API_KEY
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

Apache-2.0
