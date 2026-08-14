# connect-write-binary-file

TypeScript connector and CLI for the [Write Binary File](https://api.write-binary-file.com) REST API.

## Features

- Multi-profile API key configuration
- Bearer token authentication
- Files, events, search, and raw request commands
- JSON and pretty output formats

## Quick Start

```bash
bun install
bun run dev config set-key <your-api-key>
bun run dev files list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WRITE_BINARY_FILE_API_KEY` | API key (overrides profile) |
| `WRITE_BINARY_FILE_BASE_URL` | Override base URL |

## CLI Commands

```bash
connect-write-binary-file profile list|use|create|delete|show
connect-write-binary-file config set-key|show|clear
connect-write-binary-file files list|create|get
connect-write-binary-file events list
connect-write-binary-file search --body '<json>'
connect-write-binary-file raw-request --path /files --method GET
```

## License

Apache-2.0
