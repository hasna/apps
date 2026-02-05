# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-notion is a TypeScript connector for the Notion API with OAuth2 and internal integration support. It provides both a CLI and a programmatic API for managing Pages, Databases, Blocks, Comments, Users, and more with multi-profile configuration support.

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
│   ├── index.ts   # Main connector class
│   ├── databases.ts # Database & property management
│   ├── pages.ts   # Page operations
│   ├── blocks.ts  # Block operations
│   ├── comments.ts # Comment operations
│   ├── users.ts   # User operations
│   ├── search.ts  # Search functionality
│   ├── bulk.ts    # Bulk operations
│   └── export.ts  # Markdown export
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   ├── auth.ts    # OAuth2 authentication
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

Two authentication methods supported:
- **Internal Integration Token**: `connect-notion config set-key <token>`
- **OAuth2**: `connect-notion auth login` (requires client credentials)

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-notion/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Service APIs

- **DatabasesApi**: List, get, create, update, query databases; manage properties (add, rename, delete)
- **PagesApi**: List, get, create, update, delete pages; set property values
- **BlocksApi**: List, get, create, update, delete blocks (paragraphs, headings, lists, etc.)
- **CommentsApi**: List, create comments
- **UsersApi**: List, get users, get current bot user
- **SearchApi**: Search pages and databases
- **BulkApi**: Bulk update operations with filtering
- **ExportApi**: Export pages/databases to Markdown

## CLI Commands

### Authentication
```bash
connect-notion auth login              # OAuth2 login
connect-notion auth status             # Check auth status
connect-notion auth logout             # Clear tokens
connect-notion config set-key <token>  # Set integration token
```

### Databases
```bash
connect-notion databases list          # List all databases
connect-notion databases get <id>      # Get database
connect-notion databases query <id>    # Query database
connect-notion databases create <parentId> <title>  # Create database
```

### Database Properties (NEW)
```bash
connect-notion databases props list <databaseId>    # List all properties
connect-notion databases props add <databaseId> <name> <type>  # Add property
connect-notion databases props rename <databaseId> <old> <new>  # Rename property
connect-notion databases props delete <databaseId> <name>  # Delete property
connect-notion databases props add-option <databaseId> <prop> <option>  # Add select option
connect-notion databases props add-formula <databaseId> <name> <expr>  # Add formula
connect-notion databases props add-relation <databaseId> <name> <relatedDb>  # Add relation
connect-notion databases props add-rollup <databaseId> <name> --relation <rel> --property <prop> --function <fn>
```

### Property Types
- `title`, `rich_text`, `number`, `select`, `multi_select`, `status`
- `date`, `people`, `files`, `checkbox`, `url`, `email`, `phone_number`
- `formula`, `relation`, `rollup`
- `created_time`, `created_by`, `last_edited_time`, `last_edited_by`

### Pages
```bash
connect-notion pages list              # List all pages
connect-notion pages get <id>          # Get page
connect-notion pages create <parentId> <title>  # Create page
connect-notion pages update <id> --title <title> --icon <emoji>
connect-notion pages set-property <id> <prop> <value>  # Set property value
connect-notion pages delete <id>       # Archive page
```

### Blocks
```bash
connect-notion blocks list <pageId>    # List blocks
connect-notion blocks get <id>         # Get block
connect-notion blocks create <parentId> <type> <content>
connect-notion blocks update <id> <content>
connect-notion blocks delete <id>
```

### Search
```bash
connect-notion search <query>          # Search all
connect-notion search <query> --pages  # Search pages only
connect-notion search <query> --databases  # Search databases only
```

### Bulk Operations
```bash
connect-notion bulk schema <databaseId>  # Show database schema
connect-notion bulk preview -d <databaseId> -w "Status=Done"  # Preview matching pages
connect-notion bulk update -d <databaseId> -w "Status=Done" -s "Type=Archive"
```

### Export
```bash
connect-notion export page <id> -o ./output
connect-notion export database <id> -o ./output
connect-notion export workspace -o ./output
```

### Profiles
```bash
connect-notion profiles list           # List profiles
connect-notion profiles create <name>  # Create profile
connect-notion profiles switch <name>  # Switch profile
connect-notion profiles delete <name>  # Delete profile
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NOTION_API_KEY` | Internal integration token |
| `NOTION_CLIENT_ID` | OAuth2 client ID |
| `NOTION_CLIENT_SECRET` | OAuth2 client secret |

## Data Storage

```
~/.connect/connect-notion/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "accessToken": "<token>",
  "workspaceId": "xxx",
  "workspaceName": "My Workspace",
  "botId": "xxx"
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
- open: Browser opening for OAuth

## API Reference

Based on Notion API version 2022-06-28 and later.

Sources:
- [Notion API - Update database properties](https://developers.notion.com/reference/update-property-schema-object)
- [Notion API - Update a database](https://developers.notion.com/reference/update-a-database)
- [Working with databases](https://developers.notion.com/docs/working-with-databases)
