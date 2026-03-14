# @hasna/configs

AI coding agent configuration manager — store, version, apply, and share all your AI coding configs.

**One command to capture your entire setup. One command to recreate it anywhere.**

```bash
bun install -g @hasna/configs
configs init                     # first-time setup: sync all known configs + create profile
configs status                   # health check: drifted, secrets, templates
configs pull                     # re-sync from disk → DB
configs push                     # apply DB → disk
```

## What It Stores

| Category | Examples |
|----------|---------|
| `agent` | CLAUDE.md, settings.json, keybindings.json, Codex config.toml, Gemini settings |
| `rules` | ~/.claude/rules/*.md, AGENTS.md, GEMINI.md |
| `mcp` | MCP server entries from ~/.claude.json, codex config |
| `shell` | .zshrc, .zprofile, shell functions |
| `secrets_schema` | Shape of .secrets (keys + descriptions, never values) |
| `workspace` | Directory hierarchy conventions (reference doc) |
| `git` | .gitconfig, .gitignore templates |
| `tools` | .npmrc, tsconfig.json, bunfig.toml |

Configs have two **kinds**:
- `file` — has a `target_path`, can be applied to disk
- `reference` — convention doc, no target path (workspace structure, secrets schema)

## Install

```bash
bun install -g @hasna/configs
```

## Quick Start

```bash
# Ingest your Claude Code setup
configs sync --dir ~/.claude

# See what's stored
configs list
configs whoami

# View a config
configs show claude-claude-md

# Check diff between stored and disk
configs diff claude-claude-md

# Apply to disk (with preview first)
configs apply claude-claude-md --dry-run
configs apply claude-claude-md

# Bundle everything for backup/sharing
configs export -o my-setup.tar.gz

# Restore on a new machine
configs import my-setup.tar.gz
```

## CLI Reference

### Core Commands

```bash
configs list [options]
  -c, --category <cat>    filter by category
  -a, --agent <agent>     filter by agent (claude|codex|gemini|zsh|git|npm|global)
  -k, --kind <kind>       filter by kind (file|reference)
  -t, --tag <tag>         filter by tag
  -s, --search <query>    search name/description/content
  -f, --format <fmt>      table|json|compact

configs show <id|slug>    show content + metadata
configs add <path>        ingest a file into the DB
  -n, --name <name>       config name
  -c, --category <cat>    category override
  -a, --agent <agent>     agent override
  -k, --kind <kind>       file|reference

configs apply <id>        write config to its target_path
  --dry-run               preview without writing

configs diff [id]         show diff: stored vs disk (omit id for all)
configs compare <a> <b>   diff two stored configs against each other

configs sync              sync known AI coding configs from disk
  -a, --agent <agent>     only sync this agent
  -p, --project [dir]     sync project-scoped configs (CLAUDE.md, .mcp.json)
  --to-disk               apply DB → disk instead
  --dry-run               preview
  --list                  show which files would be synced

configs pull              alias for sync (disk → DB)
configs push              alias for sync --to-disk (DB → disk)

configs export            export as tar.gz bundle
configs import <file>     import from tar.gz bundle (--overwrite)
configs backup            timestamped export to ~/.configs/backups/
configs restore <file>    import from backup (--overwrite)

configs init              first-time setup: sync + seed + create profile
configs status            health check: drifted, secrets, templates
configs whoami            setup summary: DB path, counts by category
configs doctor            validate syntax, permissions, missing files, secrets
configs scan [id]         scan for unredacted secrets (--fix to redact)
configs watch             auto-sync on file changes (polls every 3s)
configs update            check for + install latest version
configs completions       output zsh/bash completion script

configs mcp install       install MCP server (--claude, --codex, --gemini, --all)
configs mcp uninstall     remove MCP server
```

### Profiles

Profiles are named bundles of configs — your complete machine setup.

```bash
configs profile create "fresh-mac-setup"
configs profile list
configs profile show fresh-mac-setup
configs profile add fresh-mac-setup claude-claude-md
configs profile add fresh-mac-setup zshrc
configs profile apply fresh-mac-setup --dry-run
configs profile apply fresh-mac-setup
configs profile delete fresh-mac-setup
```

### Snapshots (Version History)

Every time you apply a config, the previous version is snapshotted automatically.

```bash
configs snapshot list claude-claude-md   # list all snapshots
configs snapshot show <snapshot-id>       # view content
configs snapshot restore <config> <id>    # restore to that version
```

### Templates & Secret Redaction

Secrets are automatically redacted when ingesting configs. Values matching API keys, tokens, passwords etc. are replaced with `{{VAR_NAME}}` placeholders.

```bash
configs template vars npmrc              # show: {{NPM_AUTH_TOKEN}}
configs template render npmrc --env --apply  # fill from env vars, write to disk
configs template render npmrc --var NPM_AUTH_TOKEN=xxx --dry-run  # preview
configs scan                             # check for unredacted secrets
configs scan --fix                       # redact any that slipped through
```

### Agent Profiles (Token Optimization)

Control which MCP tools are exposed via `CONFIGS_PROFILE` env var:

```bash
CONFIGS_PROFILE=minimal configs-mcp   # 3 tools: get_status, get_config, sync_known
CONFIGS_PROFILE=standard configs-mcp  # 11 tools: CRUD + sync + profiles
CONFIGS_PROFILE=full configs-mcp      # 13 tools (default)
```

## MCP Server

Install the MCP server so AI agents can read/write configs directly:

```bash
configs-mcp --claude    # install into Claude Code
```

Or manually:
```bash
claude mcp add --transport stdio --scope user configs -- configs-mcp
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_configs` | List by category/agent/kind/search |
| `get_config` | Get full config including content |
| `create_config` | Create a new config |
| `update_config` | Update content/tags/metadata |
| `apply_config` | Write to target_path on disk |
| `sync_directory` | Bulk sync a directory |
| `list_profiles` | List profiles |
| `apply_profile` | Apply all configs in a profile |
| `get_snapshot` | Get historical version |
| `search_tools` | Search tool descriptions (token-efficient) |
| `describe_tools` | Get full tool docs on demand |

## REST API

Start the server: `configs-serve` (port 3457)

```
GET  /api/configs              list configs (?category=&agent=&search=&fields=)
POST /api/configs              create config
GET  /api/configs/:id          get config
PUT  /api/configs/:id          update config
DEL  /api/configs/:id          delete config
POST /api/configs/:id/apply    apply to disk {dry_run?}
POST /api/configs/:id/snapshot create snapshot
GET  /api/configs/:id/snapshots list snapshots
POST /api/sync                 sync directory {dir, direction, dry_run}
GET  /api/profiles             list profiles
POST /api/profiles             create profile
GET  /api/profiles/:id         get profile + configs
PUT  /api/profiles/:id         update profile
DEL  /api/profiles/:id         delete profile
POST /api/profiles/:id/apply   apply all configs in profile
GET  /api/machines             list machines
GET  /api/stats                counts by category
GET  /health                   health check
```

## SDK

```bash
bun add @hasna/configs-sdk
```

```typescript
import { ConfigsClient } from "@hasna/configs-sdk";

const client = new ConfigsClient({ baseUrl: "http://localhost:3457" });

// List all rules configs
const rules = await client.listConfigs({ category: "rules" });

// Get a specific config
const claudeMd = await client.getConfig("claude-claude-md");
console.log(claudeMd.content);

// Update it
await client.updateConfig("claude-claude-md", { content: "# Updated" });

// Apply to disk
const result = await client.applyConfig("claude-claude-md", /* dryRun */ false);
console.log(result.changed, result.path);

// Apply a whole profile
const results = await client.applyProfile("fresh-mac-setup");

// Sync from disk
const sync = await client.syncDirectory("~/.claude");
console.log(`+${sync.added} updated:${sync.updated}`);

// Get cost stats
const stats = await client.getStats();
console.log(`Total: ${stats.total} configs`);
```

## Web Dashboard

```bash
configs-serve &
open http://localhost:3457
```

5 pages: **Configs** (browse/edit), **Profiles** (manage bundles), **Apply** (preview + apply + sync), **History** (snapshots), **Machines** (where applied).

## Seed Your Setup

Immediately useful after install:

```bash
bun run seed    # ingests ~/.claude/, ~/.zshrc, ~/.gitconfig, etc.
```

## Database Location

Default: `~/.configs/configs.db`

Override: `CONFIGS_DB_PATH=/path/to/configs.db configs list`

## Part of the @hasna Ecosystem

- [`@hasna/todos`](https://npm.im/@hasna/todos) — task management for AI agents
- [`@hasna/mementos`](https://npm.im/@hasna/mementos) — persistent memory for AI agents
- [`@hasna/conversations`](https://npm.im/@hasna/conversations) — real-time messaging between agents
- [`@hasna/skills`](https://npm.im/@hasna/skills) — skill management (prompts + MCP installs)
- [`@hasna/sessions`](https://npm.im/@hasna/sessions) — search across coding sessions
- [`@hasna/economy`](https://npm.im/@hasna/economy) — AI coding cost tracker
- **`@hasna/configs`** — this package

## License

Apache-2.0
