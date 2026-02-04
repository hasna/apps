# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-reddit is a TypeScript connector for the Reddit API with OAuth2 authentication and multi-profile configuration support. It provides both a CLI and a programmatic API for interacting with Reddit.

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

## Authentication

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-reddit config set-key <key>`
- OAuth flow: `connect-reddit oauth login`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-reddit/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses OAuth2 with refresh tokens for authentication. Credentials can be set via:
- Environment variables: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_ACCESS_TOKEN`, `REDDIT_REFRESH_TOKEN`
- OAuth2 flow: `connect-reddit auth login`

### Service APIs

Each Reddit API area has its own module:
- **PostsApi**: Submit, get, delete, vote on posts
- **CommentsApi**: Post, get, delete, vote on comments
- **SubredditsApi**: Get info, search, subscribe/unsubscribe
- **UsersApi**: Get user info, karma, posts, comments
- **SearchApi**: Search posts, subreddits

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REDDIT_CLIENT_ID` | Reddit OAuth2 Client ID |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth2 Client Secret |
| `REDDIT_ACCESS_TOKEN` | OAuth2 access token (overrides profile) |
| `REDDIT_REFRESH_TOKEN` | OAuth2 refresh token (overrides profile) |

## Data Storage

```
~/.connect/connect-reddit/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
