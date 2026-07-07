# @hasna/connect-stackexchange

Stack Exchange Q&A search and retrieval connector CLI. Query questions, answers,
users, and tags across any Stack Exchange site (Stack Overflow, Super User,
Server Fault, Ask Ubuntu, …) via the public [Stack Exchange API v2.3](https://api.stackexchange.com/docs).

## Features

- Search and list questions (full-text via `/search/advanced`)
- Fetch questions/users by id, and answers for a question
- List answers, users, and tags with sorting and pagination
- Pretty and JSON output formats
- Reports remaining API quota after each request
- No authentication required for read endpoints; an app key raises the quota

## Install

```bash
bun install
bun run build
```

## Usage

```bash
# Search Stack Overflow
bun run dev search "async await deadlock" --tagged csharp

# Newest questions on Super User
bun run dev --site superuser questions --sort creation

# Answers for a specific question
bun run dev question-answers 11227809

# Top users and popular tags
bun run dev users --sort reputation
bun run dev tags --name type

# JSON output
bun run dev --format json search "generics" --title "type inference"
```

## Configuration

All read endpoints are keyless. To raise your daily request quota, register an
app at [Stack Apps](https://stackapps.com/apps/oauth/register) and set the key
via an environment variable (see [`.env.example`](./.env.example)):

| Variable | Description |
|----------|-------------|
| `STACKEXCHANGE_KEY` | App key for a higher request quota (optional) |
| `STACKEXCHANGE_ACCESS_TOKEN` | OAuth access token for authenticated endpoints (optional) |
| `STACKEXCHANGE_SITE` | Default site slug (default: `stackoverflow`) |

Local defaults (site, page size) can also be stored with `connect-stackexchange config`.
Credentials are read from environment variables only, so secrets never need to be
written to local config.

## Library usage

```ts
import { StackExchange } from '@hasna/connect-stackexchange';

const se = StackExchange.fromEnv({ site: 'stackoverflow' });
const { items } = await se.searchQuestions({ query: 'memoization', tagged: ['javascript'] });
console.log(items.map((q) => q.title));
```

## License

Apache-2.0
