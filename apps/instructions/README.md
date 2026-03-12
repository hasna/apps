# @hasna/configs

AI coding agent configuration manager — store, version, apply, and share all your AI coding configs.

**One command to capture your entire setup. One command to recreate it anywhere.**

```bash
bun install -g @hasna/configs
configs sync --dir ~/.claude     # ingest all Claude Code configs
configs whoami                   # see what's stored
configs apply claude-claude-md   # write a config back to disk
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

configs diff <id>         show diff: stored vs disk

configs sync              bulk sync a directory
  -d, --dir <dir>         directory (default: ~/.claude)
  --from-disk             read files from disk into DB (default)
  --to-disk               apply DB configs back to disk
  --dry-run               preview

configs export            export as tar.gz bundle
  -o, --output <path>     output file (default: ./configs-export.tar.gz)
  -c, --category <cat>    filter by category

configs import <file>     import from tar.gz bundle
  --overwrite             overwrite existing configs

configs whoami            setup summary (DB path, counts by category)
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

### Templates

Configs with `{{VAR_NAME}}` placeholders are templates.

```bash
configs template vars my-zshrc-template   # show required variables
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
