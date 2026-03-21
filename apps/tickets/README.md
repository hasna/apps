# @hasna/tickets

[![npm version](https://img.shields.io/npm/v/@hasna/tickets)](https://www.npmjs.com/package/@hasna/tickets)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-156%20passing-brightgreen)]()

Open-source MCP-native ticketing system — bugs, features, incidents for any product, service, or app.
CLI + MCP server (~45 tools) + REST API + Web Dashboard + SDK.

## Features

- **CLI** — open, list, close, search, comment on tickets from the terminal
- **MCP server** (~45 tools) for Claude, Codex, Gemini and any MCP-compatible AI agent
- **REST API** (Hono, port 19428) with SSE real-time updates
- **Web dashboard** (Vite + React 19) with kanban + table views and duplicate detection
- **SDK** (`@hasna/tickets-sdk`) — HTTP client for external integrations
- **Custom domains** — serve each project on its own domain (`tickets.myapp.com`)
- **Email integration** — AWS SES, Resend, or SMTP; inbound email creates tickets
- **Webhooks** — HMAC-signed events for external integrations
- **SQLite** with WAL mode, FTS5 full-text search, optimistic locking
- **AI-native** — is_ai_opened, ai_confidence, ai_reasoning fields on every ticket
- **SLA tracking** — auto-breach detection with email alerts

## Installation

```bash
bun add -g @hasna/tickets
```

## Quick Start

```bash
# Initialize workspace
tickets init my-workspace

# Create a project
tickets project add "Backend API" --prefix API

# Open your first ticket
tickets open "Login endpoint returns 500 on empty body" \
  --project API --type bug --priority high

# List open tickets
tickets list

# View ticket detail
tickets show API-0001

# Launch web dashboard + API server
tickets serve
```

## MCP Setup

Register the MCP server with your AI agents:

```bash
tickets mcp --claude    # Claude Code
tickets mcp --all       # Claude + Codex + Gemini
```

Then in Claude Code:

```
@tickets create_ticket project_id="<id>" title="Login crash on Safari" type="bug" priority="high"
@tickets list_tickets status="open" per_page=20
@tickets close_ticket id="API-0042" resolution="fixed"
```

## CLI Reference

```bash
# Tickets
tickets open <title> [--project] [--type] [--priority] [--label] [--assignee]
tickets list [--status] [--priority] [--project] [--overdue] [--unassigned]
tickets show <id>
tickets update <id> [--title] [--priority] [--status] [--assignee]
tickets close <id> --resolution fixed|wont_fix|duplicate|invalid|by_design
tickets reopen <id>
tickets assign <id> --to <agent>

# Comments
tickets comment <id> <text> [--internal]
tickets comments <id>

# Relations
tickets link <id> --blocks|--duplicates|--relates-to <id>

# Search
tickets search <query> [--project] [--status]

# Projects
tickets project add <name> [--prefix] [--description]
tickets project list
tickets project show <id>

# Labels & Milestones
tickets label add <name> [--color] [--project]
tickets milestone add <name> [--due YYYY-MM-DD] [--project]
tickets milestone close <id>

# Custom Domains
tickets domain add <domain> --project <id>
tickets domain verify <domain>
tickets domain list

# Email
tickets email config --provider ses|resend|smtp --from <email>
tickets email inbound-url --project <id>

# Server
tickets serve [--port 19428]
tickets mcp --claude|--codex|--gemini|--all
```

## REST API

Base URL: `http://localhost:19428/api`
Auth: `X-API-Key: <key>` or `Authorization: Bearer <key>`

```
GET    /api/tickets                     List with filters
POST   /api/tickets                     Create ticket
GET    /api/tickets/:id                 Get by UUID or short ID (API-0042)
PATCH  /api/tickets/:id                 Update fields
DELETE /api/tickets/:id                 Delete
POST   /api/tickets/:id/close           Close with resolution
POST   /api/tickets/:id/reopen          Reopen
POST   /api/tickets/:id/assign          Assign to agent
POST   /api/tickets/batch               Bulk create/update
GET    /api/tickets/search?q=...        Full-text search
GET    /api/tickets/similar?title=...   Duplicate detection
GET    /api/tickets/:id/comments        List comments
POST   /api/tickets/:id/comments        Add comment
GET    /api/tickets/:id/activity        Audit log
GET    /api/tickets/:id/relations       Ticket relations
POST   /api/tickets/:id/relations       Link tickets

GET    /api/projects                    List projects
POST   /api/projects                    Create project
GET    /api/projects/:id/stats          Ticket counts by status
GET    /api/projects/:id/labels         List labels
POST   /api/projects/:id/labels         Create label
GET    /api/projects/:id/milestones     List milestones
POST   /api/projects/:id/milestones     Create milestone

GET    /api/agents                      List agents
POST   /api/agents                      Register agent

GET    /api/webhooks                    List webhooks
POST   /api/webhooks                    Create webhook
POST   /api/webhooks/:id/test           Test webhook

GET    /api/domains                     List custom domains
POST   /api/domains                     Add domain
POST   /api/domains/:id/verify          Mark as verified

POST   /api/auth/keys                   Create API key
DELETE /api/auth/keys/:id               Revoke key

GET    /sse                             Server-sent events stream
```

Response envelope: `{ data: T, meta?: { total, page, per_page }, error: null }`

## SDK

```typescript
import { TicketsClient } from '@hasna/tickets-sdk'

const client = new TicketsClient({
  baseUrl: 'http://localhost:19428',
  apiKey: process.env.TICKETS_API_KEY,
})

// Create a ticket
const ticket = await client.tickets.create({
  project_id: 'proj_xyz',
  title: 'API times out on large payloads',
  type: 'bug',
  priority: 'high',
})

// Check for duplicates first
const similar = await client.tickets.similar(ticket.title, 'proj_xyz')

// Add a comment
await client.tickets.comment(ticket.id, 'Investigating now.')

// Close as fixed
await client.tickets.close(ticket.id, 'fixed')
```

Verify webhook signatures:

```typescript
import { verifyWebhookSignature } from '@hasna/tickets-sdk'

app.post('/webhook', async (req, res) => {
  const sig = req.headers['x-tickets-signature']
  const valid = await verifyWebhookSignature(req.body, sig, process.env.WEBHOOK_SECRET)
  if (!valid) return res.status(401).send('Invalid signature')
  // handle event...
})
```

## Environment Variables

```env
# Database
TICKETS_DB_PATH=~/.tickets/tickets.db    # SQLite path (default: ~/.tickets/tickets.db)

# Server
PORT=19428
TICKETS_BASE_URL=https://tickets.myapp.com

# Email
EMAIL_PROVIDER=ses                        # ses | resend | smtp | console (default)
TICKETS_FROM_EMAIL=support@myapp.com
TICKETS_REPLY_SECRET=<random-32-char>     # for reply-to threading

# AWS SES
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Resend
RESEND_API_KEY=re_...

# SMTP
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...

# Domains
TICKETS_DOMAIN_SECRET=<random-32-char>    # for DNS verification tokens
```

## Custom Domains

Each project can be served on its own domain:

```bash
# 1. Add domain
tickets domain add tickets.acme.com --project <id>
# Shows: Add DNS TXT record _tickets-verify.tickets.acme.com = tickets-verify=abc123...

# 2. Add the TXT record to your DNS provider

# 3. Verify
tickets domain verify tickets.acme.com

# 4. Point CNAME to your server
# tickets.acme.com CNAME → your-server.example.com
```

Incoming email: `support@tickets.acme.com` → creates ticket
Replies: `reply+API-0042+<token>@tickets.acme.com` → adds comment

## Email Integration

```bash
# AWS SES
tickets email config --provider ses --from support@myapp.com
# Register inbound webhook in SES console:
tickets email inbound-url --project <id>
# → http://yourserver/api/email/inbound/ses?project_id=<id>

# Resend
tickets email config --provider resend --from support@myapp.com
# Register in Resend dashboard:
tickets email inbound-url --project <id>
# → http://yourserver/api/email/inbound/resend?project_id=<id>
```

## Webhook Events

| Event | Description |
|-------|-------------|
| `ticket.created` | New ticket opened |
| `ticket.updated` | Any field changed |
| `ticket.closed` | Ticket closed with resolution |
| `ticket.reopened` | Ticket reopened |
| `ticket.assigned` | Assignee changed |
| `ticket.status_changed` | Status transition |
| `comment.created` | New comment posted |
| `milestone.closed` | Milestone marked closed |

All webhooks include `X-Tickets-Signature: sha256=<hmac>` for verification.

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Database | SQLite (bun:sqlite, WAL, FTS5) |
| API | Hono |
| CLI | Commander.js + React/Ink |
| Dashboard | Vite + React 19 + TailwindCSS 4 + Radix UI |
| MCP | @modelcontextprotocol/sdk |

## License

Apache-2.0 — Andrei Hasna &lt;andrei@hasna.com&gt;
