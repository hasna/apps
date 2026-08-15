# Economy dashboard

The dashboard is the React/Vite UI served by `economy-serve`. It covers overview, sessions, models, projects, budgets, goals, usage, accounts, savings, fleet, reconciliation, pricing, and provider billing.

## Development

Run the API from the repository root, then start Vite:

```bash
economy-serve --port 3456
cd dashboard
bun install
bun run dev
```

The development build uses `http://localhost:3456` by default. Set `VITE_API_URL` at build/dev time to use another origin. The dashboard currently calls the server's legacy-compatible `/api` routes; the public canonical API is `/v1`.

## Validation

```bash
bun test
bun run lint
bun run build
```

The root package build writes production assets to `dashboard/dist`; `economy-serve` serves those assets and provides SPA fallback routing.
