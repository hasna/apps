---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Project Structure

This is a **connector** project for Zendesk that follows the Beep Media connector pattern:

```
connect-zendesk/
├── src/
│   ├── api/           # API client modules
│   │   ├── client.ts  # Base HTTP client
│   │   ├── index.ts   # Main connector class
│   │   └── *.ts       # Resource-specific APIs
│   ├── cli/           # CLI commands
│   │   └── index.ts   # Commander-based CLI
│   ├── types/         # TypeScript types
│   │   └── index.ts   # All type definitions
│   ├── utils/         # Utilities
│   │   ├── config.ts  # CLI configuration storage
│   │   └── output.ts  # Output formatting
│   └── index.ts       # SDK entry point
├── package.json
└── tsconfig.json
```

## Infrastructure

- **CLI Name**: `connect-zendesk`
- **EC2 Instance**: `hasna-prod-connect-zendesk`
- **RDS Database**: `hasna-prod-connect-zendesk`
- **S3 Bucket**: `hasna-prod-connect-zendesk`
- **Remote API**: deployment-specific; set `ZENDESK_REMOTE_API_URL` (no shipped default)

## Key Patterns

1. **API Client**: All API calls go through `ZendeskClient` which handles auth and request formatting
2. **Resource APIs**: Each resource type gets its own API class (e.g., `UsersApi`, `OrdersApi`)
3. **CLI Commands**: Commander-based with subcommands for each resource
4. **Configuration**: Stored in `~/.hasna/connectors/connect-zendesk/config.json`
5. **Environment Variables**: `ZENDESK_API_KEY` for API authentication

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
