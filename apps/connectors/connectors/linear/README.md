# @hasna/connect-linear

Linear API connector with CLI and library support. Provides a TypeScript-first interface for interacting with the Linear GraphQL API.

## Installation

```bash
npm install @hasna/connect-linear
# or
bun add @hasna/connect-linear
```

For CLI usage, install globally:

```bash
npm install -g @hasna/connect-linear
```

## Configuration

### Environment Variable

Set your Linear API key as an environment variable:

```bash
export LINEAR_API_KEY="lin_api_xxxxx"
```

### CLI Configuration

Or use the CLI to save your API key:

```bash
connect-linear config set-api-key lin_api_xxxxx
```

Configuration is stored in `~/.hasna/connectors/connect-linear/`.

## CLI Usage

### Authentication

```bash
# Test authentication
connect-linear test

# Show current user
connect-linear whoami
```

### Issues

```bash
# List issues
connect-linear issues list
connect-linear issues list --team <team-id>
connect-linear issues list --project <project-id>
connect-linear issues list --assignee <user-id>

# Get issue details
connect-linear issues get <issue-id>

# Create issue
connect-linear issues create --title "Bug fix" --team <team-id>
connect-linear issues create --title "Feature" --team <team-id> --description "Details here" --priority 2

# Update issue
connect-linear issues update <issue-id> --title "New title"
connect-linear issues update <issue-id> --state <state-id>
connect-linear issues update <issue-id> --assignee <user-id>

# Archive issue
connect-linear issues archive <issue-id>

# Search issues
connect-linear issues search "bug"
```

### Projects

```bash
# List projects
connect-linear projects list

# Get project details
connect-linear projects get <project-id>
```

### Teams

```bash
# List teams
connect-linear teams list

# Get team details
connect-linear teams get <team-id>

# List workflow states for a team
connect-linear teams states <team-id>
```

### Users

```bash
# List users
connect-linear users list
connect-linear users list --all  # Include inactive users

# Get user details
connect-linear users get <user-id>

# Current user
connect-linear users me
```

### Multi-Profile Support

```bash
# Create a profile
connect-linear profile create work

# Switch profiles
connect-linear profile use work

# List profiles
connect-linear profile list

# Use profile for a single command
connect-linear --profile work issues list
```

### Output Formats

```bash
# JSON output
connect-linear issues list --format json

# Table output
connect-linear issues list --format table

# Pretty output (default)
connect-linear issues list --format pretty
```

## Library Usage

```typescript
import { Linear } from '@hasna/connect-linear';

const linear = new Linear({
  apiKey: process.env.LINEAR_API_KEY!,
});

// List issues
const issues = await linear.issues.list({ teamId: 'team-id' });

// Create issue
const issue = await linear.issues.create({
  title: 'New feature',
  teamId: 'team-id',
  description: 'Feature description',
  priority: 2,
});

// Update issue
await linear.issues.update(issue.id, {
  stateId: 'done-state-id',
});

// Get current user
const me = await linear.users.me();

// List teams
const teams = await linear.teams.list();

// Get workflow states
const states = await linear.teams.getWorkflowStates('team-id');

// Search issues
const results = await linear.issues.search('bug');
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | Linear API key (required) |

## Priority Values

| Value | Label |
|-------|-------|
| 0 | No priority |
| 1 | Urgent |
| 2 | High |
| 3 | Normal |
| 4 | Low |

## License

Apache-2.0
