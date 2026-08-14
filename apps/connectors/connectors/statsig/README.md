# Statsig Connector

TypeScript connector for the [Statsig Console API](https://docs.statsig.com/console-api/introduction).

## Features

- Feature gates, experiments, dynamic configs, segments, layers, metrics, and more
- API key authentication via `STATSIG-API-KEY` header
- Multi-profile CLI configuration
- Library exports for programmatic use

## Installation

```bash
bun install
bun run build
```

## Configuration

```bash
export STATSIG_API_KEY=your-console-api-key
# or
connect-statsig config set-key your-console-api-key
```

## CLI Examples

```bash
connect-statsig gates list
connect-statsig gates get my_gate
connect-statsig experiments list
connect-statsig dynamic-configs list
```

## License

Apache-2.0
