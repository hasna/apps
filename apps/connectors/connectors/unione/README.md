# @hasna/connect-unione

TypeScript connector for the [UniOne](https://unione.io/) transactional email API.

## Features

- Send transactional emails
- Subscribe contacts to lists
- Validate email addresses
- Manage email templates
- List webhooks and projects
- Multi-profile API key configuration

## Quick Start

```bash
bun install
export UNIONE_API_KEY=your-api-key
bun run dev list-projects
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `send-email` | Send a transactional email (`--body` or `--body-file`) |
| `subscribe-email` | Subscribe an email to a list |
| `validate-email` | Validate a single email address |
| `set-template` | Create or update a template |
| `get-template` | Get a template by ID |
| `list-templates` | List templates |
| `list-webhooks` | List webhooks |
| `list-projects` | List projects |

## Library Usage

```typescript
import { UniOne } from '@hasna/connect-unione';

const client = new UniOne({ apiKey: process.env.UNIONE_API_KEY! });
const projects = await client.listProjects();
```

## Documentation

- [UniOne Web API Reference](https://docs.unione.io/en/web-api-ref)

## License

Apache-2.0
