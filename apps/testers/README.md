# @hasna/testers

AI-powered QA testing CLI — spawns cheap AI agents to test web apps with headless browsers

[![npm](https://img.shields.io/npm/v/@hasna/testers)](https://www.npmjs.com/package/@hasna/testers)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/testers
# or
npm install -g @hasna/testers
```

## CLI Usage

```bash
testers --help
testers run https://my-preview.example.com
```

Passing a URL as the first argument will, by default, crawl the site and auto-generate scenarios if none exist for the project. Disable with `--no-auto-generate`.

### Sandbox Workflow Fanout

Saved workflows can run in E2B-backed sandboxes through `@hasna/sandboxes`. Sandbox workflow uploads default to `rsync` staging and the image-model default is `gpt-image-2`.

```bash
export E2B_API_KEY=...

testers workflow create "Projects CRUD" \
  --project alumia \
  --tag projects \
  --target sandbox \
  --sandbox-provider e2b \
  --sandbox-sync rsync \
  --timeout 600000

testers workflow fanout --project alumia --workers 6 --url https://preview.example.com
testers workflow fanout wf_abc,wf_def wf_xyz --workers 12 --url https://preview.example.com --json
testers workflow fanout --project alumia --tag action-specific --workers 6 --batch-size 12 --batch 1 --url https://preview.example.com
```

`--workers` is bounded to 1-12 concurrent sandboxes. Use `--batch-size` with a 1-based `--batch` to run large workflow corpora in deterministic waves, or `--offset` for a manual selected-workflow cursor. Fanout preflights provider credentials, required sandbox environment references, `rsync`, and app source directories before launching workers. Use `--dry-run` to inspect the remote commands, upload plans, and preflight checks without spawning sandboxes.

### Next.js Route and Action Inventory

For large apps, generate source-derived route coverage from the Next.js app directory. The importer can create route-level scenarios and one scenario per discovered link, button, form, input, or API method, then group those action scenarios into sandbox workflows for fanout.

```bash
testers inventory next /path/to/app \
  --project alumia \
  --create-scenarios \
  --create-action-scenarios \
  --create-workflows \
  --create-action-workflows \
  --action-workflow-grouping action \
  --sandbox-provider e2b \
  --sandbox-sync rsync \
  --sandbox-app-source /path/to/app \
  --sandbox-app-start-command "bun install && bun dev --hostname 0.0.0.0" \
  --sandbox-app-url http://127.0.0.1:3000 \
  --sandbox-app-wait-url http://127.0.0.1:3000/health \
  --sandbox-env-optional OPENAI_API_KEY

testers workflow fanout --project alumia --tag action-specific --workers 6 --batch-size 12 --batch 1 --url https://preview.example.com --dry-run
```

Use `--action-workflow-grouping action` for one workflow per discovered action, `route` for route-specific workflows, or `area-kind` for broader workflows such as commerce buttons or admin API methods. Add the `--sandbox-app-*` flags when the sandbox should rsync, install, start, and test the app source instead of only testing an already-running URL.

### Common Flags

- `--json --output results.json` — write structured results to a file for downstream tooling.
- `--timeout <ms>` — per-scenario timeout (default: 60s).
- `--overall-timeout <ms>` — hard timeout for the whole run (default: 10 minutes; CI safety net).
- `--github-comment` — post a pass/fail summary as a comment on the current GitHub PR.

### Secure Production Debugging

Use `prod-debug` when an agent or support engineer needs to inspect a production issue without handling customer passwords, raw cookies, bearer tokens, or OAuth codes:

```bash
testers prod-debug "https://alumia.com/acme/projects/project-123?agent=agent-id" --reason "connector auth error"
testers prod-debug "req_abc123" --logs --json
testers prod-debug "https://app.example.com/org/projects/p1" --profile app --json
testers prod-debug "https://app.example.com/org/projects/p1" --support-url "https://support.example.com/scoped/session" --support-grant support-grant-123
```

The command parses the target, redacts sensitive URL parameters, emits safe browser/API/log checks, and blocks user-scoped browser reproduction until the target app provides an audited support browser/session URL or a configured profile that can resolve one. It is app-generic: add a profile in `~/.hasna/testers/config.json` for each production app rather than hardcoding app-specific behavior in the CLI.

```json
{
  "prodDebug": {
    "apps": {
      "app": {
        "name": "App",
        "origins": ["https://app.example.com", "*.app.example.org"],
        "supportGrantRef": "$APP_SUPPORT_GRANT",
        "supportUrlTemplate": "https://support.example.com/scoped/session?grant={supportGrant}&target={targetUrlEncoded}",
        "piiOrigin": "https://api.app.example.com",
        "logCommand": "app logs --project {project} --session {session} --request {request}"
      }
    }
  }
}
```

Credential-bearing profile values can point at environment variables (`$APP_SUPPORT_GRANT`) or the local Hasna secrets vault (`@secrets:division/app/support/grant`). Generated plans redact token, grant, session, key, password, OAuth code, and bearer values before printing or writing output.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | All tests passed |
| `1`  | One or more tests failed |
| `2`  | Configuration error (missing API key, unreachable URL, overall-timeout hit, etc.) |

## GitHub Actions / PR Preview Testing

```yaml
# .github/workflows/qa.yml
name: AI QA Tests
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: bun install -g @hasna/testers
      - run: testers run ${{ needs.deploy.outputs.preview_url }} --github-comment --json --output results.json
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: testers-results
          path: results.json
```

The `--github-comment` flag automatically:
- reads the PR number from `GITHUB_REF` (or `GITHUB_PR_NUMBER` for custom workflows),
- reads the repo from `GITHUB_REPOSITORY`,
- uses `GITHUB_TOKEN` to post a Markdown summary with a pass/fail table.

Generate a starter workflow automatically:

```bash
testers ci
```

## MCP Server

```bash
testers-mcp
```

64 tools available.

## HTTP mode

Shared Streamable HTTP transport (stateless, localhost only):

```bash
testers-mcp --http
# or: MCP_HTTP=1 testers-mcp
```

Default port **8840** (`--port` / `MCP_HTTP_PORT`). Endpoints: `GET /health`, `POST /mcp`.

## REST API

```bash
testers-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service testers
cloud sync pull --service testers
```

## Data Directory

Data is stored in `~/.hasna/testers/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
