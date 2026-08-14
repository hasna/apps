# connect-smol-machines

TypeScript connector for the [smol machines](https://github.com/smol-machines/smolvm) portable microVM HTTP API.

## Features

- Machine lifecycle: list, create, get, start, stop, exec, delete
- Optional Bearer authentication for hosted API
- Works without API key against local `smolvm serve`
- Multi-profile configuration
- Pretty and JSON output formats

## Quick Start

```bash
bun install
bun run dev list-machines
```

### Local smolvm

```bash
# Start local API server
smolvm serve start --listen 127.0.0.1:8080

# Point connector at local API (no API key required)
export SMOL_MACHINES_BASE_URL=http://127.0.0.1:8080/api/v1
bun run dev list-machines
```

### Hosted API

```bash
export SMOL_MACHINES_API_KEY=your-api-key
bun run dev list-machines
```

## CLI Commands

```bash
connect-smol-machines list-machines
connect-smol-machines create-machine --name myvm --network --cpus 2 --mem 1024
connect-smol-machines start-machine --name myvm
connect-smol-machines exec-machine --name myvm --command '["echo","hello"]'
connect-smol-machines stop-machine --name myvm
connect-smol-machines delete-machine --name myvm
connect-smol-machines raw-request --path /machines --method GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SMOL_MACHINES_API_KEY` | API key for hosted API (optional) |
| `SMOL_MACHINES_BASE_URL` | API base URL (default: `https://api.smolmachines.com/v1`) |

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
