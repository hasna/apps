# CLAUDE.md

Guidance for Claude Code when working with connect-visibl-semiconductors.

## Project Overview

TypeScript connector for the Visibl Semiconductors REST API. Provides chip design coordination: projects, drift cases, fix proposals, design context sync, CI signals, and tapeout readiness.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token (API key). Set via:

- `VISIBL_SEMICONDUCTORS_API_KEY` environment variable
- `connect-visibl-semiconductors config set-key <key>`
- Profile config at `~/.hasna/connectors/connect-visibl-semiconductors/`

Optional `VISIBL_SEMICONDUCTORS_BASE_URL` or profile `baseUrl` overrides the default `https://api.visiblsemi.com/v1`.

## API Endpoints

| Method | Path | CLI command |
|--------|------|-------------|
| GET | `/projects` | `list-projects` |
| GET | `/projects/{projectId}` | `get-project` |
| GET | `/drift-cases` | `list-drift-cases` |
| GET | `/drift-cases/{caseId}` | `get-drift-case` |
| GET | `/drift-cases/{caseId}/proposals` | `list-fix-proposals` |
| POST | `/proposals/{proposalId}/approve` | `approve-fix-proposal` |
| POST | `/projects/{projectId}/design-context/sync` | `sync-design-context` |
| GET | `/ci-signals` | `list-ci-signals` |
| GET | `/projects/{projectId}/tapeout-readiness` | `get-tapeout-readiness` |

Use `raw-request` for passthrough access.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VISIBL_SEMICONDUCTORS_API_KEY` | API key (required) |
| `VISIBL_SEMICONDUCTORS_BASE_URL` | Optional base URL override |

## Data Storage

```
~/.hasna/connectors/connect-visibl-semiconductors/
├── current_profile
└── profiles/
    └── default.json
```
