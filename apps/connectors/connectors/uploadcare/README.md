# connect-uploadcare

Uploadcare REST API connector with multi-profile support for file storage, CDN delivery, groups, webhooks, and project settings.

## Installation

```bash
bun install -g @hasna/connect-uploadcare
```

## Quick Start

```bash
# Set your API credentials
connect-uploadcare config set-credentials YOUR_PUBLIC_KEY YOUR_SECRET_KEY

# Or use environment variables
export UPLOADCARE_PUBLIC_KEY=YOUR_PUBLIC_KEY
export UPLOADCARE_SECRET_KEY=YOUR_SECRET_KEY
```

## Development

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## License

Apache-2.0
