# AGENTS.md

Guidance for AI agents working with connect-notion.

## Overview

Notion API connector with full CRUD support for pages, databases, blocks, comments, and database properties.

## Quick Commands

```bash
bun install          # Install dependencies
bun run dev          # Run CLI
bun run build        # Build
bun run typecheck    # Type check
```

## Key Features

- **Database Property Management**: Add, rename, delete properties (columns)
- **Page Operations**: Create, read, update, archive pages
- **Block Operations**: All block types supported
- **Bulk Operations**: Update multiple pages at once
- **Export**: Export to Markdown
- **Multi-Profile**: Support multiple workspaces

## Property Types

```bash
# Basic types
title, rich_text, number, select, multi_select, status
date, people, files, checkbox, url, email, phone_number

# Computed types
formula, relation, rollup

# Auto types
created_time, created_by, last_edited_time, last_edited_by
```

## Common Operations

```bash
# Add select property with options
connect-notion databases props add <db> "Status" select --options "A,B,C"

# Add formula
connect-notion databases props add-formula <db> "Total" "prop(\"A\") + prop(\"B\")"

# Add relation
connect-notion databases props add-relation <db> "Tasks" <related-db-id>

# Bulk update
connect-notion bulk update -d <db> -w "Status=Done" -s "Archive=true"
```

## API Structure

```
notion.databases.addProperty(dbId, name, config)
notion.databases.renameProperty(dbId, oldName, newName)
notion.databases.deleteProperty(dbId, name)
notion.databases.addSelectOption(dbId, propName, optionName, color)
notion.databases.addFormulaProperty(dbId, name, expression)
notion.databases.addRelationProperty(dbId, name, relatedDbId, options)
notion.databases.addRollupProperty(dbId, name, relation, property, function)
```

## Environment

| Variable | Description |
|----------|-------------|
| `NOTION_API_KEY` | Integration token |
| `NOTION_CLIENT_ID` | OAuth client ID |
| `NOTION_CLIENT_SECRET` | OAuth secret |
