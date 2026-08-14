# @hasna/connect-supportbee

A TypeScript/Bun connector for the [SupportBee](https://supportbee.com) shared-inbox helpdesk API.
Manage tickets, replies, internal comments, labels, agents, and canned-reply snippets from code or the CLI.

## Install

```bash
bun install
```

## Configuration

SupportBee uses a company-specific base URL and an auth token.

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPPORTBEE_API_KEY` | yes | Auth token (Settings → API Token in SupportBee) |
| `SUPPORTBEE_BASE_URL` | yes | Company URL, e.g. `https://your-company.supportbee.com` |
| `SUPPORTBEE_SUBDOMAIN` | — | Company subdomain slug (alternative to `SUPPORTBEE_BASE_URL`) |
| `SUPPORTBEE_TOKEN` | — | Alias for the auth token |

Copy `.env.example` to `.env` and fill in your values, or pass `--api-key` / `--base-url` on the CLI.

## CLI

```bash
# Tickets
connect-supportbee ticket list --per-page 25
connect-supportbee ticket get 12345
connect-supportbee ticket create --subject "Help!" --requester-email you@example.com --text "Body"
connect-supportbee ticket delete 12345

# Replies (customer-facing) and comments (internal)
connect-supportbee reply list 12345
connect-supportbee reply create 12345 --text "Thanks for reaching out"
connect-supportbee comment create 12345 --text "Internal note"

# Labels
connect-supportbee label list
connect-supportbee label add 12345 urgent
connect-supportbee label remove 12345 urgent

# Users and snippets
connect-supportbee user list
connect-supportbee snippet list
connect-supportbee snippet create --name "greeting" --text "Hi there!"
```

Use `--format json` for machine-readable output and `--profile <name>` to switch stored credentials.

## Programmatic usage

```ts
import { Connector } from '@hasna/connect-supportbee';

const supportbee = Connector.fromEnv();
// or: new Connector({ apiKey: '...', baseUrl: 'https://your-company.supportbee.com' })

const { tickets } = await supportbee.tickets.list({ per_page: 10 });
await supportbee.replies.create(tickets[0].id, { content: { text: 'On it!' } });
```

## Development

```bash
bun run typecheck
bun run build
```

## License

Apache-2.0
