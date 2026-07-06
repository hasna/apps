# connect-toast-pos

TypeScript connector and CLI for the [Toast Tab](https://doc.toasttab.com) restaurant platform APIs.

## Features

- OAuth2 machine client authentication (`TOAST_MACHINE_CLIENT`)
- Restaurant configuration, menus, and orders APIs
- Multi-profile configuration
- Raw request escape hatch for additional endpoints

## Quick Start

```bash
cd connectors/toast-pos
bun install

# Configure credentials
bun run dev config set-credentials <clientId> <clientSecret> --restaurant <restaurant-guid>
bun run dev auth login

# API commands
bun run dev restaurant get <restaurant-guid>
bun run dev menu list
bun run dev order get <order-guid>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOAST_CLIENT_ID` | Toast API client ID |
| `TOAST_CLIENT_SECRET` | Toast API client secret |
| `TOAST_RESTAURANT_EXTERNAL_ID` | Restaurant location GUID |
| `TOAST_BASE_URL` | Optional API hostname (default: `https://ws-api.toasttab.com`) |

## Documentation

- Toast developer docs: https://doc.toasttab.com
- Authentication: https://doc.toasttab.com/doc/devguide/authentication.html

## License

Apache-2.0
