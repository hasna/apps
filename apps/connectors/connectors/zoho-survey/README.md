# @hasna/connect-zoho-survey

TypeScript connector for the Zoho Survey private REST API. Supports OAuth 2.0, multi-profile configuration, and CLI commands for surveys, responses, collectors, and email invitations.

## Setup

```bash
bun install
bun run dev config set-credentials --client-id YOUR_ID --client-secret YOUR_SECRET
bun run dev auth login
bun run dev config set-portal YOUR_PORTAL_ID
bun run dev config set-department YOUR_DEPARTMENT_ID
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_SURVEY_TOKEN` | OAuth access token |
| `ZOHO_SURVEY_PORTAL_ID` | Portal identifier |
| `ZOHO_SURVEY_DEPARTMENT_ID` | Department (group) identifier |
| `ZOHO_SURVEY_BASE_URL` | Optional datacenter-specific API base URL |

## CLI Commands

```bash
bun run dev survey list
bun run dev survey get <surveyId>
bun run dev response list <surveyId>
bun run dev collector list <surveyId>
bun run dev invitation send <surveyId> <collectorId> <distributionId> --contact '{"email":"user@example.com"}'
```

## Library Usage

```typescript
import { ZohoSurvey } from '@hasna/connect-zoho-survey';

const survey = ZohoSurvey.fromEnv();
const surveys = await survey.listSurveys();
```

## License

Apache-2.0
