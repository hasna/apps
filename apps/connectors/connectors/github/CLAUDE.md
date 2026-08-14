# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-github is a TypeScript connector for the GitHub API. It provides multi-profile configuration, Bearer token authentication, and a clean CLI for managing GitHub repositories, issues, pull requests, and users.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication (2025+)

Bearer Token authentication. Use **fine-grained PATs** (GA since March 2025) for all new projects — they are now the recommended token type.

Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-github config set-key <key>`

### Token Types

| Type | Recommendation |
|------|---------------|
| Fine-grained PAT | **Preferred** — GA since March 2025, granular permissions, audit-log `token_id` tracking |
| Classic PAT | Legacy — still works, but over-permissioned |

Fine-grained PAT gaps (not yet supported): Packages API, Checks API, internal repos outside target org, multi-org access.

### Required Scopes (fine-grained PAT)

- `contents:read/write` — repos, files
- `issues:read/write` — issues, comments
- `pull_requests:read/write` — PRs, reviews
- `metadata:read` — required for all repo access
- `models:read` — if using GitHub Models API (required since March 29 2025)

### API Version

Current: `X-GitHub-Api-Version: 2022-11-28` (unchanged)

### GitHub MCP Server

The Remote GitHub MCP Server is GA since September 2025. Add to your MCP config:
```json
{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] } } }
```


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-github/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- `GITHUB_TOKEN` environment variable overrides profile config

### Authentication

GitHub API uses Bearer token in `src/api/client.ts`:
```typescript
'Authorization': `Bearer ${this.token}`,
'Accept': 'application/vnd.github+json',
'X-GitHub-Api-Version': '2022-11-28',
```

### API Modules

- **ReposApi**: Repository operations (list, get, create, delete, content)
- **IssuesApi**: Issue operations (list, get, create, update, comment)
- **PullsApi**: PR operations (list, get, create, merge, review)
- **UsersApi**: User operations (info, followers, following)

## API Modules

- **ReposApi**: Repository operations (list, get, create, delete, content)
- **IssuesApi**: Issue operations (list, get, create, update, comment)
- **PullsApi**: PR operations (list, get, create, merge, review)
- **UsersApi**: User operations (info, followers, following)

## CLI Commands

### Repository Commands
```bash
connect-github repo list [owner]        # List repos (defaults to authenticated user)
connect-github repo list owner --org    # List org repos
connect-github repo get owner repo      # Get repo info
connect-github repo create name         # Create repo
connect-github repo delete owner repo   # Delete repo
connect-github repo content owner repo path  # Get file content
```

### Issue Commands
```bash
connect-github issue list owner repo    # List issues
connect-github issue get owner repo 1   # Get issue #1
connect-github issue create owner repo -t "Title"  # Create issue
connect-github issue close owner repo 1 # Close issue
connect-github issue comment owner repo 1 -b "Comment"  # Add comment
connect-github issue comments owner repo 1  # List comments
```

### Pull Request Commands
```bash
connect-github pr list owner repo       # List PRs
connect-github pr get owner repo 1      # Get PR #1
connect-github pr create owner repo -t "Title" --head feature --base main
connect-github pr merge owner repo 1    # Merge PR
connect-github pr reviews owner repo 1  # List reviews
connect-github pr review owner repo 1 --approve  # Approve PR
```

### User Commands
```bash
connect-github user info                # Get authenticated user
connect-github user info username       # Get user info
connect-github user followers           # List my followers
connect-github user following username  # List who user follows
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token (overrides profile) |
| `GITHUB_BASE_URL` | Override base URL (for GitHub Enterprise) |

## Data Storage

```
~/.hasna/connectors/connect-github/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
