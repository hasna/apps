# connect-voxel-energy

TypeScript connector for the [Voxel Energy](https://voxelenergy.com) REST API — off-grid data center power, sites, capacity, and GPU reservations.

## Features

- Multi-profile configuration
- Bearer token (API key) authentication
- Sites, reservations, and raw API access
- Pretty and JSON output formats

## Quick Start

```bash
bun install
export VOXEL_ENERGY_API_KEY=your-api-key
bun run dev sites list
```

Or configure a profile:

```bash
bun run dev config set-key your-api-key
bun run dev sites list
```

## CLI

```bash
connect-voxel-energy sites list
connect-voxel-energy sites get "site-id"
connect-voxel-energy sites power-profile "site-id"
connect-voxel-energy sites capacity "site-id"
connect-voxel-energy reservations list
connect-voxel-energy reservations create -b '{"siteId":"site-1","gpuCount":256}'
connect-voxel-energy reservations get "reservation-id"
connect-voxel-energy raw -p /custom/path -m POST -b '{"enabled":true}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOXEL_ENERGY_API_KEY` | API key |
| `VOXEL_ENERGY_BASE_URL` | Optional base URL override |

## License

Apache-2.0
