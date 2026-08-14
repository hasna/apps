# GEMINI.md

Guidance for Gemini AI when working with connect-notion.

## Project

Notion API connector - TypeScript CLI and library for Notion.

## Commands

```bash
bun install && bun run dev    # Development
bun run build                 # Build
bun run typecheck             # Type check
```

## Features

- Pages: CRUD operations
- Databases: CRUD + property management
- Blocks: All block types
- Bulk: Mass updates with filters
- Export: Markdown export

## Property Management

```bash
# Add property
connect-notion databases props add <db> <name> <type> [--options]

# Types: title, rich_text, number, select, multi_select, status,
#        date, people, files, checkbox, url, email, phone_number,
#        formula, relation, rollup, created_time, created_by,
#        last_edited_time, last_edited_by

# Rename
connect-notion databases props rename <db> <old> <new>

# Delete
connect-notion databases props delete <db> <name>
```

## Auth

```bash
connect-notion config set-key <token>  # Integration token
connect-notion auth login              # OAuth2
```

## Environment

- `NOTION_API_KEY` - Integration token
- `NOTION_CLIENT_ID` - OAuth client ID
- `NOTION_CLIENT_SECRET` - OAuth secret
