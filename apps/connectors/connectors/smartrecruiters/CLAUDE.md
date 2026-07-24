# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-smartrecruiters is a TypeScript connector for the SmartRecruiters REST
API. It provides CLI and library access to jobs, candidates, public postings,
users, and company configuration reference data.

## Build & Run Commands

```bash
bun install
bun run dev            # run CLI from source
bun run build          # build dist/ (library) and bin/ (CLI)
bun run typecheck      # tsc --noEmit
bun test               # run the mocked-fetch test suite

bun run dev job list
bun run dev candidate list-by-job <jobId>
bun run dev config show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts          # HTTP client (X-SmartToken auth, retry, error mapping)
│   ├── jobs.ts            # Jobs API (/jobs)
│   ├── candidates.ts      # Candidates API (/candidates, /jobs/{id}/candidates)
│   ├── postings.ts        # Public Posting API (/v1/companies/{id}/postings)
│   ├── configuration.ts   # Configuration API (/configuration/*)
│   ├── users.ts           # Users API (/users)
│   ├── index.ts           # SmartRecruiters facade class + fromEnv()
│   └── smartrecruiters.test.ts
├── cli/
│   └── index.ts           # CLI commands
├── types/
│   └── index.ts           # Type definitions + SmartRecruitersApiError
├── utils/
│   ├── config.ts          # Multi-profile configuration
│   └── output.ts          # CLI output formatting
└── index.ts               # Library exports
```

## Authentication

Company API key authentication:

```
X-SmartToken: <apiKey>
```

Base URL: `https://api.smartrecruiters.com` (override with `SMARTRECRUITERS_BASE_URL`).

The public Posting API is keyed by a company identifier passed in the path
(`/v1/companies/{companyIdentifier}/postings`), supplied per-call or via
`SMARTRECRUITERS_COMPANY_ID`.

## API Coverage

- **Jobs** — list, get, status, hiring team
- **Candidates** — list, get, list by job (applications), status on a job
- **Postings** — list and get public job-board postings
- **Users** — list, get
- **Configuration** — departments, locations, functions, industries

## Environment Variables

| Variable                     | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `SMARTRECRUITERS_API_KEY`    | Company API key (SmartToken)                   |
| `SMARTRECRUITERS_COMPANY_ID` | Default company identifier for the Posting API |
| `SMARTRECRUITERS_BASE_URL`   | Override the API base URL (optional)           |

## Data Storage

```
~/.hasna/connectors/connect-smartrecruiters/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
