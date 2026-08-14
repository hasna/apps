# CLAUDE.md

WATI WhatsApp Business API connector CLI and library.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key (Bearer) + per-tenant base URL. No global default base URL.

| Variable | Description |
|----------|-------------|
| `WATI_API_KEY` | Bearer API key |
| `WATI_BASE_URL` | Tenant endpoint (e.g. `https://live-server.wati.io/123456`) |

## Storage

```
~/.hasna/connectors/connect-wati/
├── current_profile
└── profiles/
    └── default/config.json
```

## API Modules

- contacts — getContacts, addContact, updateContactAttributes
- messages — session/template/interactive messages, getMessages, getMedia
- templates — getMessageTemplates
- operators — assign/unassign, getOperators, updateChatStatus
- labels — add/remove labels
- attributes — get/create custom attributes
- broadcasts — list/details

## Docs

https://docs.wati.io
