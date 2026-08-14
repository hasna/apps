# connect-voquill

TypeScript connector for the [Voquill](https://voquill.com/) pathology report API.

## Overview

Voquill is an AI pathology report coworker. This connector provides Bearer token authentication, multi-profile configuration, and CLI access to cases, reports, templates, snippets, and CPT suggestions.

- API base URL: `https://api.voquill.com/v1`
- Docs: https://docs.voquill.com/

## Quick start

```bash
bun install
export VOQUILL_API_KEY=your-api-key
bun run dev cases list
```

## CLI commands

| Command | Description |
|---------|-------------|
| `cases list` | List pathology cases |
| `cases get <caseId>` | Get a case |
| `cases create --body '<json>'` | Create a case |
| `reports create-draft <caseId>` | Create a report draft |
| `reports get <reportId>` | Get a report |
| `cpt suggest <caseId>` | Suggest CPT codes |
| `templates list` | List templates |
| `templates get <templateId>` | Get a template |
| `snippets list` | List snippets |
| `snippets upsert` | Create or update a snippet |
| `raw --path <path>` | Raw API request |

## Environment variables

| Variable | Description |
|----------|-------------|
| `VOQUILL_API_KEY` | API key (Bearer token) |
| `VOQUILL_BASE_URL` | Optional API base URL override |

## License

Apache-2.0
