# CLAUDE.md

## Project Overview

`connect-acquire` is a TypeScript connector for the **Acquire.io** API — an all-in-one customer support platform providing live chat, video, co-browsing, chatbot, email, VoIP, and SMS capabilities.

## API Details

- **Base URL**: `https://{account_id}.acquire.io/api/v1` (account-specific subdomain)
- **Fallback**: `https://app.acquire.io/api/v1` (when no account ID is set)
- **Auth**: Bearer token — `Authorization: Bearer <API_KEY>`
- **Docs**: https://developer.acquire.io/

## API Modules

| Module | Class | Endpoints |
|--------|-------|-----------|
| Contacts | `ContactsApi` | CRUD, search, block, merge (`/crm/objects/contact`, `/crm/contact/list`, `/crm/block-visitor`, `/crm/contact/merge`) |
| Cases | `CasesApi` | List, create, reopen, send chat/email/SMS (`/crm/objects/case`, `/crm/messenger/chat`, `/mail/add-message`, `/voip/send-sms`) |
| Companies | `CompaniesApi` | CRUD (`/crm/objects/company`) |
| Notes | `NotesApi` | CRUD (`/crm/objects/note`) |
| Knowledge Base | `KnowledgeBaseApi` | Create groups, update articles (`/kb/group/add`, `/kb/article/update`) |
| Analytics | `AnalyticsApi` | Calls overview, SMS metrics, call analysis (`/analytics/voip/*`) |

## Query Patterns

- **Filtering**: Use `where` parameter with pipe-separated expressions: `column|expression|value` (e.g., `email|=|user@example.com`)
- **Relations**: Pipe-separated relation names to include related objects
- **Select**: Pipe-separated field names to select specific fields

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACQUIRE_API_KEY` | Bearer token for API authentication |
| `ACQUIRE_ACCOUNT_ID` | Account ID for subdomain-based URL |
| `ACQUIRE_TOKEN` | Alias for API key |

## CLI Commands

```bash
connect-acquire contacts list          # List contacts
connect-acquire contacts get <id>      # Get contact by ID
connect-acquire contacts create        # Create contact
connect-acquire contacts update <id>   # Update contact
connect-acquire contacts delete <id>   # Delete contact
connect-acquire contacts search        # Search contacts
connect-acquire contacts merge         # Merge contacts

connect-acquire cases list             # List cases
connect-acquire cases create <cid>     # Create case for contact
connect-acquire cases reopen           # Reopen closed case
connect-acquire cases send-message     # Send chat message
connect-acquire cases send-email       # Send email
connect-acquire cases send-sms         # Send SMS
connect-acquire cases delete-message   # Delete message

connect-acquire companies list         # List companies
connect-acquire companies get <id>     # Get company
connect-acquire companies create       # Create company
connect-acquire companies update <id>  # Update company
connect-acquire companies delete <id>  # Delete company

connect-acquire notes list             # List notes
connect-acquire notes create           # Create note
connect-acquire notes update <id>      # Update note
connect-acquire notes delete <id>      # Delete note

connect-acquire kb create-group        # Create KB group
connect-acquire kb update-article      # Update KB article

connect-acquire analytics calls        # VoIP calls overview
connect-acquire analytics sms          # SMS metrics
connect-acquire analytics call-analysis # Call analysis data
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
