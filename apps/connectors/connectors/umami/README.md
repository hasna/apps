# connect-umami

TypeScript connector for the [Umami](https://umami.is) privacy-focused analytics platform.

## Features

- Umami Cloud (`https://api.umami.is/v1`) and self-hosted instances
- API key authentication via `x-umami-api-key`
- Website management and analytics (stats, pageviews, metrics, events, event data)
- Team management
- Multi-profile configuration

## Install

```bash
bun install
bun run build
```

## Quick start

```bash
export UMAMI_API_KEY=your_api_key_here
connect-umami websites list
connect-umami stats summary <websiteId> --start-at 2026-01-01 --end-at 2026-01-31
```

## Documentation

See [CLAUDE.md](./CLAUDE.md) for CLI commands, environment variables, and API notes.

## License

Apache-2.0
