# @hasna/shield

AI-powered shield scanner for git repos with supply chain attack detection.

[![npm](https://img.shields.io/npm/v/@hasna/shield)](https://www.npmjs.com/package/@hasna/shield)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/shield
# or
bun install -g @hasna/shield
```

## Quick Start

```bash
# Scan your repo for security issues
shield scan .

# Focused secret-exposure scan (repo files, git history, processes, tmux)
security secrets .

# Check if a package is compromised (axios/litellm/Trivy supply chain attacks)
security check-package axios 1.14.1
security check-package litellm 1.82.8 --ecosystem pypi

# List known supply chain attack advisories
security advisories

# Quick scan (secrets + dependencies only)
shield scan . --quick

# Install a pre-push hook that blocks pushes on exposed secrets
shield init --install-pre-push
```

## Scanners

9 built-in scanners:

| Scanner | What it finds |
|---------|--------------|
| `secrets` | API keys, tokens, high-entropy strings |
| `dependencies` | CVEs via OSV.dev (npm, PyPI, Go, Rust) |
| `code` | SQL injection, XSS, command injection, path traversal |
| `git-history` | Secrets committed in git history |
| `config` | Insecure CORS, debug mode, missing security headers |
| `ai-safety` | Prompt injection, PII exposure, unsafe tool use |
| `ioc` | Supply chain attack indicators (C2 domains, RAT artifacts, malicious packages) |
| `lockfile` | Compromised locked versions, unpinned ranges during attack windows |
| `supply-chain` | Typosquatting, postinstall exploits, GitHub Actions tag hijacking |

## Supply Chain Attack Detection

The IOC scanner checks against a built-in advisory database of known attacks:

- **axios@1.14.1/0.30.4** (March 31, 2026) — maintainer account hijack, RAT dropper via `plain-crypto-js`
- **litellm@1.82.7/1.82.8** (March 24, 2026) — TeamPCP CI/CD compromise via poisoned Trivy, `.pth` file persistence
- **Trivy v0.69.4** (March 19, 2026) — TeamPCP tag hijack, 76 version tags force-pushed
- **Checkmarx KICS/AST** (March 23, 2026) — TeamPCP tag hijack using stolen CI/CD credentials

```bash
# Run IOC scan
shield scan . --scanner ioc

# Run lockfile forensics
shield scan . --scanner lockfile

# Full supply chain check
shield scan . --scanner supply-chain
```

## Alert Pipeline

Configure alerts for new supply chain detections:

```bash
# Check alert status
security alerts status

# Test alerts with a known advisory
security alerts test

# Enable alerts (min severity: critical)
security alerts enable
```

Supports: **Slack**, **Discord**, **Webhook**, **Twitter/X**, **Email**

```bash
# Set via environment variables
export SECURITY_SLACK_WEBHOOK_URL=https://hooks.slack.com/...
export SECURITY_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
export SECURITY_WEBHOOK_URL=https://your-api.example.com/webhook
```

## MCP Server (for AI agents)

```bash
# Install for Claude Code
shield mcp --claude

# Install for all agents
shield mcp --all
```

32 tools available including `check_package`, `scan_repo`, `list_advisories`, `get_advisory`.

## REST API + Dashboard

```bash
shield serve
# Opens at http://localhost:19428
```

Dashboard pages: Dashboard, Feed (live advisory feed), Package Lookup, Attack Timeline, Findings, Scans, Rules, Projects.

API endpoints:
- `GET /api/advisories` — list known supply chain advisories
- `GET /api/check-package?name=axios&version=1.14.1` — check package safety
- `GET /api/findings` — query scan findings
- `POST /api/scans` — trigger a new scan

## All CLI Commands

```
shield scan [path]              Run shield scan
security secrets [options] [path] Focused secret-exposure scan (files + live context)
shield findings                 List findings
shield explain <id>             AI explanation for a finding
shield fix <id>                 AI-suggested fix
shield review                   Review staged git changes
shield init                     Initialize for this repo
shield baseline                 Mark findings as baseline
shield score                    Show shield score
security check-package <name>     Check if package is compromised
security advisories               List supply chain advisories
security alerts status|test|...   Manage alert channels
shield mcp --claude|--all       Install MCP server
shield serve                    Start web dashboard
```

## Data

Stored in `~/.hasna/security/` (override with `SECURITY_DB` env var).

## Secret Exposure Workflow

`shield secrets` combines four sources:

- repository files such as `.env` files and config files
- git history across all branches
- running process environments
- tmux pane/session metadata plus recent pane history

Useful flags:

```bash
security secrets . --repo-only
security secrets . --json
security secrets . --severity high --fail-on medium
```

## Cloud Sync

```bash
cloud sync push --service security
cloud sync pull --service security
```

## HTTP mode

By default `shield-mcp` uses stdio. For a long-lived shared HTTP server (Streamable HTTP, stateless):

```bash
shield-mcp --http
# or: MCP_HTTP=1 shield-mcp

# Custom port (default 8833)
shield-mcp --http --port 8833
# or: MCP_HTTP_PORT=8833 MCP_HTTP=1 shield-mcp
```

Endpoints (bound to `127.0.0.1` only):

- `GET /health` → `{"status":"ok","name":"security"}`
- `POST /mcp` — MCP Streamable HTTP endpoint

## License

Apache-2.0 — see [LICENSE](LICENSE)
