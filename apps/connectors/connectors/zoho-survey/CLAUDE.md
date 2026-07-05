# CLAUDE.md

Zoho Survey connector for the private REST API at `https://survey.zoho.com/survey/api/v1/private`.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

OAuth 2.0 via Zoho Accounts (`accounts.zoho.com`). Scopes: `ZohoSurvey.survey.READ,ZohoSurvey.survey.CREATE`.

API requests use `Authorization: Zoho-oauthtoken <token>`.

## Required Config

- `portalId` — Zoho Survey portal identifier
- `departmentId` — department/group unique id within the portal
- OAuth access token (via `auth login` or `ZOHO_SURVEY_TOKEN`)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_SURVEY_TOKEN` | OAuth access token |
| `ZOHO_SURVEY_PORTAL_ID` | Portal ID |
| `ZOHO_SURVEY_DEPARTMENT_ID` | Department/group ID |
| `ZOHO_SURVEY_BASE_URL` | Override API base for EU/IN datacenters |

Profiles stored in `~/.hasna/connectors/zoho-survey/profiles/`.

## API Surface

- `listPortals`, `listSurveys`, `getSurvey`
- `listResponses`, `getResponse`
- `listCollectors`, `listTriggerDistributions`, `triggerInvitation`
