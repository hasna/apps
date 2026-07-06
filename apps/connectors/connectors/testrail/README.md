# TestRail Connector

TypeScript connector for the [TestRail API](https://www.gurock.com/testrail/docs/api) — test case, run, plan, milestone, and result management.

## Authentication

TestRail uses **HTTP Basic authentication** with your account email and an API key (generate under My Settings → API Keys).

## Quick Start

```bash
cd connectors/testrail
bun install
bun run dev config setup \
  --email you@example.com \
  --api-key your-api-key \
  --base-url https://yourcompany.testrail.io
bun run dev project list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTRAIL_EMAIL` | Account email |
| `TESTRAIL_API_KEY` | API key |
| `TESTRAIL_BASE_URL` | Instance URL (cloud or self-hosted) |

## CLI Commands

```bash
connect-testrail profile list
connect-testrail config show
connect-testrail project list
connect-testrail case list <projectId>
connect-testrail case get <caseId>
connect-testrail run list <projectId>
connect-testrail run results <runId>
```

## Library Usage

```typescript
import { TestRail } from '@hasna/connect-testrail';

const tr = TestRail.fromEnv();
const projects = await tr.listProjects();
const testCase = await tr.getCase(123);
```

## Development

```bash
bun run typecheck
bun test
bun run build
```
