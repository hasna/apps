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

### Common Flags

- `--json --output results.json` — write structured results to a file for downstream tooling.
- `--timeout <ms>` — per-scenario timeout (default: 60s).
- `--overall-timeout <ms>` — hard timeout for the whole run (default: 10 minutes; CI safety net).
- `--github-comment` — post a pass/fail summary as a comment on the current GitHub PR.

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
