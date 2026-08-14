# Prompts Dashboard

React dashboard for the local `@hasna/prompts` REST API.

## Run Locally

Start the API from the repository root:

```bash
bun install
bun run dev:serve
```

In another terminal, start Vite:

```bash
cd dashboard
bun install
bun run dev
```

The dashboard calls `http://localhost:19430` by default. Override the API
origin when needed:

```bash
VITE_API_URL=http://localhost:9000 bun run dev
```

The REST server enables CORS. Vite serves the dashboard separately; the
`prompts-serve` binary does not serve the dashboard bundle.

## Features

- Browse and search prompts with collection, project, template, and tag views.
- Create, edit, delete, render, copy, and inspect prompt history.
- View prompt usage statistics and switch light/dark themes.
- Select multiple prompt rows and clear the current selection.
- Use `/` to focus search, `n` to create a prompt, and `Escape` to close panels.

## Scripts

```bash
bun run dev       # Vite development server
bun run build     # TypeScript project build and production bundle
bun run lint      # ESLint
bun run preview   # Preview the production bundle
```

The root package build includes `dashboard/dist` in the published package, but
the package does not currently provide a command that hosts those static files.
