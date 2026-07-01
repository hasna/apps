# Open Changelog

Reusable changelog collection, generation, and publishing for Hasna-coded apps.

Open Changelog stores entries locally as JSONL, exposes the same model through an SDK, HTTP API, CLI, and MCP tools, and generates Keep a Changelog style Markdown. Publishing to a target `CHANGELOG.md` is dry-run by default and writes only when explicitly requested.

## Install

```bash
bun add @hasna/changelog
```

CLI binaries:

```bash
changelog --help
changelog-mcp --help
changelog-serve --help
```

Local data defaults to `~/.hasna/changelog`. Override it with `CHANGELOG_DATA_DIR`.

## CLI

```bash
changelog init

changelog add "Initial changelog scaffold" \
  --app open-changelog \
  --version 0.1.0 \
  --kind added \
  --task 731aace9

changelog list --app open-changelog
changelog show <entry-id>
changelog update <entry-id> --kind fixed --message "Tighten publish safety"
changelog generate --app open-changelog --version 0.1.0 --kind added --title "Open Changelog Notes"
changelog export --app open-changelog --format jsonl

changelog publish --app open-changelog --dry-run
changelog publish --app open-changelog --write --target CHANGELOG.md --title "Open Changelog Notes"
```

`publish` prints a Markdown preview by default. It writes only with `--write`.

Remote CLI commands use `CHANGELOG_API_TOKEN` from the environment when `--api-url` is supplied.

## SDK

```ts
import { LocalChangelogStore, generateChangelogMarkdown, publishChangelog } from "@hasna/changelog";

const store = new LocalChangelogStore();

await store.createEntry({
  appId: "my-app",
  version: "1.2.0",
  kind: "fixed",
  title: "Fix duplicate release notes",
  tasks: ["APP-123"],
});

const entries = await store.listEntries({ appId: "my-app", version: "1.2.0" });
const markdown = generateChangelogMarkdown(entries, { appId: "my-app" });

await publishChangelog({ store, appId: "my-app" }); // dry run
await publishChangelog({ store, appId: "my-app", write: true });
```

Remote API client:

```ts
import { createChangelogClient } from "@hasna/changelog";

const changelog = createChangelogClient({
  baseUrl: "http://127.0.0.1:8788",
  token: process.env.CHANGELOG_API_TOKEN,
});

await changelog.add({
  appId: "my-app",
  version: "1.2.0",
  kind: "added",
  title: "Add export command",
});
```

## HTTP API

Start the server:

```bash
CHANGELOG_HOST=127.0.0.1 CHANGELOG_PORT=8788 changelog-serve
```

If `CHANGELOG_API_TOKEN` is set, API requests must include `Authorization: Bearer <token>` or `x-changelog-token: <token>`.

API publish write mode requires `CHANGELOG_API_TOKEN` to be configured and supplied. Dry-run publish remains available without a token for local development.

Endpoints:

- `GET /health`
- `POST /v1/entries`
- `GET /v1/entries?appId=my-app&version=1.2.0&kind=added`
- `GET /v1/entries/:id`
- `PATCH /v1/entries/:id`
- `GET /v1/generate?appId=my-app`
- `POST /v1/generate`
- `POST /v1/publish`
- `GET /v1/stats`
- `GET /v1/export.jsonl`

Example:

```bash
curl -X POST http://127.0.0.1:8788/v1/entries \
  -H 'content-type: application/json' \
  -d '{"appId":"my-app","version":"1.2.0","kind":"fixed","title":"Fix changelog publishing"}'
```

Publish dry-run:

```bash
curl -X POST http://127.0.0.1:8788/v1/publish \
  -H 'content-type: application/json' \
  -d '{"appId":"my-app","targetPath":"CHANGELOG.md"}'
```

Write mode:

```bash
curl -X POST http://127.0.0.1:8788/v1/publish \
  -H "authorization: Bearer $CHANGELOG_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"appId":"my-app","targetPath":"CHANGELOG.md","write":true}'
```

## MCP

Run the MCP server over stdio:

```bash
changelog-mcp
```

Tools:

- `add_changelog_entry`
- `list_changelog_entries`
- `get_changelog_entry`
- `update_changelog_entry`
- `generate_changelog`
- `publish_changelog`
- `changelog_stats`
- `export_changelog_jsonl`

`publish_changelog` is dry-run unless its `write` argument is `true`.

## Entry Model

Each stored JSONL entry includes:

- `appId`
- `version`
- `kind` and `category`
- `title`, `message`, `details`, and `body`
- `date`
- `author` and `source`
- `tags`, `links`, `commits`, and `tasks`
- `metadata`
- `id`, `createdAt`, and `updatedAt`

Text fields and metadata are redacted for obvious secret-shaped values before storage.

## Environment

- `CHANGELOG_DATA_DIR`: local JSONL data directory
- `CHANGELOG_API_TOKEN`: optional HTTP API bearer token
- `CHANGELOG_HOST`: server bind host
- `CHANGELOG_PORT`: server bind port
