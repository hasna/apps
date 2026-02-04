# connect-reddit

Reddit connector CLI - Posts, Comments, Subreddits with OAuth2 multi-profile support

## Installation

```bash
bun install -g @hasna/connect-reddit
```

## Quick Start

```bash
# Set your API key
connect-reddit config set-key YOUR_API_KEY

# Or use environment variable
export REDDIT_CLIENT_ID=YOUR_API_KEY
```

## CLI Commands

### Authentication
```bash
connect-reddit auth login                    # OAuth2 login flow
connect-reddit auth logout                   # Clear credentials
connect-reddit auth status                   # Show auth status
```

### Posts
```bash
connect-reddit post submit <subreddit> <title> --body "text"  # Submit text post
connect-reddit post submit <subreddit> <title> --url "https://..." # Submit link
connect-reddit post get <postId>             # Get post details
connect-reddit post delete <postId>          # Delete post
```

### Comments
```bash
connect-reddit comment post <parentId> "text" # Reply to post/comment
connect-reddit comment get <postId>           # Get comments for post
connect-reddit comment delete <commentId>     # Delete comment
```

### Feed
```bash
connect-reddit feed                          # Front page
connect-reddit feed programming              # Subreddit feed
connect-reddit feed -s new -l 50             # New posts, 50 limit
connect-reddit feed -s top -t week           # Top posts this week
```

### Search
```bash
connect-reddit search "query"                # Search all of Reddit
connect-reddit search "query" -r programming # Search in subreddit
connect-reddit search "query" --type sr      # Search subreddits
```

### Users
```bash
connect-reddit user                          # Current user info
connect-reddit user spez                     # Get user info
connect-reddit user spez --posts             # User's posts
connect-reddit user spez --comments          # User's comments
connect-reddit user spez --trophies          # User's trophies
```

### Subreddits
```bash
connect-reddit subreddit programming         # Get subreddit info
connect-reddit subreddit programming --rules # Show rules
connect-reddit subreddit programming --subscribe    # Subscribe
connect-reddit subreddit programming --unsubscribe  # Unsubscribe
```

### Voting
```bash
connect-reddit vote up t3_xxx               # Upvote post
connect-reddit vote down t1_xxx             # Downvote comment
connect-reddit vote none t3_xxx             # Remove vote
```

### Profile & Config
```bash
connect-reddit profile list                  # List profiles
connect-reddit profile use <name>            # Switch profile
connect-reddit profile create <name>         # Create profile
connect-reddit profile delete <name>         # Delete profile
connect-reddit profile show                  # Show current profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-reddit profile create work --api-key xxx --use
connect-reddit profile create personal --api-key yyy

# Switch profiles
connect-reddit profile use work

# Use profile for single command
connect-reddit -p personal <command>

# List profiles
connect-reddit profile list
```

## Library Usage

```typescript
import { Reddit } from '@hasna/connect-reddit';

const client = new Reddit({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REDDIT_CLIENT_ID` | Reddit OAuth2 Client ID |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth2 Client Secret |
| `REDDIT_ACCESS_TOKEN` | OAuth2 access token (overrides profile) |
| `REDDIT_REFRESH_TOKEN` | OAuth2 refresh token (overrides profile) |

## Data Storage

Configuration stored in `~/.connect/connect-reddit/`:

```
~/.connect/connect-reddit/
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
