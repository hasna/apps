# connect-smile-io — Agent Notes

Smile.io loyalty & rewards connector. TypeScript client + Commander CLI targeting the
public Smile.io REST API at `https://api.smile.io/v1`.

## Authentication

- Private API key sent as `Authorization: Bearer <apiKey>` (see `src/api/client.ts`).
- Resolution order (`src/utils/config.ts`): `SMILEIO_API_KEY` env var, then the active
  profile's stored `apiKey`. Optional `SMILEIO_BASE_URL` overrides the base URL.
- Profiles live under `~/.hasna/connectors/connect-smile-io/`. No secrets are committed;
  `.env.example` contains placeholders only.

## Layout

- `src/api/client.ts` — `SmileClient`: URL/query building, Bearer auth, JSON bodies,
  204 handling, and `SmileApiError` extraction from `{ error | message | errors }`.
- `src/api/*.ts` — one class per resource group (customers, customerIdentities,
  pointsTransactions, pointsProducts, activities, earningRules, vipTiers,
  pointsSettings, rewardFulfillments). `src/api/index.ts` wires them onto `Smile`.
- `src/types/index.ts` — config, entity, list-wrapper, and error types.
- `src/utils/config.ts` — profile + credential management. `src/utils/output.ts` —
  json/table/pretty formatting.
- `src/cli/index.ts` — Commander CLI (`connect-smile-io`).
- `src/api/client.test.ts` — transport tests via a mocked `globalThis.fetch`.

## API notes

- Paths use underscores: `/points_transactions`, `/points_products`,
  `/points_settings`, `/customer_identities/create_or_update`.
- List endpoints wrap results (`{ customers: [...], metadata: { next_cursor } }`).
  Customers / points transactions / earning rules / reward fulfillments use cursor
  pagination; points products use `page`/`page_size`; VIP tiers & points settings
  are unpaginated.
- Create endpoints wrap the body: `points_transactions` takes flat fields,
  `activities` wraps in `{ activity: {...} }`, identities in `{ customer_identity: {...} }`.

## Commands

```bash
bun run typecheck
bun test
bun run build
bun run dev -- <command>
```
