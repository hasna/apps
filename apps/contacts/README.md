# @hasna/contacts

Contact management for AI coding agents — CLI + MCP server + Web dashboard

A modern rolodex for AI agents and humans. Store contacts, companies, tags, relationships, social profiles, and more.

## Features

- **MCP server** — 24 tools for AI agents (Claude, Codex, Gemini)
- **CLI** — beautiful terminal interface
- **Web dashboard** — React/Vite UI
- **Rich data model** — contacts, companies, tags, relationships, emails, phones, addresses, social profiles
- **Import/Export** — CSV, vCard (.vcf), JSON
- **Full-text search** — FTS5-powered search
- **SQLite** — zero-config, file-based storage at `~/.contacts/contacts.db`

## Install

```bash
bun install -g @hasna/contacts
# or
npm install -g @hasna/contacts
```

## CLI Usage

```bash
contacts add                    # Add a contact interactively
contacts list                   # List all contacts
contacts list --tag vip         # Filter by tag
contacts show <id>              # Show contact details
contacts search "John"          # Search contacts
contacts edit <id>              # Edit a contact
contacts delete <id>            # Delete a contact
contacts import contacts.csv    # Import from CSV/vCard/JSON
contacts export --format vcf    # Export as vCard
contacts companies              # List companies
contacts tags                   # Manage tags
contacts serve                  # Start web dashboard
contacts mcp                    # Show MCP setup
```

## MCP Setup

Add to your Claude Code config:
```bash
claude mcp add --transport stdio --scope user contacts -- contacts-mcp
```

Or add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "contacts": {
      "command": "contacts-mcp",
      "args": []
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_contact` | Create a new contact |
| `get_contact` | Get contact by ID |
| `update_contact` | Update contact fields |
| `delete_contact` | Delete a contact |
| `list_contacts` | List contacts with filters |
| `search_contacts` | Full-text search |
| `create_company` | Create a company |
| `get_company` | Get company by ID |
| `list_companies` | List companies |
| `search_companies` | Search companies |
| `create_tag` | Create a tag |
| `list_tags` | List all tags |
| `add_tag_to_contact` | Tag a contact |
| `add_relationship` | Link contacts |
| `merge_contacts` | Merge duplicate contacts |
| `import_contacts` | Import CSV/vCard/JSON |
| `export_contacts` | Export contacts |
| `get_stats` | Get database stats |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTACTS_DB_PATH` | `~/.contacts/contacts.db` | SQLite database path |

## License

Apache-2.0 © Andrei Hasna
