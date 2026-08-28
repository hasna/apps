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

# Wider sources are separate, per-invocation opt-ins
shield scan . --git-history
shield scan . --system

# Focused secret-exposure scan (safe default: repository files only)
shield secrets .

# Explicit historical scan (still redacted in terminal/JSON/SARIF output)
shield secrets . --git-history

# Publishable OSS policy check with redacted output
shield oss-secrets-policy . --strict

# Check if a package is compromised (axios/litellm/Trivy supply chain attacks)
shield check-package axios 1.14.1
shield check-package litellm 1.82.8 --ecosystem pypi

# List known supply chain attack advisories
shield advisories

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
| `ioc` | In-tree C2/malicious-package indicators; host RAT/Python paths require `--system` |
| `lockfile` | Compromised locked versions and unpinned ranges; history requires `--git-history` |
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
shield alerts status

# Test alerts with a known advisory
shield alerts test

# Enable alerts (min severity: critical)
shield alerts enable
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

CLI, library, SDK, MCP, REST, and dashboard-triggered aggregate scans inspect
only the requested filesystem tree by default. REST/SDK/MCP callers must send
`include_git_history: true` or `include_system: true` for the corresponding
wider source. Merely listing `git-history` in a REST/MCP scanner array does not
authorize history access.

## All CLI Commands

```
shield scan [path]              Run shield scan
shield secrets [options] [path] Focused secret-exposure scan (file-only by default)
shield oss-secrets-policy [roots...] Evaluate publishable OSS secret-scan policy
shield findings                 List findings
shield explain <id>             AI explanation for a finding
shield fix <id>                 AI-suggested fix
shield review                   Review staged git changes
shield init                     Initialize for this repo
shield baseline                 Mark findings as baseline
shield score                    Show shield score
shield check-package <name>     Check if package is compromised
shield advisories               List supply chain advisories
shield alerts status|test|...   Manage alert channels
shield mcp --claude|--all       Install MCP server
shield serve                    Start web dashboard
```

The legacy `@hasna/security` package is now a command-alias shim for existing
installs. New installs should use `@hasna/shield`.

## Data

Stored under the effective shield data root — legacy `~/.hasna/security/`
until the resolver (XDG) data home is adopted, then `~/.local/share/hasna/
security/` on Linux (see the Storage section for precedence; `SECURITY_DB`
and `HASNA_SHIELD_HOME` override it).

## Secret Exposure Workflow

`shield secrets` scans repository files by default. The following additional
sources exist, but each requires an explicit opt-in because it crosses a wider
data boundary:

- repository files such as `.env` files and config files
- `--git-history` scans git history across all branches
- `--processes` inspects running process command/environment snapshots
- `--tmux` inspects tmux pane/session metadata plus recent pane history

Secret and credential findings never emit raw code snippets. Terminal, JSON,
and SARIF reporters retain the rule, location, severity, and fingerprint while
replacing sensitive snippets and analysis text with `[REDACTED]`. Credential
findings are also excluded from LLM explanation, triage, analysis, and fix
context so source lines cannot cross a model boundary. Secret-scan error output
also withholds underlying exception text because parser or provider errors can
contain scanned source context.

Useful flags:

```bash
# Safe file-only modes (the default, plus an explicit fail-closed form)
shield secrets .
shield secrets . --files-only --json

# Historical source: explicit opt-in
shield secrets . --git-history --json

# Live sources: sensitive explicit opt-in; never use in routine CI
shield secrets . --processes
shield secrets . --tmux

# --repo-only blocks live sources; history still requires --git-history
shield secrets . --repo-only --git-history
shield secrets . --json
shield secrets . --severity high --fail-on medium

# Package/archive-only validation does not inspect ambient processes or tmux
shield fleet-package ./package.tgz --json
```

### Migration warning for 0.1.25 and earlier

Versions through 0.1.25 allowed aggregate and focused paths to cross historical
or live-machine boundaries without a consistent per-invocation opt-in.
Structured output could therefore include credential-bearing source context.
Upgrade before using Shield in an agent, CI job, log collector, or
transcript-producing tool. Until the fixed version is installed,
use `shield secrets . --repo-only --no-git-history --no-processes --no-tmux`
or use the `secrets scan workspace` and `shield fleet-package` file/archive
paths. If an older structured scan ran in a credential-bearing environment,
treat the visible credential identifiers as exposed, preserve values out of
incident channels, and follow the owning vault/provider rotation runbook.
Existing finding rows are sanitized on read and the sanitized fields are then
written back when the local database is writable. Stable non-sensitive hashes
retain correlation without retaining the credential-bearing location or rule
identifier. A read-only database still receives sanitized API/MCP/reporter
output, but cannot be rewritten in place. Credential-finding fingerprints may
change once newly scanned records use the redacted persistence form.

For publishable OSS packages, see
[`docs/oss-secret-scan-policy.md`](docs/oss-secret-scan-policy.md). The policy
requires a `check:secrets` script, prepublish/prepack coverage, release or CI
coverage, explicit vendored/upstream fixture handling, and owner/reason/expiry
metadata plus a rule-specific fixture path for any narrow fixture allowlist.

## Storage

Shield stores local state under the effective shield data root. The root
resolves through the `@hasna/paths` resolver (XDG/macOS home layout): the
legacy default is `~/.hasna/security`; once the resolver (XDG) data home is
adopted (`HASNA_DATA_HOME` set, or the store already migrated to
`~/.local/share/hasna/security/shield.db`), the SQLite store, the global alert
config and the global CLI config resolve there instead. `HASNA_SHIELD_HOME`
sets an exact data root that wins over both. Set
`SECURITY_DB=/path/to/shield.db` to pin a specific SQLite database file; that
per-file override wins on top of the effective root. Nothing moves on disk
until the store is physically migrated.

The retired `HASNA_SHIELD_STORAGE_MODE` / `HASNA_SECURITY_STORAGE_MODE`
variables are no longer read; the store is always local SQLite.

## HTTP mode

By default `shield-mcp` uses stdio. For a long-lived shared HTTP server (Streamable HTTP, stateless):

```bash
shield-mcp --http
# or: MCP_HTTP=1 shield-mcp

# Custom port (default 8876)
shield-mcp --http --port 8876
# or: MCP_HTTP_PORT=8876 MCP_HTTP=1 shield-mcp
```

Endpoints (bound to `127.0.0.1` only):

- `GET /health` → `{"status":"ok","name":"security"}`
- `POST /mcp` — MCP Streamable HTTP endpoint

## License

Apache-2.0 — see [LICENSE](LICENSE)
