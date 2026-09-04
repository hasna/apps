---
"@hasna/todos": patch
---

Remove the bundled web dashboard (Vite/React/shadcn SPA at `dashboard/`): the tree, the `dashboard` workspace + `files` entry, the `build:dashboard` script, the dashboard step in `build`, the Dockerfile/.dockerignore references, the CI dashboard job, and the server's static-file serving (`resolveDashboardDir`/`serveStaticFile`/SPA fallback) with unknown non-API routes now always 404 JSON. The server startup browser auto-open and the `--no-open` flag / `TODOS_NO_OPEN` env are gone; the headless-boundary manifest drops the dead `local_dashboard` optional surface. REST API, MCP HTTP, OAuth-adjacent auth postures, the CLI, and the SDK are unchanged — `todos serve` / `todos-serve` still serve /api/* and /mcp.