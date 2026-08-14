# open-tickets — Architecture & Implementation Plan

> **What it is:** Open-source ticketing system where people and AI agents can open, triage,
> and resolve tickets for any product, service, or app. Think GitHub Issues + Linear + Sentry
> — but MCP-native, agent-first, and self-hostable.

---

## 1. Product Vision

`open-tickets` is the issue tracker in the `open-*` ecosystem. It is distinct from `open-todos`
(internal AI agent task management) — this is the **public-facing layer** where:

- End users report bugs and request features
- External agents (monitoring bots, AI triage agents) open incident tickets
- Developers and AI agents resolve, triage, and close tickets
- Products/services/apps each have their own ticket queue

The system exposes four independent surfaces sharing a single SQLite database:

| Surface | Entrypoint | Audience |
|---------|------------|----------|
| **MCP server** | `tickets-mcp` | AI agents (Claude, Codex, Gemini) |
| **REST API** | `tickets-serve` | SDK, integrations, webhooks |
| **Web UI** | `tickets-serve` + dashboard | Human operators, reporters |
| **CLI** | `tickets` | Developers, CI pipelines |
| **SDK** | `@hasna/tickets` (library) | External apps embedding tickets |

---

## 2. Tech Stack

Same foundation as the `open-*` ecosystem:

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | **Bun** | Fast startup, native SQLite, TypeScript-first |
| Language | **TypeScript** (strict) | Consistent with ecosystem |
| Database | **SQLite** (bun:sqlite, WAL) | Zero-dependency, portable, proven in open-todos |
| CLI | **Commander.js + React/Ink** | Interactive TUI, matches open-todos pattern |
| Web UI | **Vite + React 19 + TailwindCSS 4 + Radix UI** | Matches open-todos dashboard |
| API | **Hono** (HTTP, port 19428) | Lightweight, TypeScript-native |
| MCP | **@modelcontextprotocol/sdk** | stdio transport, same as open-todos |
| Validation | **Zod** | Schema validation for all inputs |
| Search | **SQLite FTS5** | Full-text search, no extra service |
| Auth | **API Key + Bearer token** | Simple, agent-friendly |

Port: **19428** (open-todos is 19427)

---

## 3. Data Model

### 3.1 Entity Hierarchy

```
Workspace
  └── Project (product/service/app)
        └── Ticket
              ├── Comment
              ├── TicketRelation (blocks/duplicates/relates-to)
              ├── Activity (audit log)
              └── Attachment (file reference)

Milestone (spans a project, groups tickets into releases)
Label (project-scoped tags)
Webhook (project or workspace-level event subscriptions)
Agent (registered identity — human or AI)
```

### 3.2 Core Entities

#### Workspace
```typescript
{
  id: string          // UUID
  name: string        // "Acme Corp"
  slug: string        // "acme-corp" (URL-safe)
  created_at: string
}
```

#### Project
```typescript
{
  id: string          // UUID
  workspace_id: string
  name: string        // "Backend API"
  slug: string        // "backend-api"
  ticket_prefix: string  // "API" → tickets become "API-0001"
  ticket_counter: number // auto-increment
  description: string
  icon: string        // emoji or URL
  is_public: boolean  // public submission without auth
  created_at: string
  updated_at: string
}
```

#### Ticket (core entity)
```typescript
{
  // Identity
  id: string              // UUID
  short_id: string        // "API-0042" (auto-generated)
  project_id: string
  workspace_id: string

  // Content
  title: string           // max 255 chars
  description: string     // markdown, max 64KB
  type: TicketType        // bug | feature | question | incident | improvement | task

  // Workflow
  status: TicketStatus    // open | in_progress | in_review | resolved | closed
  resolution: Resolution  // null | fixed | wont_fix | duplicate | invalid | by_design
  priority: Priority      // none | low | medium | high | critical
  severity: Severity      // null | minor | moderate | major | critical | blocker

  // Assignment
  reporter_id: string     // who opened it (agent or human)
  assignee_id: string     // who's resolving it
  milestone_id: string    // release/sprint association

  // Metadata
  labels: string[]        // JSON array of label IDs
  custom_fields: object   // JSON, flexible domain-specific data
  source: string          // "web" | "api" | "mcp" | "cli" | "email" | "webhook"
  external_id: string     // link to external system (GitHub issue, Sentry error)
  external_url: string

  // Agent info
  is_ai_opened: boolean   // opened by AI agent
  ai_confidence: number   // 0-1, if AI-triaged
  ai_reasoning: string    // why AI set the priority/assignee

  // Timing
  due_date: string
  created_at: string
  updated_at: string
  resolved_at: string
  closed_at: string

  // SLA
  sla_minutes: number     // expected resolution time
  sla_breached: boolean   // auto-set when overdue

  // Duplicate tracking
  duplicate_of: string    // ticket ID this is a duplicate of

  // Optimistic locking
  version: number
}
```

#### TicketStatus State Machine
```
         ┌──────────────────────────────────────────────┐
         │                                              │
    open ──→ in_progress ──→ in_review ──→ resolved ──→ closed
     │            │               │           │
     │       won't_fix        duplicate     fixed
     │       invalid          by_design     wont_fix
     └───────────────────────────────────────▼
                                          (re-open allowed)
```

Valid transitions:
- `open` → `in_progress`, `resolved`, `closed`
- `in_progress` → `in_review`, `resolved`, `closed`, `open`
- `in_review` → `in_progress`, `resolved`, `closed`
- `resolved` → `closed`, `open` (re-open)
- `closed` → `open` (re-open)

Transition metadata: who changed it, when, comment attached.

#### Comment
```typescript
{
  id: string
  ticket_id: string
  author_id: string
  content: string       // markdown
  is_internal: boolean  // internal note (not visible to reporter)
  type: string          // comment | status_change | assignment | ai_suggestion
  metadata: object      // structured data for non-comment types
  created_at: string
  updated_at: string
}
```

#### TicketRelation
```typescript
{
  id: string
  ticket_id: string
  related_ticket_id: string
  relation_type: string  // blocks | blocked_by | duplicates | relates_to | caused_by
  created_at: string
  created_by: string
}
```

#### Activity (Audit Log)
```typescript
{
  id: string
  ticket_id: string
  agent_id: string
  action: string        // created | status_changed | assigned | commented | labeled | ...
  from_value: string    // previous value (JSON)
  to_value: string      // new value (JSON)
  is_ai_action: boolean
  ai_confidence: number
  ai_reasoning: string
  created_at: string
}
```

#### Agent (human or AI identity)
```typescript
{
  id: string            // 8-char UUID slice
  name: string          // unique, human-readable
  type: string          // human | ai_agent
  email: string         // for humans
  api_key: string       // hashed
  permissions: string[] // read | write | admin
  created_at: string
  last_seen_at: string
}
```

#### Label
```typescript
{
  id: string
  project_id: string
  name: string          // "bug", "enhancement", "question"
  color: string         // hex color
  description: string
}
```

#### Milestone
```typescript
{
  id: string
  project_id: string
  name: string          // "v1.0", "Q1 2026"
  description: string
  due_date: string
  status: string        // open | closed
  created_at: string
}
```

#### Webhook
```typescript
{
  id: string
  workspace_id: string
  project_id: string    // null = workspace-wide
  url: string           // target URL
  secret: string        // HMAC signing key
  events: string[]      // ["ticket.created", "ticket.closed", ...]
  is_active: boolean
  last_triggered_at: string
  failure_count: number
  created_at: string
}
```

---

## 4. MCP Server (tickets-mcp)

~45 tools across 8 categories. Transport: stdio.

### 4.1 Tool Categories

#### Ticket Operations
| Tool | Description |
|------|-------------|
| `create_ticket` | Open a new ticket (type, title, description, priority, labels) |
| `get_ticket` | Get ticket by ID or short_id (API-0042) |
| `update_ticket` | Update any field (title, status, priority, assignee, ...) |
| `close_ticket` | Close with resolution (fixed, wont_fix, duplicate, invalid) |
| `reopen_ticket` | Reopen a closed/resolved ticket with reason |
| `assign_ticket` | Assign to agent/user |
| `set_priority` | Set priority (none/low/medium/high/critical) |
| `set_severity` | Set severity (minor/moderate/major/critical/blocker) |
| `add_label` | Add label(s) to ticket |
| `remove_label` | Remove label(s) from ticket |
| `link_tickets` | Create relation (blocks, duplicates, relates_to) |
| `unlink_tickets` | Remove ticket relation |
| `set_milestone` | Assign to milestone |
| `list_tickets` | List with filters (status, priority, assignee, label, date range) |
| `search_tickets` | Full-text search across titles + descriptions |
| `get_similar_tickets` | Find semantically similar tickets (duplicate detection) |
| `bulk_create_tickets` | Create multiple tickets from a list |
| `bulk_update_tickets` | Batch update status/priority/assignee |

#### Comments
| Tool | Description |
|------|-------------|
| `add_comment` | Post comment to ticket (public or internal note) |
| `get_comments` | List all comments on a ticket |
| `update_comment` | Edit own comment |
| `delete_comment` | Delete own comment |
| `suggest_resolution` | AI agent posts resolution suggestion (internal note with reasoning) |

#### Projects
| Tool | Description |
|------|-------------|
| `create_project` | Create new project/product |
| `get_project` | Get project details and stats |
| `list_projects` | List all projects in workspace |
| `update_project` | Update name, description, icon |
| `get_project_stats` | Ticket counts by status, open rate, avg resolution time |

#### Labels & Milestones
| Tool | Description |
|------|-------------|
| `create_label` | Create label with name and color |
| `list_labels` | List project labels |
| `create_milestone` | Create milestone with due date |
| `list_milestones` | List milestones (open/closed) |
| `close_milestone` | Close milestone when release ships |

#### Agents
| Tool | Description |
|------|-------------|
| `register_agent` | Register identity (idempotent by name) |
| `get_agent` | Get agent by name or ID |
| `list_agents` | List registered agents |
| `get_my_tickets` | Get tickets assigned to the calling agent |
| `claim_ticket` | Claim unassigned ticket + lock for processing |

#### Webhooks
| Tool | Description |
|------|-------------|
| `create_webhook` | Register webhook URL for event subscriptions |
| `list_webhooks` | List active webhooks |
| `delete_webhook` | Remove webhook |
| `test_webhook` | Send test event to verify webhook URL |

#### Search & Analytics
| Tool | Description |
|------|-------------|
| `search_tickets` | FTS across title + description |
| `get_stats` | Workspace/project-level ticket stats |
| `get_ticket_activity` | Full audit log for a ticket |
| `get_open_tickets` | Get all open tickets (paginable) |
| `get_overdue_tickets` | SLA-breached or past due date |
| `get_unassigned_tickets` | Open tickets with no assignee |

#### Bootstrap
| Tool | Description |
|------|-------------|
| `bootstrap` | Initialize workspace with a project + default labels |
| `get_context` | Get agent's current focus (project, recent tickets) |
| `set_context` | Set agent's working project context |

### 4.2 MCP Resources

- `tickets://projects` — list of all projects
- `tickets://tickets` — current open tickets (paginated)
- `tickets://labels` — all labels
- `tickets://agents` — registered agents

---

## 5. REST API

Base URL: `http://localhost:19428/api`

Auth: `X-API-Key: <key>` or `Authorization: Bearer <key>`

### 5.1 Endpoints

```
# Workspace
GET    /workspaces
POST   /workspaces
GET    /workspaces/:id

# Projects
GET    /projects
POST   /projects
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id
GET    /projects/:id/stats

# Tickets
GET    /tickets                         # list with filters
POST   /tickets                         # create
GET    /tickets/:id                     # get (by UUID or short_id)
PATCH  /tickets/:id                     # update
DELETE /tickets/:id                     # delete
POST   /tickets/:id/close               # close with resolution
POST   /tickets/:id/reopen              # reopen
POST   /tickets/:id/assign              # assign to agent
POST   /tickets/batch                   # bulk create/update
GET    /tickets/search?q=...            # full-text search
GET    /tickets/:id/activity            # audit log
GET    /tickets/:id/relations           # ticket relations

# Comments
GET    /tickets/:id/comments
POST   /tickets/:id/comments
PATCH  /tickets/:id/comments/:cid
DELETE /tickets/:id/comments/:cid

# Relations
POST   /tickets/:id/relations           # link tickets
DELETE /tickets/:id/relations/:rid      # unlink

# Labels
GET    /projects/:id/labels
POST   /projects/:id/labels
PATCH  /projects/:id/labels/:lid
DELETE /projects/:id/labels/:lid

# Milestones
GET    /projects/:id/milestones
POST   /projects/:id/milestones
PATCH  /projects/:id/milestones/:mid
POST   /projects/:id/milestones/:mid/close

# Agents
GET    /agents
POST   /agents                          # register
GET    /agents/:id
GET    /agents/:id/tickets              # assigned tickets

# Webhooks
GET    /webhooks
POST   /webhooks
DELETE /webhooks/:id
POST   /webhooks/:id/test

# Auth (API keys)
POST   /auth/keys                       # create API key
DELETE /auth/keys/:id                   # revoke key
GET    /auth/keys                       # list keys

# Stats
GET    /stats                           # workspace-wide
GET    /projects/:id/stats              # project-specific
```

### 5.2 Response Format

Consistent envelope:
```json
{
  "data": { ... },        // or array
  "meta": {
    "total": 100,
    "page": 1,
    "per_page": 25,
    "cursor": "..."
  },
  "error": null
}
```

Compact mode via `?fields=id,title,status` to minimize response size for agents.

### 5.3 Webhook Event Payload

```json
{
  "event": "ticket.created",
  "timestamp": "2026-03-21T09:00:00Z",
  "webhook_id": "wh_abc123",
  "project_id": "proj_xyz",
  "data": { ...ticket },
  "actor": { "id": "...", "name": "...", "type": "ai_agent" }
}
```

Events:
- `ticket.created`, `ticket.updated`, `ticket.closed`, `ticket.reopened`
- `ticket.assigned`, `ticket.priority_changed`, `ticket.status_changed`
- `comment.created`, `comment.updated`
- `milestone.closed`

HMAC-SHA256 signature in `X-Tickets-Signature` header.

---

## 6. Web Dashboard

**Port**: 19428 (served from same Hono server, `/` → Vite SPA)
**Tech**: Vite + React 19 + TailwindCSS 4 + Radix UI + TanStack Query

### 6.1 Pages

| Route | Description |
|-------|-------------|
| `/` | Workspace overview: recent tickets, stats, open projects |
| `/projects` | All projects with ticket counts |
| `/projects/:slug` | Project view with kanban / list / table toggle |
| `/projects/:slug/tickets/new` | Submit new ticket form |
| `/tickets/:short_id` | Ticket detail: comments, activity, relations, edit |
| `/milestones` | Milestones list with progress bars |
| `/agents` | Registered agents and their assigned tickets |
| `/webhooks` | Webhook management |
| `/settings` | API keys, workspace settings, labels |
| `/search` | Full-text search across all tickets |

### 6.2 Key UI Features

- **Kanban board**: drag-and-drop tickets across status columns
- **Table view**: sortable, filterable, bulk-selectable
- **Real-time**: tickets update live (WebSocket or SSE from server)
- **Markdown editor**: description and comments support MDX
- **Duplicate detector**: shows similar open tickets while you type the title
- **Activity timeline**: full history of changes visible on ticket detail
- **AI badge**: tickets opened by AI agents get a distinct visual indicator
- **Quick filter**: status, priority, assignee, label, unassigned, overdue
- **Keyboard shortcuts**: `/` to search, `n` to new ticket, `ESC` to go back

---

## 7. SDK (`@hasna/tickets`)

Standalone Node.js/Bun package — HTTP client for the API.

```typescript
import { TicketsClient } from '@hasna/tickets'

const client = new TicketsClient({
  baseUrl: 'http://localhost:19428',
  apiKey: process.env.TICKETS_API_KEY,
})

// Open a ticket
const ticket = await client.tickets.create({
  project: 'backend-api',
  type: 'bug',
  title: 'API returns 500 on empty body',
  description: '...',
  priority: 'high',
})

// Search for similar tickets before creating
const similar = await client.tickets.similar(ticket.title)

// Add a comment
await client.tickets.comment(ticket.id, 'Looking into this now.')

// Close as fixed
await client.tickets.close(ticket.id, { resolution: 'fixed' })
```

Exports: `TicketsClient`, all Zod schemas, TypeScript types, webhook helper (HMAC verifier).

---

## 8. CLI (`tickets`)

Commander.js + React/Ink TUI.

```bash
# Initialize workspace
tickets init my-workspace

# Create a project
tickets project add "Backend API" --prefix API

# Open a ticket
tickets open "Login endpoint returns 500 on invalid body" \
  --project API --type bug --priority high

# List open tickets
tickets list --project API --status open

# View ticket detail
tickets show API-0042

# Update status
tickets update API-0042 --status in_progress
tickets close API-0042 --resolution fixed

# Add comment
tickets comment API-0042 "Fixed in commit a1b2c3"

# Search
tickets search "login 500"

# Register MCP server
tickets mcp --claude
tickets mcp --all

# Launch web dashboard
tickets serve

# Interactive TUI
tickets
```

---

## 9. Database Schema (SQLite)

17 tables with WAL mode, foreign keys, optimistic locking on tickets.

```sql
CREATE TABLE workspaces (id, name, slug, created_at);
CREATE TABLE agents (id, name, type, email, api_key_hash, permissions, created_at, last_seen_at);
CREATE TABLE projects (id, workspace_id, name, slug, ticket_prefix, ticket_counter, description, icon, is_public, created_at, updated_at);
CREATE TABLE labels (id, project_id, name, color, description);
CREATE TABLE milestones (id, project_id, name, description, due_date, status, created_at);
CREATE TABLE tickets (id, short_id, project_id, workspace_id, title, description, type, status, resolution, priority, severity, reporter_id, assignee_id, milestone_id, labels, custom_fields, source, external_id, external_url, is_ai_opened, ai_confidence, ai_reasoning, due_date, sla_minutes, sla_breached, duplicate_of, version, created_at, updated_at, resolved_at, closed_at);
CREATE TABLE comments (id, ticket_id, author_id, content, is_internal, type, metadata, created_at, updated_at);
CREATE TABLE ticket_relations (id, ticket_id, related_ticket_id, relation_type, created_by, created_at);
CREATE TABLE activity (id, ticket_id, agent_id, action, from_value, to_value, is_ai_action, ai_confidence, ai_reasoning, created_at);
CREATE TABLE webhooks (id, workspace_id, project_id, url, secret, events, is_active, last_triggered_at, failure_count, created_at);
CREATE TABLE api_keys (id, agent_id, key_hash, name, scopes, last_used_at, created_at);
CREATE TABLE sessions (id, agent_id, project_id, last_activity);
-- Custom domains
CREATE TABLE domains (id, workspace_id, project_id, domain, verified, verified_at, tls_cert, tls_key, created_at);
-- Email
CREATE TABLE email_config (id, workspace_id, provider, config_json, from_email, created_at, updated_at);
CREATE TABLE email_queue (id, provider, to_addresses, from_address, subject, html, text, headers, status, attempts, last_error, send_at, sent_at, created_at);
-- FTS
CREATE VIRTUAL TABLE tickets_fts USING fts5(title, description, content=tickets, content_rowid=rowid);
```

Migrations tracked in `_migrations` table (same pattern as open-todos).

---

## 10. Key Design Decisions

### SQLite vs PostgreSQL
**Decision: SQLite** — consistent with the `open-*` ecosystem, zero-dependency deploy, sufficient for self-hosted use cases. The architecture is designed to support a PostgreSQL adapter in the future (swap `db/database.ts`).

### Multi-tenancy
**Decision: Single database, workspace/project scoped** — all queries include `workspace_id` or `project_id` filter. Simple for self-hosted, extensible if needed.

### Auth
**Decision: API Key only (v1)** — simple, agent-friendly, no session state. OAuth/JWT in v2 for human SSO.

### Real-time
**Decision: SSE (Server-Sent Events)** over WebSocket for v1 — simpler server implementation with Hono, sufficient for dashboard live updates.

### Duplicate Detection
**Decision: SQLite FTS5 for v1** — full-text similarity search via BM25 ranking. Good enough for "did you mean?" before ticket creation. Vector embeddings (semantic search) as v2 enhancement.

### Port Assignment
**Decision: 19428** — continues the open-* sequence (open-todos is 19427).

---

## 11. Implementation Phases

### Phase 1 — Core (MVP)
1. Database schema + migrations
2. `src/db/` — CRUD for tickets, projects, agents, comments, activity
3. REST API (Hono) — tickets, comments, projects CRUD
4. API key authentication middleware
5. Basic CLI — `tickets init`, `tickets open`, `tickets list`, `tickets show`, `tickets close`
6. MCP server — core ticket tools (create, get, update, close, list, search, comment)

### Phase 2 — Web Dashboard
7. Vite + React web dashboard
8. Ticket list (table + kanban views)
9. Ticket detail page with comments + activity
10. New ticket form with duplicate detection
11. SSE for real-time updates
12. Labels + milestone management pages

### Phase 3 — Agent Features
13. Webhooks — create, verify, deliver, retry logic
14. `bulk_create_tickets` + `bulk_update_tickets` MCP tools
15. `get_similar_tickets` (FTS-based duplicate detection)
16. AI fields on tickets (is_ai_opened, ai_confidence, ai_reasoning)
17. `suggest_resolution` tool
18. SLA tracking + overdue detection

### Phase 4 — Custom Domains
19. `domains` table + domain routing middleware in Hono
20. DNS TXT verification flow (`tickets domain verify`)
21. `Host` header → project resolver
22. Let's Encrypt ACME opt-in TLS
23. Per-domain inbound email address routing

### Phase 5 — Email Integration
24. `src/email/` abstraction layer + `console` provider (dev default)
25. AWS SES adapter (outbound + SNS inbound webhook)
26. Resend adapter (outbound + inbound webhook)
27. SMTP adapter (outbound via Nodemailer)
28. Email queue table + retry worker
29. Inbound MIME parser → ticket creation
30. Reply-to threading (`reply+{id}+{token}@domain`)
31. Notification dispatch for all ticket events
32. Email templates (TypeScript, no template engine)
33. `tickets email config` + `tickets email test` CLI commands

### Phase 6 — SDK & Publishing
34. `sdk/` — standalone HTTP client package
35. TypeScript types package
36. Webhook helper (HMAC verification) + Reply token verifier
37. Publish `@hasna/tickets` to npm
38. `tickets mcp --all` install across Claude/Codex/Gemini
39. Full README + API docs

---

## 12. Package Structure

```
open-tickets/
├── src/
│   ├── types/
│   │   └── index.ts          # Enums, interfaces, error classes
│   ├── db/
│   │   ├── database.ts       # SQLite singleton, migrations
│   │   ├── tickets.ts        # Ticket CRUD
│   │   ├── projects.ts       # Project CRUD
│   │   ├── comments.ts       # Comment CRUD
│   │   ├── activity.ts       # Activity log writes/reads
│   │   ├── agents.ts         # Agent registration
│   │   ├── labels.ts         # Label CRUD
│   │   ├── milestones.ts     # Milestone CRUD
│   │   ├── webhooks.ts       # Webhook CRUD + delivery
│   │   ├── relations.ts      # Ticket relations
│   │   ├── search.ts         # FTS5 search helpers
│   │   └── api-keys.ts       # API key create/verify/revoke
│   ├── lib/
│   │   ├── short-id.ts       # "API-0042" generator
│   │   ├── state-machine.ts  # Valid transition logic
│   │   ├── sla.ts            # SLA breach detection
│   │   ├── similarity.ts     # FTS-based duplicate detection
│   │   ├── webhook-delivery.ts # HTTP delivery + HMAC signing + retry
│   │   └── auth.ts           # API key hashing + verification
│   ├── cli/
│   │   ├── index.tsx         # Commander.js entrypoint
│   │   └── components/       # Ink TUI components
│   ├── email/
│   │   ├── index.ts          # getEmailProvider() factory
│   │   ├── interface.ts      # EmailProvider interface
│   │   ├── queue.ts          # enqueue, retry logic
│   │   ├── inbound.ts        # raw MIME → ticket/comment
│   │   ├── reply-token.ts    # generate/verify reply+id+token
│   │   ├── notifications.ts  # event → email dispatch
│   │   ├── templates/        # one TS file per email type
│   │   └── providers/
│   │       ├── ses.ts        # AWS SES adapter
│   │       ├── resend.ts     # Resend adapter
│   │       ├── smtp.ts       # Nodemailer SMTP adapter
│   │       └── console.ts    # dev default (prints to stdout)
│   ├── mcp/
│   │   └── index.ts          # ~45 MCP tools + 4 resources
│   └── server/
│       ├── index.ts          # Hono app + SSE + domain middleware
│       └── routes/           # One file per resource group
├── dashboard/
│   ├── src/
│   │   ├── components/       # Pages, kanban, table, forms
│   │   └── main.tsx
│   └── vite.config.ts
├── sdk/
│   ├── src/
│   │   ├── client.ts         # TicketsClient
│   │   ├── schemas.ts        # Zod schemas
│   │   └── types.ts          # TypeScript types re-exported
│   └── package.json
├── package.json              # Three bins: tickets, tickets-mcp, tickets-serve
├── tsconfig.json
├── PLAN.md                   # This file
└── README.md
```

---

## 14. Custom Domains

Each project can be served on its own domain or subdomain.

### How It Works

```
tickets.acme.com         → project "acme-support"
support.myapp.io         → project "myapp-support"
bugs.devtool.com         → project "devtool-bugs"
localhost:19428          → default (all projects)
```

The Hono server reads the `Host` header on every request and resolves it to a project. If no
custom domain matches, falls back to slug-based routing (`/p/:slug`).

### Domain Table
```sql
CREATE TABLE domains (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id   TEXT,           -- which project this domain serves
  domain       TEXT UNIQUE,    -- "tickets.acme.com"
  verified     INTEGER DEFAULT 0,
  verified_at  TEXT,
  tls_cert     TEXT,           -- PEM cert (if self-managed)
  tls_key      TEXT,           -- PEM key (if self-managed)
  created_at   TEXT
);
```

### Verification Flow

1. User adds domain via CLI or dashboard
2. System generates a DNS TXT record challenge: `_tickets-verify.tickets.acme.com → abc123`
3. User adds the TXT record to their DNS
4. `tickets domain verify tickets.acme.com` polls DNS until record is found
5. Domain marked verified, routing activates

### TLS

- **Default**: user terminates TLS at their reverse proxy (nginx, Caddy, Cloudflare) — recommended
- **Built-in option**: auto-provision Let's Encrypt cert via ACME protocol (opt-in, requires port 80)
- Config flag: `TICKETS_TLS=acme` to enable built-in TLS

### Email Addressing per Domain

Each custom domain also gets a matching inbound email address (if email is configured):
```
support@tickets.acme.com     → tickets for acme-support project
reply+API-0042@tickets.acme.com  → adds comment to ticket API-0042
```

### CLI Commands
```bash
tickets domain add tickets.acme.com --project API
tickets domain verify tickets.acme.com        # check DNS TXT record
tickets domain list
tickets domain remove tickets.acme.com
tickets domain tls tickets.acme.com --acme    # enable Let's Encrypt
```

### API Endpoints
```
GET    /domains                          # list domains
POST   /domains                          # add domain
POST   /domains/:id/verify               # trigger verification
DELETE /domains/:id                      # remove
```

---

## 15. Email Integration

### Design: Provider Abstraction Layer

All email goes through a single `EmailProvider` interface in `src/email/`. Swap provider via
config — no code changes required.

```typescript
interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<SendResult>
  // Inbound is handled via provider-specific webhook (not this interface)
}

interface SendEmailOptions {
  from:    string          // "Acme Support <support@tickets.acme.com>"
  to:      string[]
  replyTo: string          // "reply+API-0042+token@tickets.acme.com"
  subject: string
  html:    string
  text:    string          // plain text fallback
  headers: Record<string, string>
}
```

### Supported Providers (v1)

| Provider | Adapter | Config Key |
|----------|---------|------------|
| **AWS SES** | `src/email/providers/ses.ts` | `EMAIL_PROVIDER=ses` |
| **Resend** | `src/email/providers/resend.ts` | `EMAIL_PROVIDER=resend` |
| **SMTP** | `src/email/providers/smtp.ts` | `EMAIL_PROVIDER=smtp` |
| **Console** | `src/email/providers/console.ts` | `EMAIL_PROVIDER=console` (dev/default) |

Adding a new provider = one file implementing the interface. Nothing else changes.

### AWS SES Configuration

```env
EMAIL_PROVIDER=ses
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SES_FROM_EMAIL=support@tickets.acme.com
SES_INBOUND_SNS_TOPIC=arn:aws:sns:...   # for receiving email
```

**Inbound SES flow:**
```
Email arrives → SES receives it → SNS notification → POST /email/inbound/ses
→ open-tickets parses raw MIME → creates ticket or adds comment
```

SES stores raw email in S3 → SNS fires webhook with S3 key → server fetches from S3 → parses.

### Resend Configuration

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=support@tickets.acme.com
RESEND_INBOUND_WEBHOOK_SECRET=...   # for verifying inbound webhooks
```

**Inbound Resend flow:**
```
Email arrives → Resend parses it → POST /email/inbound/resend (webhook)
→ open-tickets processes payload → creates ticket or adds comment
```
Resend is simpler than SES for inbound — no S3, no SNS, just a webhook.

### SMTP Configuration

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM_EMAIL=support@tickets.acme.com
```
SMTP is outbound only. For inbound with SMTP, use Mailgun/Postmark webhooks.

### Outbound: Notification Events

| Event | Who Gets Notified |
|-------|------------------|
| `ticket.created` | Assignee (if set), project watchers |
| `ticket.assigned` | New assignee |
| `comment.created` | Reporter, assignee, participants |
| `status_changed` | Reporter (closed/resolved), assignee |
| `sla.breached` | Assignee + project admins |
| `ticket.mentioned` | Mentioned agents (`@alice`) |

Each notification is a queued job — failures retry with exponential backoff.

### Inbound: Email-to-Ticket

**New ticket** via email:
```
To: support@tickets.acme.com
Subject: Login page crashes on Safari
Body: When I click Login on Safari 17, the page freezes...
```
→ Creates ticket with `source: "email"`, `reporter_id` resolved from sender's email

**Reply adds comment**:
```
To: reply+API-0042+<token>@tickets.acme.com
Subject: Re: [API-0042] Login page crashes on Safari
Body: I can reproduce this too, happens on iOS 17 as well
```
→ Appends comment to ticket API-0042, `source: "email"`

The `reply+{ticket_id}+{token}` scheme:
- `ticket_id` = short ID (URL-safe)
- `token` = HMAC-SHA256(ticket_id + reporter_email, secret) — prevents spoofing

### Email Queue Table
```sql
CREATE TABLE email_queue (
  id           TEXT PRIMARY KEY,
  provider     TEXT,             -- "ses" | "resend" | "smtp"
  to_addresses TEXT,             -- JSON array
  from_address TEXT,
  subject      TEXT,
  html         TEXT,
  text         TEXT,
  headers      TEXT,             -- JSON
  status       TEXT DEFAULT 'pending',  -- pending | sent | failed
  attempts     INTEGER DEFAULT 0,
  last_error   TEXT,
  send_at      TEXT,             -- for scheduled/delayed sends
  sent_at      TEXT,
  created_at   TEXT
);
```

### Email Templates

Stored in `src/email/templates/` as plain TypeScript functions returning `{ html, text, subject }`.
No template engine dependency — just tagged template literals or JSX (with a static renderer).

```
src/email/templates/
├── ticket-created.ts
├── ticket-assigned.ts
├── comment-added.ts
├── status-changed.ts
├── sla-breached.ts
└── domain-verification.ts
```

### Inbound Webhook Endpoints
```
POST /email/inbound/ses       # AWS SES via SNS
POST /email/inbound/resend    # Resend inbound webhook
POST /email/inbound/smtp      # Generic MIME parser (Mailgun/Postmark/etc.)
```

### CLI Commands
```bash
# Email provider config
tickets email config --provider ses \
  --region us-east-1 \
  --from support@tickets.acme.com

tickets email config --provider resend \
  --api-key re_... \
  --from support@tickets.acme.com

tickets email config --provider smtp \
  --host smtp.mailgun.org \
  --port 587

# Test outbound
tickets email test --to me@example.com

# View email queue
tickets email queue
tickets email queue --status failed
tickets email retry <email-id>

# Inbound
tickets email inbound-url              # print the webhook URL to register with SES/Resend
```

### Package Structure Additions
```
src/
├── email/
│   ├── index.ts               # getEmailProvider() factory
│   ├── interface.ts           # EmailProvider interface + types
│   ├── queue.ts               # enqueue, dequeue, retry logic
│   ├── inbound.ts             # parse raw MIME → ticket or comment
│   ├── reply-token.ts         # generate + verify reply+{id}+{token} addresses
│   ├── notifications.ts       # event → email dispatch
│   ├── templates/             # one TS file per email type
│   └── providers/
│       ├── ses.ts             # AWS SES adapter
│       ├── resend.ts          # Resend adapter
│       ├── smtp.ts            # Nodemailer SMTP adapter
│       └── console.ts         # dev console adapter (default)
```

---

## 13. Differentiation from open-todos

| | open-todos | open-tickets |
|---|---|---|
| **Purpose** | Internal dev task management for AI agents | Public issue tracking for products/services |
| **Who opens** | AI agents building software | Anyone — users, agents, monitoring bots |
| **Focus** | Sprint planning, task execution, agent coordination | Bug reports, feature requests, support, incidents |
| **Lifecycle** | Task → done (linear) | Ticket → triage → resolve → close (state machine) |
| **Visibility** | Internal to dev team | Can be public (public project flag) |
| **Key concepts** | Plans, task lists, checklists, locking | Milestones, labels, severity, SLA, relations |
| **Port** | 19427 | 19428 |
| **npm** | @hasna/todos | @hasna/tickets |
| **Bin** | todos, todos-mcp, todos-serve | tickets, tickets-mcp, tickets-serve |

Both systems can integrate: completing a dev ticket in `open-todos` can automatically close the
corresponding user-facing ticket in `open-tickets` via the SDK or webhook.

---

*Plan written: 2026-03-21*
