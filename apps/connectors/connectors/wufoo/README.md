# @hasna/connect-wufoo

TypeScript connector for the [Wufoo API v3](https://wufoo.github.io/docs/) — forms, entries, reports, webhooks, and users.

## Installation

```bash
bun install
```

## Configuration

Set credentials via environment variables or CLI profiles:

```bash
export WUFOO_API_KEY=your-api-key
export WUFOO_SUBDOMAIN=your-subdomain

# or
connect-wufoo config set --api-key your-api-key --subdomain your-subdomain
```

Find your API key and subdomain under **Form Manager → More → API Information**.

## Usage

```bash
# Development
bun run dev forms list
bun run dev entries list <formId>
bun run dev entries submit <formId> --field Field1=Hello --field Field2=World
bun run dev reports list
bun run dev webhooks add <formId> --url https://example.com/hook --metadata
bun run dev users list
```

## API Modules

| Module | Endpoints |
|--------|-----------|
| `forms` | list, get, fields, comments, comments-count |
| `entries` | list, count, submit |
| `reports` | list, get, entries, entries-count, fields, widgets |
| `webhooks` | add (PUT), delete |
| `users` | list |

## Authentication

Wufoo uses HTTP Basic auth with the API key as username and any password value.

## Scripts

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
