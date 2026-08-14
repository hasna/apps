# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-stoplight-api-platform is a TypeScript connector for the Stoplight API
(https://stoplight.io/api). Stoplight is an API design, documentation, and
governance platform. This connector provides CLI and library access to
workspaces, projects, branches, members, access groups, and documentation nodes
(OpenAPI files, JSON Schema models, and Markdown articles).

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck

# Run tests
bun test

# Run specific commands
bun run dev config show
bun run dev workspace projects <workspaceId>
bun run dev project get <projectId>
bun run dev project toc <projectId>
bun run dev node get <workspaceSlug> <projectSlug> --uri /reference/api.yaml
```

## Authentication

Stoplight uses **workspace tokens** (read-only) or **personal access tokens**.
The token is sent verbatim in the `Authorization` header — there is **no
`Bearer` prefix** (the API rejects a `Bearer <token>` value as "Missing
authorization"). Set it via `STOPLIGHT_API_TOKEN` or `config set-token`.

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client (Authorization: <token>, no Bearer)
│   ├── client.test.ts  # Client unit tests
│   └── index.ts        # Stoplight API wrapper class
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # Type definitions
├── utils/
│   ├── config.ts       # Multi-profile configuration
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## API Coverage

### Workspaces
- List projects in a workspace
- List access groups in a workspace

### Projects
- Get a project
- List branches
- List members
- Get the table of contents

### Nodes
- Read a node (OpenAPI / model / markdown) by URI
- Export a bundled (dereferenced) node

A generic `request()` escape hatch is available on the wrapper and client for
endpoints not modeled here.
