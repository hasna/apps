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

changelog add "Initial changelog scaffold" --kind added --task 731aace9

changelog list --app open-changelog
changelog show <entry-id>
changelog update <entry-id> --kind fixed --message "Tighten publish safety"
changelog release --version 0.1.0
changelog generate --app open-changelog --version 0.1.0 --kind added --title "Open Changelog Notes"
changelog export --app open-changelog --format jsonl

changelog publish --app open-changelog --dry-run --diff
changelog publish --app open-changelog --write --target CHANGELOG.md --title "Open Changelog Notes"
```

`publish` prints a Markdown preview by default. It writes only with `--write`.
When writing over an existing file, the previous file is backed up under `~/.hasna/changelog/backups` unless `--no-backup` is supplied.

Remote CLI commands use `CHANGELOG_API_TOKEN` from the environment when `--api-url` is supplied.

When `--app` is omitted for `add`, `generate`, `release`, or `publish`, the CLI infers an app id from the local `package.json` name.

App ids are normalized to the `hasna.app.v1` AppId slug used as the join key
across the Hasna distribution contracts: `@hasna/todos` maps to the
`open-todos` repo-folder convention, and other names are slugified
(lowercase, dash-separated).

### Release publishing (open-releases entrypoint)

`changelog publish --release` is the entrypoint invoked by open-releases when
a version ships: it accepts an appId and version, promotes that app's pending
entries, regenerates the changelog file, and prints a JSON result containing a
`changelogRef` resource pointer (`kind: "document"`,
`id: changelog:<appId>@<version>`) that the caller embeds in its
`hasna.release.v1` document.

```bash
changelog publish --release --app open-todos --version 1.2.3
changelog publish --release --app @hasna/todos --version 1.2.3 \
  --target CHANGELOG.md --base-url https://changelog.hasna.com
```

Programmatic consumers can call `publishRelease` from
`@hasna/changelog/release`. Promoting zero entries is legal — deferred
changelog refs are allowed by the release contract, and the ref still
resolves once entries land.

### Static web changelog site

`changelog web` renders a static site with one page per app plus RSS 2.0 and
JSON Feed 1.1 feeds (`apps/<appId>/index.html`, `apps/<appId>/rss.xml`,
`apps/<appId>/feed.json`, a directory `index.html`, and a machine-readable
`site.json`).

```bash
changelog web --out ./public --base-url https://changelog.hasna.com
changelog web --out ./public --app open-todos --title "open-todos releases"
```

The generator is also exported as `generateChangelogSite` from
`@hasna/changelog/web`. Pass `--base-url` when publishing: feed
`link`/`home_page_url`/`feed_url` fields require absolute URLs and are
omitted when no base URL is configured.

## SDK

```ts
import { LocalChangelogStore, generateChangelogMarkdown, publishChangelog } from "@hasna/changelog";

const store = new LocalChangelogStore();

await store.createEntry({
  appId: "my-app",
  kind: "fixed",
  title: "Fix duplicate release notes",
  tasks: ["APP-123"],
});

await store.releaseEntries({ appId: "my-app", version: "1.2.0" });

const entries = await store.listEntries({ appId: "my-app", version: "1.2.0" });
const markdown = generateChangelogMarkdown(entries, { appId: "my-app" });

await publishChangelog({ store, appId: "my-app", diff: true }); // dry run
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
- `POST /v1/release`
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
- `release_changelog`
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
Duplicate entries are rejected by default using a stable fingerprint derived from app, version, kind, title, tasks, and commits. Pass the explicit duplicate override when a repeated entry is intentional.

## Environment

- `CHANGELOG_DATA_DIR`: local JSONL data directory
- `CHANGELOG_API_TOKEN`: optional HTTP API bearer token
- `CHANGELOG_HOST`: server bind host
- `CHANGELOG_PORT`: server bind port
