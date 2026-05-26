# connect-notion

Notion API connector CLI - Manage pages, databases, blocks, and properties with full CRUD support.

## Installation

```bash
bun add @hasna/connect-notion
```

Or install via the connectors CLI:
```bash
npx @hasna/connectors install notion
```

## Authentication

### Internal Integration Token (Recommended)
```bash
connect-notion config set-key <your-integration-token>
```

### OAuth2
```bash
# First set client credentials
connect-notion config set-credentials <client-id> <client-secret>

# Then login
connect-notion auth login
```

## Quick Start

```bash
# Check authentication
connect-notion auth status

# List all databases
connect-notion databases list

# Search for pages
connect-notion search "meeting notes"

# Get a specific page
connect-notion pages get <page-id>
```

## Database Property Management

The connector provides full support for managing database properties (columns):

```bash
# List all properties in a database
connect-notion databases props list <database-id>

# Add a text property
connect-notion databases props add <database-id> "Description" rich_text

# Add a select property with options
connect-notion databases props add <database-id> "Status" select --options "To Do,In Progress,Done"

# Add a number property with currency format
connect-notion databases props add <database-id> "Price" number --format dollar

# Add a formula property
connect-notion databases props add-formula <database-id> "Total" "prop(\"Price\") * prop(\"Quantity\")"

# Add a relation property
connect-notion databases props add-relation <database-id> "Related Tasks" <other-database-id>

# Add a rollup property
connect-notion databases props add-rollup <database-id> "Task Count" \
  --relation "Related Tasks" \
  --property "Name" \
  --function count

# Rename a property
connect-notion databases props rename <database-id> "Old Name" "New Name"

# Delete a property
connect-notion databases props delete <database-id> "Property Name"

# Add an option to a select property
connect-notion databases props add-option <database-id> "Status" "Blocked" --color red
```

### Supported Property Types

| Type | Description |
|------|-------------|
| `title` | Title property (required, one per database) |
| `rich_text` | Text with formatting |
| `number` | Numbers with optional format |
| `select` | Single select with options |
| `multi_select` | Multiple select with options |
| `status` | Status with groups |
| `date` | Date/datetime |
| `people` | User references |
| `files` | File attachments |
| `checkbox` | Boolean checkbox |
| `url` | URL links |
| `email` | Email addresses |
| `phone_number` | Phone numbers |
| `formula` | Computed values |
| `relation` | Links to other databases |
| `rollup` | Aggregated values from relations |
| `created_time` | Auto-set creation time |
| `created_by` | Auto-set creator |
| `last_edited_time` | Auto-set last edit time |
| `last_edited_by` | Auto-set last editor |

## Page Operations

```bash
# List pages
connect-notion pages list

# Create a page
connect-notion pages create <parent-page-id> "My New Page" --content "Page content here"

# Update page properties
connect-notion pages set-property <page-id> "Status" "Done" --type select

# Archive a page
connect-notion pages delete <page-id>
```

## Block Operations

```bash
# List blocks in a page
connect-notion blocks list <page-id>

# Add a paragraph
connect-notion blocks create <page-id> paragraph "This is a paragraph"

# Add a heading
connect-notion blocks create <page-id> heading_1 "My Heading"

# Add a to-do item
connect-notion blocks create <page-id> to_do "Task to complete" --checked

# Add code block
connect-notion blocks create <page-id> code "console.log('Hello')" --language javascript
```

## Bulk Operations

```bash
# Preview pages matching a filter
connect-notion bulk preview -d <database-id> -w "Status=Done"

# Bulk update pages
connect-notion bulk update -d <database-id> -w "Status=Done" -s "Archived=true"

# Show database schema
connect-notion bulk schema <database-id>
```

## Export to Markdown

```bash
# Export a page
connect-notion export page <page-id> -o ./output

# Export entire database
connect-notion export database <database-id> -o ./output

# Export workspace
connect-notion export workspace -o ./output
```

## Multi-Profile Support

```bash
# Create a new profile
connect-notion profiles create work

# Switch profiles
connect-notion profiles switch work

# List profiles
connect-notion profiles list

# Use profile for single command
connect-notion --profile personal databases list
```

## Programmatic Usage

```typescript
import { Notion } from '@hasna/connect-notion';

// Create client
const notion = new Notion({ accessToken: process.env.NOTION_API_KEY });

// Or use factory method (reads from config)
const notion = Notion.create();

// Database operations
const databases = await notion.databases.list();
const db = await notion.databases.get('database-id');

// Add a property to database
await notion.databases.addProperty('database-id', 'Priority', {
  select: {
    options: [
      { name: 'High', color: 'red' },
      { name: 'Medium', color: 'yellow' },
      { name: 'Low', color: 'green' }
    ]
  }
});

// Rename a property
await notion.databases.renameProperty('database-id', 'Old Name', 'New Name');

// Delete a property
await notion.databases.deleteProperty('database-id', 'Unused Property');

// Query database
const pages = await notion.databases.query('database-id', {
  filter: { property: 'Status', select: { equals: 'Done' } }
});

// Page operations
const page = await notion.pages.get('page-id');
await notion.pages.setSelect('page-id', 'Status', 'In Progress');

// Block operations
await notion.blocks.appendParagraph('page-id', 'New paragraph content');
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NOTION_API_KEY` | Internal integration token |
| `NOTION_CLIENT_ID` | OAuth2 client ID |
| `NOTION_CLIENT_SECRET` | OAuth2 client secret |

## License

MIT
