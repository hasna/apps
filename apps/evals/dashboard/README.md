# evals dashboard

React/Vite dashboard for browsing saved `@hasna/evals` runs. It reads `GET /api/runs?limit=50` and displays run summaries, result rows, assertion failures, judge reasoning, duration, cost, and Pass^k details.

## Development

`dashboard/` is a second install root, not a workspace of the repository root, so the root `bun install` does not reach it. Install both once:

```bash
bun install                    # repository root: CLI, MCP, and HTTP server deps
cd dashboard && bun install    # this directory: React, Vite, ESLint
```

Skipping the second install leaves `bun run dev` failing with `vite: command not found` and `bun run build` failing with `Cannot find module 'vite'`.

Then run the API and Vite server in separate terminals:

```bash
# Terminal 1 (repository root): JSON API on http://localhost:19440
bun run dev:serve

# Terminal 2: Vite dev server with /api proxied to port 19440
cd dashboard
bun run dev
```

Create saved data with `evals run ... --save` or `evals ci run ...`, then refresh the dashboard.

## Commands

```bash
bun run dev      # Vite development server
bun run build    # Type-check and build dashboard/dist
bun run lint     # ESLint
bun run preview  # Preview the static build
```

The root `bun run build` shells into this directory, so it needs the dashboard install above too. `evals-serve` currently serves the JSON API only; it does not serve `dashboard/dist`, so deploy or preview the static build separately with `/api` routed to `evals-serve`.
