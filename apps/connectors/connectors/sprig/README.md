# @hasna/connect-sprig

TypeScript connector for the [Sprig](https://sprig.com) product research API.

## Features

- User management (v2): get user, upsert user, purge visitors
- Survey export (v1): list surveys, responses, and themes
- Dual auth modes: `API-Key` for v2 user import APIs, `Bearer` for purge and v1 export APIs
- Multi-profile configuration with `SPRIG_API_KEY` override
- CLI with JSON and pretty output formats

## Installation

```bash
bun install
bun run build
```

## Configuration

```bash
connect-sprig config set-key <your-api-key>
# or
export SPRIG_API_KEY=your-api-key
```

Profiles are stored in `~/.hasna/connectors/connect-sprig/profiles/`.

## CLI Usage

```bash
# Users (v2)
connect-sprig users get <userId>
connect-sprig users upsert --user-id <id> --email user@example.com

# Purge visitors (v2)
connect-sprig purge visitors --emails a@example.com,b@example.com

# Surveys / responses / themes (v1)
connect-sprig surveys list --limit 50 --status COMPLETED,IN_PROGRESS
connect-sprig responses list --sid 12 --limit 100
connect-sprig themes list --start 1704067200000
```

## API Reference

Base URL: `https://api.sprig.com`

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /v2/users/{userId}` | API-Key | Retrieve a user |
| `POST /v2/users` | API-Key | Upsert user (202 Accepted) |
| `POST /v2/purge/visitors` | Bearer | Purge visitor data |
| `GET /v1/surveys` | Bearer | List surveys/studies |
| `GET /v1/responses` | Bearer | List responses |
| `GET /v1/themes` | Bearer | List themes |

## Development

```bash
bun run dev config show
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
