# CLAUDE.md

Generic outbound HTTP webhook utility connector.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/webhooks.test.ts
```

## Authentication

Optional credentials:

- `default_url` profile field or `WEBHOOKS_DEFAULT_URL`
- `signing_secret` profile field or `WEBHOOKS_SIGNING_SECRET`

## Storage

```
~/.hasna/connectors/connect-webhooks/
├── current_profile
└── profiles/
    └── default/
        └── config.json
```

## Security

- Only `http` and `https` URLs are allowed
- Localhost, link-local, and private network targets are rejected
- Incoming webhook delivery is not implemented in OSS; `list-incoming` is documentation-only
