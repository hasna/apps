# open-security

AI-powered security scanner for git repos with CLI, MCP server, REST API, Web Dashboard, and SDK.

## Features

- **6 scanner types** -- secrets, dependencies, code patterns, git history, configuration, and AI safety
- **Cerebras LLM integration** -- AI-powered explanation, fix suggestions, triage, and exploitability scoring
- **Multiple output formats** -- terminal (human-readable), JSON (machine-readable), SARIF (GitHub Code Scanning)
- **Web dashboard** -- dark-themed UI for browsing scans, findings, rules, and policies
- **MCP server** -- 20 tools for AI coding agents (Claude Code, Codex, Gemini)
- **REST API** -- full CRUD for scans, findings, rules, policies, and projects
- **TypeScript SDK** -- typed client for programmatic access
- **SQLite-based** -- zero external dependencies, single-file database
- **Policy engine** -- configurable severity blocking, auto-fix, and notifications
- **Baseline support** -- mark known findings as accepted to reduce noise

## Quick Start

```bash
# Install globally
bun add -g @hasnaxyz/open-security

# Scan current directory (all 6 scanners)
open-security scan

# Quick scan (secrets + dependencies only)
open-security scan --quick

# Scan with LLM analysis
open-security scan --llm

# Get AI explanation for a finding
open-security explain <finding-id>

# Get AI fix suggestion
open-security fix <finding-id>

# Review staged git changes for security issues
open-security review

# Start web dashboard
open-security serve
```

## Installation

### bun (recommended)

```bash
bun add -g @hasnaxyz/open-security
```

### npm

```bash
npm install -g @hasnaxyz/open-security
```

### From source

```bash
git clone https://github.com/hasnaxyz/open-security.git
cd open-security
bun install
bun run build
```

## CLI Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `open-security scan [path]` | Run security scan on a directory | `--quick`, `--scanner <type>`, `--format <format>`, `--severity <level>`, `--llm`, `--no-cache` |
| `open-security findings` | List findings from the latest scan | `--severity <level>`, `--scanner <type>`, `--file <path>`, `--format <format>`, `--suppressed` |
| `open-security explain <id>` | Get AI explanation for a finding | |
| `open-security fix <id>` | Get AI-suggested fix for a finding | |
| `open-security review` | Security review staged git changes | |
| `open-security score` | Show security score (0-100) for latest scan | |
| `open-security baseline` | Mark current findings as baseline (suppress) | |
| `open-security init` | Initialize open-security config in current repo | |
| `open-security serve` | Start the web dashboard | `--port <port>` (default: 19428) |

### Output Formats

| Format | Flag | Description |
|--------|------|-------------|
| `terminal` | `--format terminal` | Colored terminal output (default) |
| `json` | `--format json` | Machine-readable JSON |
| `sarif` | `--format sarif` | SARIF for GitHub Code Scanning integration |

### Severity Levels

`critical` > `high` > `medium` > `low` > `info`

Use `--severity <level>` to filter findings at or above the given level.

## MCP Server Setup

The MCP server exposes 20 tools for AI coding agents to scan repos, query findings, and get AI-powered analysis.

### Claude Code

```bash
claude mcp add --transport stdio --scope user open-security -- open-security-mcp
```

### Codex

```toml
# In ~/.codex/config.toml
[mcp_servers.open-security]
command = "open-security-mcp"
args = []
```

### Gemini

```json
// In ~/.gemini/settings.json
{
  "mcpServers": {
    "open-security": {
      "command": "open-security-mcp",
      "args": []
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `scan_repo` | Run a full security scan on a repository path |
| `scan_file` | Scan a single file for security issues |
| `list_findings` | Query findings with optional filters (severity, scanner, file) |
| `get_finding` | Get detailed information about a specific finding |
| `explain_finding` | Get an LLM-generated explanation of a finding |
| `suggest_fix` | Get an LLM-suggested fix for a finding |
| `suppress_finding` | Suppress a finding with a reason |
| `triage_finding` | Auto-triage a finding via LLM analysis |
| `list_rules` | Browse security rules with optional filters |
| `create_rule` | Create a custom security rule |
| `toggle_rule` | Enable or disable a security rule |
| `get_security_score` | Get the security score for a scan |
| `review_diff` | Security review a git diff via LLM |
| `list_scans` | List scan history |
| `get_scan` | Get scan details |
| `list_projects` | List registered projects |
| `register_project` | Register a new project for scanning |
| `get_policy` | Get a policy by ID or the active policy |
| `set_policy` | Create or update a security policy |
| `baseline_findings` | Baseline all findings from a scan |

## REST API

Default port: `19428`. Start with `open-security serve`.

### Scans

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scans` | Trigger a new scan (async, returns 202) |
| `GET` | `/api/scans` | List scans (`?project_id=`, `?limit=`) |
| `GET` | `/api/scans/:id` | Get scan details with security score |

### Findings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/findings` | List findings (`?scan_id=`, `?severity=`, `?scanner_type=`, `?file=`, `?limit=`, `?offset=`) |
| `GET` | `/api/findings/:id` | Get finding details |
| `PATCH` | `/api/findings/:id` | Update finding (suppress, add LLM data) |
| `POST` | `/api/findings/:id/explain` | Trigger LLM explanation |
| `POST` | `/api/findings/:id/fix` | Trigger LLM fix suggestion |

### Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rules` | List rules (`?scanner_type=`, `?enabled=`) |
| `POST` | `/api/rules` | Create a custom rule |
| `PATCH` | `/api/rules/:id` | Update or toggle a rule |

### Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/policies` | List policies |
| `POST` | `/api/policies` | Create a policy |
| `PATCH` | `/api/policies/:id` | Update a policy |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List registered projects |
| `POST` | `/api/projects` | Register a project |

### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Dashboard stats (score, severity breakdown, scanner breakdown) |

## Web Dashboard

The web dashboard provides a visual interface for browsing scan results, findings, rules, and policies.

```bash
# Start on default port (19428)
open-security serve

# Start on custom port
open-security serve --port 3000
```

Open `http://localhost:19428` in your browser. The dashboard is served as static files alongside the API.

## SDK Usage

The TypeScript SDK provides a typed client for the REST API.

```typescript
import { OpenSecurityClient } from "@hasnaxyz/open-security/sdk";

const client = new OpenSecurityClient("http://localhost:19428");

// Trigger a scan
const scan = await client.triggerScan("./my-project", {
  scanners: ["secrets", "dependencies", "code"],
  llm_analyze: true,
});

// List findings filtered by severity
const findings = await client.listFindings({
  scan_id: scan.id,
  severity: "critical",
});

// Get AI explanation for a finding
const { explanation } = await client.explainFinding(findings[0].id);

// Get AI fix suggestion
const { fix } = await client.fixFinding(findings[0].id);

// Suppress a finding
await client.suppressFinding(findings[0].id, "False positive - test file");

// Get security score
const score = await client.getSecurityScore(scan.id);

// Manage rules
const rules = await client.listRules({ scanner_type: "secrets" });
await client.toggleRule(rules[0].id, false);

// Manage policies
await client.createPolicy({
  name: "CI Pipeline",
  block_on_severity: "high",
  auto_fix: false,
});

// Dashboard stats
const stats = await client.getStats();
```

## LLM Integration (Cerebras)

open-security uses [Cerebras](https://cerebras.ai/) for fast LLM-powered analysis. The default model is `llama-4-scout-17b-16e-instruct`.

### Setup

```bash
export CEREBRAS_API_KEY="your-api-key"
```

### Custom Model

```bash
export CEREBRAS_MODEL="llama-4-scout-17b-16e-instruct"
```

### LLM-Powered Features

| Feature | CLI | MCP Tool | API Endpoint |
|---------|-----|----------|--------------|
| **Explain** -- plain-language explanation of a finding | `open-security explain <id>` | `explain_finding` | `POST /api/findings/:id/explain` |
| **Fix** -- suggested code fix with context | `open-security fix <id>` | `suggest_fix` | `POST /api/findings/:id/fix` |
| **Triage** -- severity re-assessment with reasoning | -- | `triage_finding` | -- |
| **Analyze** -- exploitability scoring during scan | `open-security scan --llm` | `scan_repo` (with `llm_analyze: true`) | `POST /api/scans` (with `llm_analyze: true`) |
| **Diff Review** -- security review of git diffs | `open-security review` | `review_diff` | -- |

LLM results are cached in the database -- subsequent requests for the same finding return instantly.

## Architecture

```
                          +-------------------+
                          |    SQLite DB      |
                          |  (findings, scans |
                          |   rules, policies)|
                          +--------+----------+
                                   |
              +--------------------+--------------------+
              |          |         |         |          |
        +-----+--+ +----+---+ +---+----+ +--+-----+ +-+------+
        |  CLI   | |  MCP   | |  REST  | |  Web   | |  SDK   |
        | (Ink/  | | Server | |  API   | | Dash-  | | Client |
        |Cmdr)   | | (stdio)| |(Expr5) | | board  | | (TS)   |
        +-----+--+ +----+---+ +---+----+ +--+-----+ +-+------+
              |          |         |         |          |
              +--------------------+--------------------+
                                   |
                          +--------+----------+
                          |   Scanner Engine  |
                          | (6 scanner types) |
                          +--------+----------+
                                   |
                          +--------+----------+
                          |   Cerebras LLM    |
                          | (explain, fix,    |
                          |  triage, analyze) |
                          +-------------------+
```

All five surfaces (CLI, MCP, API, Dashboard, SDK) share the same SQLite database and scanner engine.

## Scanners

| Scanner | Type | What It Detects |
|---------|------|-----------------|
| **Secrets** | `secrets` | API keys, tokens, passwords, private keys, high-entropy strings |
| **Dependencies** | `dependencies` | Known vulnerable packages in package.json, requirements.txt, Gemfile, go.mod, Cargo.toml |
| **Code** | `code` | SQL injection, XSS, path traversal, command injection, eval usage, insecure crypto, hardcoded credentials |
| **Git History** | `git-history` | Secrets in past commits, force pushes, large binary commits |
| **Config** | `config` | Insecure Dockerfile settings, permissive CORS, debug mode enabled, missing security headers |
| **AI Safety** | `ai-safety` | Prompt injection vectors, unsanitized LLM input, missing output validation, exposed model endpoints |

## Configuration

Initialize a config file in your repo:

```bash
open-security init
```

This creates `.open-security/config.json`:

```json
{
  "enabled_scanners": ["secrets", "dependencies", "code", "git-history", "config", "ai-safety"],
  "severity_threshold": "info",
  "output_format": "terminal",
  "ignore_patterns": ["node_modules", ".git", "dist", "build", "vendor", "__pycache__"],
  "auto_fix": false,
  "llm_analyze": false
}
```

### Configuration Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled_scanners` | `string[]` | All 6 types | Which scanners to run |
| `severity_threshold` | `string` | `"info"` | Minimum severity to report |
| `output_format` | `string` | `"terminal"` | Default output format |
| `ignore_patterns` | `string[]` | Common build dirs | Glob patterns to skip |
| `auto_fix` | `boolean` | `false` | Auto-apply LLM fixes |
| `llm_analyze` | `boolean` | `false` | Run LLM analysis on every scan |
| `cerebras_api_key` | `string` | env var | Cerebras API key (prefer env var) |
| `cerebras_model` | `string` | `"llama-4-scout-17b-16e-instruct"` | Cerebras model to use |

## Contributing

```bash
# Clone
git clone https://github.com/hasnaxyz/open-security.git
cd open-security

# Install dependencies
bun install

# Run tests
bun test

# Run tests with coverage
bun test --coverage

# Type check
bun run typecheck

# Lint
bun run lint

# Dev mode (CLI)
bun run dev:cli scan .

# Dev mode (MCP server)
bun run dev:mcp

# Dev mode (web server)
bun run dev:serve
```

### Project Structure

```
src/
  cli/          # CLI entry point (Commander + Ink)
  mcp/          # MCP server (20 tools)
  server/       # Express REST API + dashboard serving
  scanners/     # 6 scanner implementations
  llm/          # Cerebras client, prompts, analyzer, explainer, fixer, triager
  db/           # SQLite schema + queries (better-sqlite3)
  reporters/    # Terminal, JSON, SARIF output formatters
  lib/          # Config loading, project init
  types/        # TypeScript types and enums
sdk/            # TypeScript SDK client
dashboard/      # Web dashboard (static build)
```

## License

[Apache 2.0](LICENSE)
