# @hasna/connect-streak

TypeScript connector for the [Streak CRM API](https://streak.readme.io/) — pipelines, boxes, stages, custom fields, tasks, comments, threads, reminders, files, teams, and search.

## Install

```bash
bun add @hasna/connect-streak
```

## Authentication

Set your Streak API key (from the Streak settings page):

```bash
export STREAK_API_KEY=your-api-key
# or
connect-streak config set-key your-api-key
```

Streak uses HTTP Basic authentication: `Authorization: Basic base64(apiKey:)`.

## CLI

```bash
connect-streak list-pipelines
connect-streak get-current-user
connect-streak search --query "acme"
connect-streak create-box --pipeline-key PIPELINE_KEY --name "New deal"
```

Run `connect-streak --help` for all 30 commands.

## Library

```typescript
import { Connector } from '@hasna/connect-streak';

const streak = new Connector({ apiKey: process.env.STREAK_API_KEY! });
const pipelines = await streak.pipelines.list();
const me = await streak.users.me();
```

## License

Apache-2.0
