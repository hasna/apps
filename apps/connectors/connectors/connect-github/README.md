# connect-github

GitHub API connector with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-github
```

## Quick Start

```bash
# Set your API key
connect-github config set-key YOUR_API_KEY

# Or use environment variable
export GITHUB_TOKEN=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-github profile create work --api-key xxx --use
connect-github profile create personal --api-key yyy

# Switch profiles
connect-github profile use work

# Use profile for single command
connect-github -p personal <command>

# List profiles
connect-github profile list
```

## Library Usage

```typescript
import { Github } from '@hasna/connect-github';

const client = new Github({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token (overrides profile) |
| `GITHUB_BASE_URL` | Override base URL (for GitHub Enterprise) |

## Data Storage

Configuration stored in `~/.connect/connect-github/`:

```
~/.connect/connect-github/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
