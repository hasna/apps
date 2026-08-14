# CLAUDE.md

Guidance for working with the TestRail connector.

## Project Overview

`@hasna/connect-testrail` is a TypeScript connector for the TestRail REST API v2. It provides multi-profile configuration, HTTP Basic authentication (email + API key), and a Commander.js CLI.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

TestRail uses **HTTP Basic authentication** with email and API key:

```typescript
'Authorization': 'Basic ' + base64(email:apiKey)
```

API base URL format: `https://{instance}.testrail.io/index.php?/api/v2/{method}`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTRAIL_EMAIL` | Account email |
| `TESTRAIL_API_KEY` | API key |
| `TESTRAIL_BASE_URL` | Full instance URL (supports self-hosted) |

## Data Storage

Profiles stored in `~/.hasna/connectors/connect-testrail/profiles/`.

Profile JSON:

```json
{
  "email": "user@example.com",
  "apiKey": "your-api-key",
  "baseUrl": "https://yourcompany.testrail.io"
}
```

## API Coverage

- Projects: `get_projects`, `get_project`
- Cases: `get_cases`, `get_case`, `add_case`, `update_case`
- Runs: `get_runs`, `get_run`, `add_run`
- Results: `get_results_for_run`, `add_result_for_case`
- Plans: `get_plans`, `get_plan`
- Milestones: `get_milestones`, `get_milestone`
- `rawRequest()` for unwrapped endpoints
