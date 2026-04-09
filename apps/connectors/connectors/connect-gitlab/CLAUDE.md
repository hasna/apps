# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-gitlab is a TypeScript connector for GitLab's REST API. It provides a CLI and programmatic interface for managing projects, issues, merge requests, pipelines, jobs, branches, groups, runners, and more.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Authentication
connect-gitlab config set-token <token>  # Set access token
connect-gitlab config set-url <url>      # Set GitLab URL (self-hosted)
connect-gitlab config show               # Show current config
connect-gitlab config clear              # Clear config

# Profile management
connect-gitlab profile list              # List profiles
connect-gitlab profile use <name>        # Switch profile
connect-gitlab profile create <name>     # Create profile
connect-gitlab profile delete <name>     # Delete profile

# Current user
connect-gitlab me                        # Get current user info

# Projects
connect-gitlab projects list             # List projects
connect-gitlab projects get <id>         # Get a project
connect-gitlab projects create           # Create a project
connect-gitlab projects delete <id>      # Delete a project
connect-gitlab projects fork <id>        # Fork a project

# Issues
connect-gitlab issues list <projectId>   # List project issues
connect-gitlab issues get <projectId> <issueIid>  # Get an issue
connect-gitlab issues create <projectId> # Create an issue
connect-gitlab issues close <projectId> <issueIid>  # Close an issue
connect-gitlab issues reopen <projectId> <issueIid> # Reopen an issue

# Merge Requests
connect-gitlab mr list <projectId>       # List merge requests
connect-gitlab mr get <projectId> <mrIid>  # Get a merge request
connect-gitlab mr create <projectId>     # Create a merge request
connect-gitlab mr merge <projectId> <mrIid>  # Merge a merge request

# Pipelines
connect-gitlab pipelines list <projectId>  # List pipelines
connect-gitlab pipelines get <projectId> <pipelineId>  # Get a pipeline
connect-gitlab pipelines create <projectId>  # Trigger a pipeline
connect-gitlab pipelines retry <projectId> <pipelineId>  # Retry a pipeline
connect-gitlab pipelines cancel <projectId> <pipelineId>  # Cancel a pipeline

# Jobs
connect-gitlab jobs list <projectId> <pipelineId>  # List pipeline jobs
connect-gitlab jobs get <projectId> <jobId>  # Get a job
connect-gitlab jobs retry <projectId> <jobId>  # Retry a job
connect-gitlab jobs cancel <projectId> <jobId>  # Cancel a job
connect-gitlab jobs play <projectId> <jobId>  # Play a manual job

# Branches
connect-gitlab branches list <projectId>  # List branches
connect-gitlab branches get <projectId> <branch>  # Get a branch
connect-gitlab branches create <projectId>  # Create a branch
connect-gitlab branches delete <projectId> <branch>  # Delete a branch

# Groups
connect-gitlab groups list               # List groups
connect-gitlab groups get <groupId>      # Get a group
connect-gitlab groups projects <groupId> # List group projects

# Runners
connect-gitlab runners list              # List runners
connect-gitlab runners get <runnerId>    # Get a runner
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITLAB_ACCESS_TOKEN` | Personal access token (overrides profile) |
| `GITLAB_TOKEN` | Alias for GITLAB_ACCESS_TOKEN |
| `GITLAB_URL` | GitLab URL for self-hosted instances |

## Authentication

Uses PRIVATE-TOKEN header for authentication. Get your token from:
- gitlab.com: https://gitlab.com/-/user_settings/personal_access_tokens
- Self-hosted: https://your-gitlab-instance/-/user_settings/personal_access_tokens

Required scopes depend on operations:
- `read_api` - Read-only access
- `api` - Full API access
- `read_user` - Read user info
- `read_repository` - Read repo
- `write_repository` - Write to repo

## Data Storage

```
~/.hasna/connectors/connect-gitlab/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "accessToken": "glpat-xxx",
  "baseUrl": "https://gitlab.example.com"
}
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with PRIVATE-TOKEN auth
│   └── index.ts      # GitLab API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

- Users: List, get, current user
- Projects: List, get, create, update, delete, star, unstar, fork
- Issues: List, get, create, update, delete, close, reopen
- Merge Requests: List, get, create, update, accept/merge, delete
- Pipelines: List, get, create, retry, cancel, delete
- Jobs: List, get, retry, cancel, play, logs
- Branches: List, get, create, delete
- Commits: List, get
- Milestones: List, get, create, update, delete
- Groups: List, get, projects
- Runners: List, get, project runners
- Deployments: List, get
- Environments: List, get, create, stop, delete
- Snippets: List, get, create, delete
- Tags: List, get, create, delete
