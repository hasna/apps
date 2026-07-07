# @hasna/connect-stablebrowse

StableBrowse API connector CLI and TypeScript client for AI browser automation, sessions, end-user credentials, and design extraction.

Rebuilt against the public StableBrowse API reference: https://docs.stablebrowse.com/api-reference/introduction

## Install

```bash
bun install
bun run build
```

## Authentication

Set an API key via environment variable or profile:

```bash
export STABLEBROWSE_API_KEY=sb_live_your_api_key_here
# optional custom base URL (defaults to https://api.stablebrowse.ai/v1)
export STABLEBROWSE_BASE_URL=https://api.stablebrowse.ai/v1

# or store it in a profile
bun run dev config set-key sb_live_your_api_key_here
```

## CLI usage

```bash
# Tasks
connect-stablebrowse tasks submit "Find the pricing page and summarize it" --end-user user-123 --start-url https://example.com
connect-stablebrowse tasks get <taskId>
connect-stablebrowse tasks list --limit 50
connect-stablebrowse tasks run "Search for AI news" --end-user user-123

# Sessions
connect-stablebrowse sessions get <sessionId>

# End-user credentials (encrypted at rest; never returned)
connect-stablebrowse credentials set user-123 --reddit-session <value>
connect-stablebrowse credentials status user-123
connect-stablebrowse credentials delete user-123

# Design extraction
connect-stablebrowse design extract https://example.com --end-user user-123 --extractors colors,fonts,logo
connect-stablebrowse design extract-one logo https://example.com --end-user user-123

# Raw escape hatch for endpoints not yet wrapped
connect-stablebrowse raw GET /tasks
```

Global flags: `-f, --format <json|table|pretty>` and `-p, --profile <name>`.

## Programmatic usage

```ts
import { StableBrowse } from "@hasna/connect-stablebrowse";

const sb = StableBrowse.fromEnv(); // reads STABLEBROWSE_API_KEY

const submitted = await sb.tasks.submit({
  endUserId: "user-123",
  task: "Find the contact email on the homepage",
  startUrl: "https://example.com",
});

const task = await sb.tasks.waitForCompletion(submitted.taskId);
console.log(task.status, task.result);

const extraction = await sb.design.extract({
  url: "https://example.com",
  endUserId: "user-123",
  extractors: ["colors", "logo"],
});
```

## API surface

| Module | Method | Endpoint |
| --- | --- | --- |
| `tasks` | `submit` | `POST /tasks` |
| `tasks` | `get` | `GET /tasks/{taskId}` |
| `tasks` | `list` | `GET /tasks` |
| `tasks` | `waitForCompletion` / `run` | polls `GET /tasks/{taskId}` |
| `sessions` | `get` | `GET /sessions/{sessionId}` |
| `endUsers` | `setCredentials` | `PUT /end-users/{endUserId}/credentials` |
| `endUsers` | `getCredentials` | `GET /end-users/{endUserId}/credentials` |
| `endUsers` | `deleteCredentials` | `DELETE /end-users/{endUserId}/credentials` |
| `design` | `extract` | `POST /design/extract` |
| `design` | `extractByExtractor` | `POST /design/extract/{extractor}` |
| `raw` | arbitrary | any path |

## Development

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
