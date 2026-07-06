# connect-the-company-company

TypeScript connector for [The Company Company](https://www.thecompany.company/) business agent platform API.

## Features

- Bearer token authentication
- Multi-profile configuration
- Agents, tasks, integrations, memories, and events API coverage
- CLI with pretty and JSON output formats

## Quick Start

```bash
bun install
export THE_COMPANY_COMPANY_API_KEY=your-api-key-here
bun run dev -- agents list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THE_COMPANY_COMPANY_API_KEY` | API key |
| `THE_COMPANY_COMPANY_BASE_URL` | Optional API base URL (default: `https://api.thecompany.company/v1`) |

## License

Apache-2.0
