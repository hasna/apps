# @hasna/connect-testerarmy

TypeScript connector for the [TesterArmy](https://tester.army) API — agent-first QA automation for projects, tests, groups, runs, and webhooks.

## Install

```bash
bun install
```

## Configure

```bash
export TESTERARMY_API_KEY=your-api-key
# optional
export TESTERARMY_BASE_URL=https://tester.army

# or via profile
bun run dev config set-key <api-key>
bun run dev config set-base-url https://tester.army
```

Get API keys from [docs.tester.army/auth/api-keys](https://docs.tester.army/auth/api-keys).

## Usage

```bash
# Development CLI
bun run dev projects list
bun run dev tests list
bun run dev groups list
bun run dev runs list
bun run dev raw-request --path /v1/projects

# Library
import { TesterArmy } from '@hasna/connect-testerarmy';

const client = TesterArmy.fromEnv();
const projects = await client.projects.list();
```

## Commands

| Area | Examples |
|------|----------|
| Projects | `projects list`, `projects create --data '{"name":"demo"}'`, `projects get <id>` |
| Tests | `tests list`, `tests create`, `tests trigger-run <testId>` |
| Groups | `groups list`, `groups add-test <groupId> --data '{"testId":"..."}'` |
| Runs | `runs list`, `runs get <runId>`, `runs cancel <runId>` |
| Webhooks | `webhooks trigger-project <webhookId> <secret>` (no API key) |
| Raw | `raw-request --path /v1/projects --method GET` |

## Build

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
