# CLAUDE.md — connect-stampedio

Connector for the [Stamped.io](https://developers.stamped.io/) reviews & loyalty API.

## Layout

- `src/api/client.ts` — HTTP transport. Basic Auth (`publicKey:privateKey`) for
  merchant endpoints under `/v2/{storeHash}/...`; unauthenticated `publicRequest`
  for `/widget/...` endpoints that take `apiKey` + `storeUrl` query params.
- `src/api/reviews.ts`, `customers.ts`, `loyalty.ts` — resource modules.
- `src/api/index.ts` — `Stampedio` facade (`reviews`, `customers`, `loyalty`) plus
  `Stampedio.fromEnv()`.
- `src/utils/config.ts` — profile-based credential storage under
  `~/.hasna/connectors/connect-stampedio/`. Env vars win over stored profile values.
- `src/utils/output.ts` — `json` / `table` / `pretty` formatting.
- `src/cli/index.ts` — commander CLI (`config`, `profile`, `reviews`, `customers`,
  `loyalty`, `whoami`).
- `src/api/client.test.ts` — transport tests stubbing `globalThis.fetch`.

## API facts

- Base URL: `https://stamped.io/api`.
- Auth: HTTP Basic Auth, public key = username, private key = password.
- v2 merchant endpoints embed `{storeHash}` in the path.
- Public widget endpoints use the public key + storefront domain, no auth header.

## Commands

```bash
bun run typecheck   # tsc --noEmit
bun test            # transport tests
bun run build       # bundle src/index.ts + src/cli/index.ts
```

Do not commit real API keys; `.env.example` is placeholder-only.
