# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-linkedin is a TypeScript connector for the LinkedIn API v2. It provides CLI and library access to manage profiles, posts, organizations, comments, reactions, and analytics.

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

# Run specific commands
bun run dev me profile
bun run dev post list <authorUrn>
bun run dev organization list
bun run dev config show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer token auth
│   └── index.ts      # LinkedIn API wrapper class
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

### Profile (Me)
- Get current user profile
- Get email address
- Get profile picture

### Organizations
- Get organization by ID
- Find organization by vanity name
- List administered organizations

### Posts (UGC)
- Create posts (text, article links)
- Get post by ID
- List posts by author
- Delete posts

### Comments
- Create comments
- List comments on a post
- Delete comments

### Reactions
- Add reactions (LIKE, CELEBRATION, LOVE, INSIGHTFUL, CURIOUS, SUPPORT, FUNNY)
- List reactions on a post
- Remove reactions

### Analytics
- Share/post statistics
- Organization follower statistics
- Organization page statistics

### Media Upload
- Register image/video uploads
- Upload media files

## Authentication

Uses OAuth 2.0 Bearer token authentication:
```typescript
'Authorization': `Bearer ${this.accessToken}`
'X-Restli-Protocol-Version': '2.0.0'
'LinkedIn-Version': '202401'
```

Requires:
- Access Token (from LinkedIn OAuth flow)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LINKEDIN_ACCESS_TOKEN` | Access token (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-linkedin/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
