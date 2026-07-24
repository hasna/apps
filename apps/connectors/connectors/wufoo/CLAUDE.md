# CLAUDE.md

Guidance for working with the Wufoo connector (`@hasna/connect-wufoo`).

## Overview

TypeScript CLI and library for the Wufoo REST API v3. Supports forms, entries, reports, webhooks, and users with HTTP Basic authentication.

- **Base URL**: `https://{subdomain}.wufoo.com/api/v3`
- **Auth**: HTTP Basic — username = API key, password = any value
- **Docs**: https://wufoo.github.io/docs/

## Commands

```bash
bun install
bun run dev              # CLI from source
bun run typecheck
bun test
bun run build
```

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client (Basic auth, retry, form encoding)
│   ├── forms.ts       # Forms, fields, comments
│   ├── entries.ts     # List/count/submit entries
│   ├── reports.ts     # Reports, widgets
│   ├── webhooks.ts    # PUT/DELETE webhooks
│   ├── users.ts       # Account users
│   └── index.ts       # Wufoo connector class
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Wufoo response types
└── utils/
    ├── config.ts      # Multi-profile config (apiKey + subdomain)
    └── output.ts      # CLI formatting
```

## Key Patterns

### Subdomain + API Key

Both are required. Profiles store `apiKey` and `subdomain` at `~/.hasna/connectors/connect-wufoo/profiles/`.

Environment variables: `WUFOO_API_KEY`, `WUFOO_SUBDOMAIN`, optional `WUFOO_BASE_URL`.

### Form-Encoded POST/PUT

Entry submission and webhook creation use `application/x-www-form-urlencoded`, not JSON. Use `client.postForm()` / `client.putForm()`.

### Resource Identifiers

Forms and reports accept hash or title identifiers. Title IDs may contain `/` — use `encodeResourceId()` when building paths.

### Entry Filters

Entry list/count endpoints support `Filter1`..`FilterN` query params via `EntryListParams.filters`.

## CLI Examples

```bash
connect-wufoo forms list --include-today-count
connect-wufoo forms get wufoo-api-example
connect-wufoo entries list s1afea8b1vk0jf7 --sort EntryId --sort-direction DESC
connect-wufoo entries submit s1afea8b1vk0jf7 --field Field1=Wufoo --field Field2=Test
connect-wufoo webhooks add s1afea8b1vk0jf7 --url https://example.com/hook --metadata
connect-wufoo users list
```

## Dependencies

- commander — CLI framework
- chalk — terminal styling
