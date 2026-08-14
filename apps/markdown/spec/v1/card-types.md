# OMP v1 -- Card Types Reference

Every card in an OMP document has a `type` header that determines what structured data the script extracts and what context the LLM receives. This document defines all built-in card types, their required and optional header keys, the regex used to extract structured data, and what the LLM interprets from the body.

Cards follow a universal structure:

```
type: <card-type>
id: <unique-identifier>
[type-specific headers]
[depends: card-id-1, card-id-2]

[natural language body]

[accepts: testable criteria]
```

The script extracts all header key-value pairs deterministically. The body (everything after the first blank line following the headers) is passed to the LLM. The `accepts:` line, if present, is extracted for test generation.

---

## project

The first card in any OMP document. Defines global project configuration. There should be exactly one project card per document (imports excluded).

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| name | Project name | NoteApp |
| framework | Framework and version | nextjs@14 |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| router | Routing strategy | app |
| language | Programming language | typescript |
| styling | CSS framework | tailwindcss |
| pkg | Package manager | bun |

### Regex extraction

```
/^(name|framework|router|language|styling|pkg):\s*(.+)$/gm
```

All values are plain strings. The script stores them as the project context object, accessible to all other cards.

### What the LLM interprets

The body describes how to initialize the project. The LLM receives all header values as structured context plus the body as instructions.

### Example

```
type: project
id: init

name: NoteApp
framework: nextjs@14
router: app
language: typescript
styling: tailwindcss
pkg: bun

Create the project scaffolding. Enable strict TypeScript in tsconfig.json. Initialize Tailwind with the default configuration. Set up the bun lockfile.
```

---

## database

Configures the database connection for the project. Typically depends on the project card.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| engine | Database engine | sqlite, postgresql, mysql |
| orm | ORM library | drizzle, prisma, kysely |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| file | Database file path (for file-based DBs) | data/app.db |
| url | Connection string (for server-based DBs) | env:DATABASE_URL |
| schema-dir | Directory for schema files | src/db/schema |

### Regex extraction

```
/^(engine|orm|file|url|schema-dir):\s*(.+)$/gm
```

### What the LLM interprets

The body describes how to configure the ORM connection, create the client file, and set up any initialization logic.

### Example

```
type: database
id: db
engine: sqlite
orm: drizzle
file: data/notes.db
depends: init

Configure the Drizzle ORM connection to the SQLite database at the specified path. Create an index file at `src/db/index.ts` that exports the database client. Ensure the data directory exists before connecting.
```

---

## table

Defines a database table schema. The columns can be specified as a markdown table in the body or as a YAML-like list in the header.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| db | Card id of the database card this table belongs to | db |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| primary-key | Composite primary key columns | [note_id, tag_id] |
| on-delete | Cascade behavior for foreign keys | cascade, set-null, restrict |
| indexes | Additional indexes | [email_unique, created_at_desc] |

### Regex extraction

Headers:
```
/^(db|primary-key|on-delete|indexes):\s*(.+)$/gm
```

Columns from markdown table in body:
```
/^\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|$/gm
```

Capture group 1: column name. Group 2: column type. Group 3: constraints (comma-separated).

The script skips the table header row (containing `column`, `type`, `constraints`) and the separator row (containing dashes).

### What the LLM interprets

The body text outside the markdown table describes implementation details -- file paths, behavioral notes, relationships. The LLM receives the extracted column definitions as structured data plus the body prose.

### Example

```
type: table
id: notes
db: db

| column     | type     | constraints             |
|-----------|----------|-------------------------|
| id        | text     | primary key, uuid       |
| user_id   | text     | foreign key -> users.id |
| title     | text     | not null                |
| content   | text     | not null                |
| created_at| datetime | default now             |
| updated_at| datetime | default now             |

Define in `src/db/schema/notes.ts`. The updated_at column must be refreshed on every update operation. Cascade delete when the referenced user is removed.

accepts: updated_at changes on update; user_id is not null
```

---

## migration

Triggers schema migration after table definitions are ready. Typically depends on all table cards.

### Required headers

None beyond `type` and `id`.

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| depends | Card ids this migration waits for | users, notes, tags |

### Regex extraction

Standard header parsing only. No type-specific regex needed.

### What the LLM interprets

The body describes which migration command to run and any pre/post migration steps.

### Example

```
type: migration
id: db-push
depends: users, notes, tags, note-tags

Generate migrations and push the schema to the database using `drizzle-kit push`. Verify all tables were created by checking the SQLite schema.

accepts: all tables exist after push; no migration errors
```

---

## auth

Configures authentication and session management.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| method | Auth method | email+password, oauth, magic-link |
| library | Auth library | lucia-auth, next-auth, clerk |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| hash | Password hashing algorithm | argon2, bcrypt, scrypt |
| session | Session storage strategy | cookie, jwt, database |
| providers | OAuth providers | [google, github] |
| mfa | Multi-factor auth | totp, sms |

### Regex extraction

```
/^(method|library|hash|session|providers|mfa):\s*(.+)$/gm
```

### What the LLM interprets

The body describes how to implement the auth flow: signup logic, login logic, middleware placement, session validation, protected routes. The LLM receives the structured auth config plus the body.

### Example

```
type: auth
id: auth
method: email+password
library: lucia-auth
hash: argon2
session: cookie
depends: db-push

Set up Lucia Auth with argon2 password hashing. Create API routes for signup and login that set HTTP-only session cookies.

Build a middleware at `src/middleware.ts` that checks every request for a valid session. Exclude `/login`, `/signup`, and `/api/auth/*` from the check. Redirect unauthenticated page requests to `/login`. Return 401 for unauthenticated API requests.

accepts: passwords hashed with argon2; invalid session redirects to /login; API returns 401 not redirect
```

---

## endpoint

Defines a single API endpoint.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| method | HTTP method | GET, POST, PUT, PATCH, DELETE |
| path | URL path pattern | /api/notes/:id |
| auth | Auth requirement | required, none, optional |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| params | Query parameters | q (string, optional), page (int, optional) |
| body | Request body schema | { title: string, content: string } |
| returns | Response shape | { id: string, title: string } |
| rate-limit | Rate limiting | 100/minute |
| cache | Cache strategy | 60s, stale-while-revalidate |

### Regex extraction

```
/^(method|path|auth|params|body|returns|rate-limit|cache):\s*(.+)$/gm
```

The `method` value is validated against known HTTP methods. The `path` is parsed for route parameters (segments starting with `:`).

Route parameter regex:
```
/:(\w+)/g
```

### What the LLM interprets

The body describes the endpoint's business logic: what it does with the data, validation rules, error responses, edge cases. The LLM receives the extracted method/path/auth/params/body/returns as structured data, plus the body prose, plus related table cards' column definitions for context.

### Example

```
type: endpoint
id: list-notes
method: GET
path: /api/notes
auth: required
params: q (string, optional), tag (string, optional)
depends: auth

Return all notes belonging to the authenticated user. When `q` is provided, filter by case-insensitive LIKE match on both title and content. When `tag` is provided, filter to notes having that tag name via join through note_tags. Both filters combine with AND logic.

accepts: only user's own notes returned; q searches title+content; tag filters via join; both params combinable
```

---

## page

Defines a frontend page/route.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| path | URL path | /notes, /notes/:id |
| auth | Auth requirement | required, none |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| layout | Layout card id to use | root-layout |
| component | Component name | NotesListPage |
| ssr | Server-side rendering mode | static, dynamic, streaming |

### Regex extraction

```
/^(path|auth|layout|component|ssr):\s*(.+)$/gm
```

### What the LLM interprets

The body describes the page's UI: layout, components, interactions, responsive behavior, data fetching. The LLM receives the page metadata plus the body, plus related endpoint cards for the APIs this page calls.

### Example

```
type: page
id: notes-list
path: /notes
auth: required
depends: root-layout, list-notes

Display notes as cards in a responsive grid: 1 column mobile, 2 tablet, 3 desktop. Each card shows title, 120-character content preview, tag chips as colored badges, and relative timestamp. Search bar at top debounces at 300ms and queries the list endpoint with `q`. Floating "+" button in bottom-right creates a new note and opens its editor.

accepts: grid responsive at 3 breakpoints; search debounced 300ms; cards show title+preview+tags+time
```

---

## layout

Defines a shared layout wrapper that pages render inside.

### Required headers

None beyond `type` and `id`.

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| scope | Where the layout applies | root, dashboard, auth |
| nav | Navigation items | [/notes: All Notes, /tags: Tags] |

### Regex extraction

```
/^(scope|nav):\s*(.+)$/gm
```

### What the LLM interprets

The body describes the layout structure: sidebar, header, navigation, responsive behavior. The LLM receives the scope/nav metadata plus the body.

### Example

```
type: layout
id: root-layout
scope: root
depends: init

Create a root layout with a left sidebar. The sidebar contains a link "All Notes" pointing to `/notes`. At the bottom, show the user's email and a logout button. On viewports under 768px, the sidebar collapses into a hamburger menu.

accepts: sidebar collapses below 768px; logout button visible
```

---

## component

Defines a reusable UI component.

### Required headers

None beyond `type` and `id`.

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| props | Component props | title (string), onSave (function), tags (Tag[]) |
| slots | Named slot areas | header, body, footer |
| variants | Visual variants | default, compact, expanded |
| file | Output file path | src/components/NoteCard.tsx |

### Regex extraction

```
/^(props|slots|variants|file):\s*(.+)$/gm
```

Props are parsed into name/type pairs:
```
/(\w+)\s*\((\w+(?:\[\])?)\)/g
```

### What the LLM interprets

The body describes the component's appearance, behavior, and interaction patterns. The LLM receives the props/slots/variants as structured data plus the body.

### Example

```
type: component
id: note-card
props: title (string), preview (string), tags (Tag[]), updatedAt (Date), onClick (function)
variants: default, compact
file: src/components/NoteCard.tsx
depends: init

A card component displaying a note summary. The default variant shows the title in bold, a content preview truncated to 120 characters, tags as small colored chips, and a relative timestamp. The compact variant hides the tags and shows only title and timestamp. The entire card is clickable.

accepts: title truncated with ellipsis if longer than one line; compact variant hides tags
```

---

## functions

Defines a set of utility functions to be created in a single file.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| file | Output file path | src/lib/utils.ts |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| exports | List of function signatures | see below |

### Body format for exports

The body contains a list of function signatures:

```
- functionName(param1: type, param2: type): returnType
  Description of what it does.

- anotherFunction(input: type): returnType
  Description.
```

### Regex extraction

File path:
```
/^file:\s*(.+)$/gm
```

Function signatures in body:
```
/^-\s+(\w+)\(([^)]*)\)(?::\s*(\w+(?:\[\])?))?$/gm
```

Capture group 1: function name. Group 2: parameter list. Group 3: return type.

### What the LLM interprets

The body describes each function's purpose, behavior, and edge cases. The LLM receives the extracted function signatures plus the description text for each.

### Example

```
type: functions
id: note-utils
file: src/lib/note-utils.ts
depends: init

- truncateContent(content: string, maxLength: number): string
  Truncate text to maxLength characters. If truncated, append an ellipsis. Never break in the middle of a word.

- formatRelativeTime(date: Date): string
  Return a human-readable relative time string like "3 hours ago", "just now", or "2 days ago". Use the user's locale.

- generateNotePreview(title: string, content: string): string
  Create a search-friendly preview by concatenating the title and first 200 characters of content, lowercased.

accepts: truncation respects word boundaries; relative time uses locale
```

---

## tree

Defines a file/folder structure using an indented list. This is purely a structural blueprint that the executor creates on disk.

### Required headers

None beyond `type` and `id`.

### Optional headers

None. The structure is entirely in the body.

### Body format

An indented list where each level of indentation represents a directory nesting level. Files are leaf nodes. Directories end with `/`.

```
src/
  db/
    schema/
      users.ts
      notes.ts
      tags.ts
      note-tags.ts
      index.ts
    index.ts
  lib/
    utils.ts
  middleware.ts
```

### Regex extraction

Each line is parsed for indentation level and name:
```
/^(\s*)([\w./-]+)\s*$/gm
```

Capture group 1: indentation (2 spaces per level). Group 2: file or directory name (directories end with `/`).

### What the LLM interprets

The LLM does not typically process tree cards. The script creates the directory structure deterministically. If a body paragraph accompanies the tree, the LLM interprets it as additional context about the project organization.

### Example

```
type: tree
id: project-structure
depends: init

src/
  app/
    (auth)/
      login/
        page.tsx
      signup/
        page.tsx
    (protected)/
      notes/
        page.tsx
        [id]/
          page.tsx
      layout.tsx
    layout.tsx
  db/
    schema/
      users.ts
      notes.ts
      tags.ts
      note-tags.ts
      index.ts
    index.ts
  lib/
    utils.ts
  middleware.ts
data/
scripts/
  seed.ts

This structure follows the Next.js App Router conventions. Route groups `(auth)` and `(protected)` separate public and authenticated routes.
```

---

## middleware

Defines a middleware function or middleware stack.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| file | Output file path | src/middleware.ts |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| config | Middleware configuration | matcher: ["/api/*", "/app/*"] |
| order | Execution order priority | 1, 2, 3 |

### Regex extraction

```
/^(file|config|order):\s*(.+)$/gm
```

### What the LLM interprets

The body describes the middleware's logic: what it checks, what it modifies, what it passes through.

### Example

```
type: middleware
id: auth-middleware
file: src/middleware.ts
config: matcher: ["/((?!login|signup|api/auth).*)"]
depends: auth

Check every incoming request for a valid session cookie. If the session is missing or expired, redirect page requests to `/login` and return 401 for API requests. Pass the user object to downstream handlers via request context.

accepts: unauthenticated page requests redirect to /login; API requests get 401; valid sessions pass through
```

---

## test

Defines test cases for a feature or module.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| pattern | Test file glob or path | src/api/notes/*.test.ts |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| framework | Test framework | vitest, jest, playwright |
| cases | List of test case descriptions | see body |

### Regex extraction

```
/^(pattern|framework):\s*(.+)$/gm
```

Test cases in body:
```
/^-\s+(.+)$/gm
```

### What the LLM interprets

The body lists test scenarios and their expected behaviors. The LLM generates test code for each case.

### Example

```
type: test
id: notes-api-tests
pattern: src/api/notes/__tests__/*.test.ts
framework: vitest
depends: list-notes, create-note, get-note, update-note, delete-note

- GET /api/notes returns 401 without auth
- GET /api/notes returns empty array for new user
- POST /api/notes creates a note and returns it with id
- POST /api/notes returns 422 when title is missing
- GET /api/notes/:id returns 404 for another user's note
- PUT /api/notes/:id updates title and refreshes updated_at
- DELETE /api/notes/:id removes note and its tag associations
- GET /api/notes?q=search filters by title and content
- GET /api/notes?tag=work filters by tag name

accepts: all tests pass; coverage above 90% for notes API routes
```

---

## seed

Defines seed data to populate the database for development or testing.

### Required headers

None beyond `type` and `id`.

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| admin-email | Default admin email | andrei@hasna.com |
| admin-password | Password strategy | random, fixed:password123 |
| sample-notes | Number of sample records | 5 |
| sample-tags | Tag names | [work, personal, ideas] |
| file | Seed script path | scripts/seed.ts |

### Regex extraction

```
/^(admin-email|admin-password|sample-notes|sample-tags|file):\s*(.+)$/gm
```

List values in brackets:
```
/\[([^\]]+)\]/
```

Split by comma and trim each element.

### What the LLM interprets

The body describes the seed script's logic: how to generate data, what relationships to create, what to output.

### Example

```
type: seed
id: seed
admin-email: andrei@hasna.com
admin-password: random
sample-notes: 5
sample-tags: [work, personal, ideas, urgent, reference]
depends: db-push, auth

Write a seed script at `scripts/seed.ts`. Generate the admin password with `openssl rand -base64 24`. Insert the admin user with hashed password. Create 5 sample notes with varied titles and content. Assign 1-3 random tags to each note. Print the admin email and plaintext password to the console. Add `db:seed` to package.json.

accepts: password printed to console; 5 notes created; each note has 1-3 tags
```

---

## deploy

Defines deployment configuration.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| provider | Hosting provider | vercel, railway, fly, aws |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| env | Environment variables to set | [DATABASE_URL, SESSION_SECRET] |
| region | Deployment region | us-east-1, eu-west-1 |
| hooks | Build/deploy hooks | build: bun run build, postdeploy: bun run db:push |
| domain | Custom domain | notes.example.com |

### Regex extraction

```
/^(provider|env|region|hooks|domain):\s*(.+)$/gm
```

Hooks are parsed as key-value pairs:
```
/(\w+):\s*(.+)/g
```

### What the LLM interprets

The body describes deployment steps, environment setup, and any provider-specific configuration.

### Example

```
type: deploy
id: deploy-prod
provider: vercel
env: [DATABASE_URL, SESSION_SECRET, ARGON_SECRET]
hooks: build: bun run build, postdeploy: bun run db:push
depends: seed

Deploy to Vercel. Set environment variables from the project's `.env.production` file. Configure the build command to use bun. Run database push after deployment to ensure the schema is current. Set up a preview deployment for pull requests.

accepts: production build succeeds; env vars set; db schema current after deploy
```

---

## cron

Defines a scheduled recurring task.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| schedule | Cron expression or interval | 0 2 * * *, every 6 hours |
| action | What to execute | cleanup-expired-sessions |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| timeout | Max execution time | 5m, 30s |
| retry | Retry policy | 3 attempts, exponential backoff |

### Regex extraction

```
/^(schedule|action|timeout|retry):\s*(.+)$/gm
```

### What the LLM interprets

The body describes the cron job's logic and any edge cases.

### Example

```
type: cron
id: session-cleanup
schedule: 0 2 * * *
action: cleanup-expired-sessions
timeout: 5m
depends: auth

Run daily at 2 AM. Delete all sessions that expired more than 7 days ago. Log the count of deleted sessions. If the cleanup takes longer than 5 minutes, abort and retry on the next run.

accepts: expired sessions deleted; runs complete within timeout
```

---

## job

Defines a one-time or triggered background job.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| trigger | What starts the job | manual, on:note-deleted, on:user-signup |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| steps | Named steps in order | [validate, process, notify] |
| timeout | Max execution time | 10m |
| retry | Retry policy | 3 attempts |
| queue | Job queue name | default, priority |

### Regex extraction

```
/^(trigger|steps|timeout|retry|queue):\s*(.+)$/gm
```

Steps list:
```
/\[([^\]]+)\]/
```

### What the LLM interprets

The body describes each step's logic, error handling, and completion criteria.

### Example

```
type: job
id: export-notes
trigger: manual
steps: [validate-user, fetch-notes, generate-pdf, send-email]
timeout: 10m
depends: list-notes

Export all of a user's notes as a PDF. First validate the user exists and has notes. Fetch all notes with their tags. Generate a formatted PDF with a table of contents. Email the PDF to the user's email address. If any step fails, mark the job as failed and notify the user.

accepts: PDF contains all notes; email sent to correct address; timeout respected
```

---

## email

Defines an email template or email-sending behavior.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| to | Recipient | user.email, admin@example.com |
| subject | Email subject line | Your notes export is ready |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| template | Template name or path | export-complete, welcome |
| trigger | What causes this email to send | on:export-complete, on:signup |
| from | Sender address | noreply@noteapp.com |
| reply-to | Reply-to address | support@noteapp.com |

### Regex extraction

```
/^(to|subject|template|trigger|from|reply-to):\s*(.+)$/gm
```

### What the LLM interprets

The body describes the email content, formatting, and any dynamic data to include.

### Example

```
type: email
id: welcome-email
to: user.email
subject: Welcome to NoteApp
template: welcome
trigger: on:signup
from: noreply@noteapp.com
depends: auth

Send a welcome email after signup. The email body should greet the user by name, explain the key features (notes, tags, search), and include a link to `/notes` to get started. Use a clean, minimal HTML template. Include a plain-text fallback.

accepts: email sent on signup; contains user's name; link to /notes works
```

---

## call

Defines an MCP tool call or external API invocation that the executor should make during processing.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| action | The tool or API to call | mcp:filesystem.write, mcp:shell.exec, api:github.create-repo |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| params | Parameters for the call | path: src/index.ts, content: ... |
| expects | Expected response shape | { success: true } |
| on-error | Error handling strategy | retry, skip, abort |

### Regex extraction

```
/^(action|params|expects|on-error):\s*(.+)$/gm
```

The action prefix (`mcp:` or `api:`) determines the call type:
```
/^(mcp|api):(.+)$/
```

### What the LLM interprets

The body provides additional context for the call: why it is being made, what to do with the response, how it fits into the broader workflow.

### Example

```
type: call
id: create-repo
action: mcp:github.create-repo
params: name: noteapp, private: true, description: A note-taking app
on-error: abort
depends: init

Create a private GitHub repository for the project. If the repo already exists, skip creation and continue. After creation, initialize the local git repo and set the remote origin.

accepts: repo exists on GitHub; remote origin set in local git
```

---

## monitor

Defines a health check or monitoring rule.

### Required headers

| Key | Description | Example |
|-----|-------------|---------|
| endpoint | URL or path to monitor | /api/health, https://noteapp.com |
| interval | Check frequency | 30s, 5m, 1h |

### Optional headers

| Key | Description | Example |
|-----|-------------|---------|
| alert | Alert destination | email:admin@example.com, webhook:slack |
| expect | Expected response | status: 200, body-contains: "ok" |
| timeout | Request timeout | 5s, 10s |

### Regex extraction

```
/^(endpoint|interval|alert|expect|timeout):\s*(.+)$/gm
```

### What the LLM interprets

The body describes what constitutes a healthy vs. unhealthy response and what actions to take on failure.

### Example

```
type: monitor
id: health-check
endpoint: /api/health
interval: 30s
alert: email:andrei@hasna.com
expect: status: 200
timeout: 5s
depends: deploy-prod

Check the health endpoint every 30 seconds. A healthy response returns 200 with a JSON body containing `{ status: "ok", db: "connected" }`. If the check fails 3 consecutive times, send an alert email. Include the response body and error details in the alert.

accepts: healthy endpoint returns 200; alert fires after 3 consecutive failures
```

---

## custom

Any card type that does not match a built-in type is treated as a custom card. The script extracts all header key-value pairs but applies no type-specific validation. The entire card is passed to the LLM for interpretation.

### Required headers

| Key | Description |
|-----|-------------|
| type | Any string not matching a built-in type |
| id | Unique card identifier |

### Optional headers

Any key-value pairs. All are extracted and passed to the LLM as context.

### Regex extraction

Standard header parsing:
```
/^(\w[\w-]*):\s*(.+)$/gm
```

### What the LLM interprets

Everything. The LLM receives all headers as structured context and the full body as instructions. Custom cards are the escape hatch for anything OMP does not have a built-in type for.

### Example

```
type: analytics
id: tracking-setup
provider: posthog
api-key: env:POSTHOG_KEY
depends: init

Integrate PostHog analytics. Add the tracking script to the root layout. Track page views automatically. Create custom events for: note-created, note-deleted, search-performed, tag-added. Include the user's id (but not email) as a distinct_id.

accepts: page views tracked; custom events fire on correct actions; no PII in event properties
```

---

## Universal Headers

These headers are available on every card type:

| Key | Required | Description |
|-----|----------|-------------|
| type | yes | The card type (determines parsing behavior) |
| id | yes | Unique identifier within the document |
| depends | no | Comma-separated list of card ids or event names this card waits for |
| tags | no | Comma-separated labels for filtering/grouping |

### depends parsing

```
/^depends:\s*(.+)$/gm
```

The value is split by comma and each element is trimmed. Each element must be either a card id or an `@emit` event name present in the document.

### tags parsing

```
/^tags:\s*\[(.+)\]$/gm
```

Or without brackets:
```
/^tags:\s*(.+)$/gm
```

Split by comma, trim each element.

---

## Header Parsing Rules

1. Headers are all lines from the start of a card until the first blank line.
2. Each header line matches: `/^(\w[\w-]*):\s*(.+)$/`
3. Keys are case-insensitive but conventionally lowercase with hyphens.
4. Values are strings by default. Lists use bracket notation: `[item1, item2]`.
5. A line that does not match the header pattern inside the header block is an error.
6. The first blank line after headers marks the start of the body.
7. The body continues until the next `---` separator or end of document.
8. An `accepts:` line at the end of the body is extracted separately for test generation.

### accepts parsing

```
/^accepts:\s*(.+)$/gm
```

The value is a semicolon-separated list of testable criteria. Each criterion is a short assertion.
