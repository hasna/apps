# @hasna/connect-typless

TypeScript connector for the [Typless API](https://typless.gitbook.io/typlessapi) — AI-powered document data extraction and OCR.

## Features

- Synchronous and asynchronous document data extraction
- Training dataset management and model training
- Multi-profile configuration
- Token API key authentication
- CLI and programmatic library API

## Quick Start

```bash
cd connectors/typless
bun install
export TYPLESS_API_KEY=your-api-key-here
bun run dev extraction extract --file invoice.pdf --document-type my-invoice
```

## CLI

```bash
connect-typless extraction extract --file <path> --document-type <name>
connect-typless extraction extract-async --file <path> --document-type <name> --wait
connect-typless extraction get <extraction-id>
connect-typless extraction awaiting-poll [--customer <id>]
connect-typless training add-document --file <path> --document-type <name>
connect-typless training start --document-type <name>
connect-typless config set-key <key>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYPLESS_API_KEY` | API key from https://app.typless.com/settings/api-keys |
| `TYPLESS_BASE_URL` | Optional base URL (default: `https://developers.typless.com/api`) |

## License

Apache-2.0
