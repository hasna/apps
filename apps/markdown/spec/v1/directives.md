# OMP v1 -- Directives Reference

Directives are lines that begin with `@` and appear outside card bodies. They are processed by the deterministic script layer before any cards are parsed or sent to an LLM. Directives control file composition, code generation patterns, conditional logic, and execution hooks.

Every directive occupies its own line. Directives are never nested inside each other on the same line. The script processes directives in a top-down pass before building the card DAG.

---

## @import

Includes another OMP file at the location of the directive. The imported file's cards are merged into the parent document at the position where the `@import` appears. Imports are resolved recursively -- an imported file can itself contain `@import` directives.

### Syntax

```
@import ./relative/path/to/file.omp.md
@import ../shared/auth-cards.omp.md
```

### Regex

```
/^@import\s+(.+)$/gm
```

Capture group 1: the file path (trimmed).

### What the script does

1. Reads the file at the resolved path. Paths are relative to the file containing the `@import`, not the root document.
2. Parses the imported file into cards using the standard `---` splitting and header extraction.
3. Inserts the imported cards into the parent document at the position of the `@import` line.
4. Continues parsing the parent document with the imported cards now inline.
5. Tracks visited file paths in a set. If a file has already been visited in the current import chain, the script raises a cycle error and halts.

### What gets passed to LLM

Nothing. The `@import` directive is fully resolved by the script. By the time any card reaches the LLM, all imports have been flattened into a single card sequence.

### Example

File: `app.omp.md`
```
# MyApp

---

type: project
id: init

name: MyApp
framework: nextjs@14
pkg: bun

Set up the project.

---

@import ./database/schema.omp.md
@import ./api/endpoints.omp.md
@import ./ui/pages.omp.md
```

File: `database/schema.omp.md`
```
type: database
id: db
engine: sqlite
orm: drizzle
file: data/app.db
depends: init

Configure the database connection.

---

type: table
id: users
db: db

| column | type | constraints |
|--------|------|-------------|
| id     | text | primary key, uuid |
| email  | text | unique, not null |
```

After import resolution, the parser sees a single flat sequence: project card, database card, users table card, then whatever cards come from the API and UI imports.

---

## @pattern

Defines a reusable card template that can be instantiated multiple times with different arguments. Everything from the `@pattern` line until the next `---` separator or the next `@pattern` line is the template body. Parameters are named placeholders that get substituted on instantiation.

### Syntax

```
@pattern crud-endpoint(method, path, description)
type: endpoint
id: {{method}}-{{path}}
method: {{method}}
path: /api/{{path}}
auth: required
depends: auth

{{description}}
```

### Regex

```
/^@pattern\s+(\w+)\((.*)\)$/gm
```

Capture group 1: the pattern name (alphanumeric + underscores).
Capture group 2: comma-separated parameter names.

### What the script does

1. Registers the pattern name and its parameter list in a pattern registry.
2. Stores the template body (everything after the `@pattern` line until the next `---` or `@pattern`).
3. Does not emit any cards at the definition site. The `@pattern` block is consumed and removed from the document.
4. Parameter names inside the template body are referenced with `{{paramName}}` syntax and will be replaced on instantiation.
5. Pattern names must be unique within a document (including imports). Duplicate names raise an error.

### What gets passed to LLM

Nothing at definition time. When instantiated, the resulting cards are processed normally -- their bodies go to the LLM like any other card.

### Example

```
@pattern rest-endpoint(method, path, entity, desc)
type: endpoint
id: {{method}}-{{entity}}
method: {{method}}
path: /api/{{path}}
auth: required
depends: auth

{{desc}}

accepts: auth required; returns 404 for missing resources
```

This pattern is now available for instantiation via `@rest-endpoint(...)`.

---

## @name(args) -- Pattern Instantiation

Instantiates a previously defined `@pattern`, substituting the provided arguments into the template body. Each instantiation generates one or more cards that are inserted at the call site.

### Syntax

```
@rest-endpoint(GET, notes, notes, Return all notes for the authenticated user)
@rest-endpoint(POST, notes, note-create, Create a new note with title and content)
```

### Regex

```
/^@(\w[\w-]*)\((.*)\)$/gm
```

Capture group 1: the pattern name.
Capture group 2: comma-separated argument values.

The script must exclude reserved directive names from matching: `import`, `pattern`, `repeat`, `if`, `use`, `emit`, `hook`. Any `@name(...)` that does not match a reserved name is treated as a pattern instantiation.

### What the script does

1. Looks up the pattern name in the registry. If not found, raises an error.
2. Splits the arguments by comma, trims whitespace from each.
3. Maps arguments positionally to the pattern's parameter list. Argument count must match parameter count or the script raises an error.
4. Performs string substitution: every `{{paramName}}` in the template body is replaced with the corresponding argument value.
5. Parses the substituted text as one or more cards and inserts them at the call site.

### What gets passed to LLM

The instantiated card bodies are passed to the LLM exactly like any hand-written card. The LLM has no awareness that the card was generated from a pattern.

### Example

Given the `rest-endpoint` pattern defined above:

```
@rest-endpoint(GET, notes, list-notes, Return all notes belonging to the authenticated user sorted by updated_at descending)

---

@rest-endpoint(POST, notes, create-note, Create a new note. Title and content are required fields. Return 422 if either is missing.)

---

@rest-endpoint(DELETE, notes/:id, delete-note, Delete a note and all its tag associations. Return 404 if not found or not owned.)
```

After expansion, the first call produces:

```
type: endpoint
id: GET-list-notes
method: GET
path: /api/notes
auth: required
depends: auth

Return all notes belonging to the authenticated user sorted by updated_at descending

accepts: auth required; returns 404 for missing resources
```

---

## @repeat

Repeats the next card N times. Each repetition has access to the `{{index}}` variable (0-based) which can be used in both the header and the body of the card.

### Syntax

```
@repeat 5
```

### Regex

```
/^@repeat\s+(\d+)$/gm
```

Capture group 1: the repeat count (integer).

### What the script does

1. Reads the integer N from the directive.
2. Takes the next card (everything until the next `---` separator) as the template.
3. Generates N copies of the card, replacing every `{{index}}` in each copy with the current iteration number (0 through N-1).
4. Inserts all N cards at the location of the `@repeat` directive.
5. The original template card is consumed -- it does not appear in the output alongside the copies.

### What gets passed to LLM

Each generated card's body is passed to the LLM independently, as if it were a hand-written card. The `{{index}}` values are already resolved before the LLM sees anything.

### Example

```
@repeat 3
type: endpoint
id: shard-{{index}}
method: GET
path: /api/shard/{{index}}
auth: required
depends: auth

Return data from shard {{index}}. Each shard handles a partition of the user base.
```

Produces three cards with ids `shard-0`, `shard-1`, `shard-2` and paths `/api/shard/0`, `/api/shard/1`, `/api/shard/2`.

---

## @if

Conditionally includes the next card. The condition is a natural language expression that is evaluated by a cheap LLM at parse time. The LLM receives the condition text plus the current document context and must answer `true` or `false`.

### Syntax

```
@if the project uses authentication
@if the database engine is PostgreSQL
@if there are more than 5 endpoint cards
```

### Regex

```
/^@if\s+(.+)$/gm
```

Capture group 1: the condition text (natural language).

### What the script does

1. Extracts the condition text.
2. Builds a prompt for a cheap LLM: the condition text, the full list of card headers parsed so far, and any project-level metadata from the project card.
3. Sends the prompt to the LLM with the instruction: "Answer ONLY 'true' or 'false'. Is the following condition true given this document context?"
4. If the LLM returns `true`, the next card is included in the document normally.
5. If the LLM returns `false`, the next card is skipped entirely -- it does not appear in the card DAG or get executed.
6. The `@if` line itself is always removed from the output.

### What gets passed to LLM

The condition evaluation prompt includes:
- The condition text itself
- All card headers parsed so far (type, id, and key-value pairs)
- The project card's full header as context

If the condition passes, the card's body is later passed to the execution LLM normally.

### Example

```
@if the project uses cookie-based authentication
type: middleware
id: csrf-protection
file: src/middleware/csrf.ts
depends: auth

Add CSRF token validation to all POST, PUT, and DELETE requests. Generate a token per session and validate it on every mutating request.

accepts: CSRF token checked on all mutating requests; missing token returns 403

---

@if the database engine is PostgreSQL
type: migration
id: enable-extensions
depends: db

Enable the uuid-ossp and pg_trgm extensions for UUID generation and trigram-based full-text search.
```

If the project card has `session: cookie`, the first card is included. If the database card has `engine: sqlite`, the second card is skipped.

---

## @use

Declares an external tool, MCP server, or capability that the executor should have available when running this document. This is a declarative hint -- the script registers the tool name so the executor can verify availability before starting execution.

### Syntax

```
@use filesystem
@use browser
@use mcp:github
@use shell
```

### Regex

```
/^@use\s+(.+)$/gm
```

Capture group 1: the tool or capability name (trimmed).

### What the script does

1. Adds the tool name to a required-tools set for the document.
2. Before execution begins, the executor checks that all declared tools are available. If any tool is missing, execution halts with an error listing the missing tools.
3. The `@use` directive does not generate any cards. It is metadata about the execution environment.
4. Multiple `@use` directives can appear anywhere in the document. They are collected into a single set (duplicates ignored).

### What gets passed to LLM

Nothing directly. However, when a card's body references a tool (e.g., "use the filesystem tool to create the directory"), the executor knows the tool is available because `@use` declared it.

### Example

```
@use filesystem
@use shell
@use mcp:database

---

type: project
id: init

name: MyApp
framework: nextjs@14
pkg: bun

Create the project scaffolding using the shell tool to run bunx create-next-app.
```

The executor verifies that `filesystem`, `shell`, and `mcp:database` are available before processing any cards.

---

## @emit

Emits a named event that other cards can reference in their `depends` field. This creates a virtual synchronization point without a corresponding card. It is useful when multiple cards need to depend on a conceptual milestone that does not map to a single card.

### Syntax

```
@emit schema-ready
@emit api-complete
```

### Regex

```
/^@emit\s+(.+)$/gm
```

Capture group 1: the event name (trimmed).

### What the script does

1. Registers the event name as a valid dependency target in the DAG.
2. The event is considered "completed" when all cards that precede the `@emit` line in document order have been executed.
3. Cards can list the event name in their `depends` field, just like a card id.
4. The `@emit` line does not generate a card. It is a virtual node in the DAG.
5. Event names must not collide with card ids. If a collision is detected, the script raises an error.

### What gets passed to LLM

Nothing. Events are purely a script-level DAG construct.

### Example

```
type: table
id: users
db: db

| column | type | constraints |
|--------|------|-------------|
| id     | text | primary key, uuid |
| email  | text | unique, not null |

---

type: table
id: notes
db: db

| column | type | constraints |
|--------|------|-------------|
| id     | text | primary key, uuid |
| user_id | text | foreign key -> users.id |

---

type: migration
id: db-push
depends: users, notes

Push the schema to the database.

---

@emit schema-ready

---

type: auth
id: auth
depends: schema-ready

Set up authentication. This depends on schema-ready rather than individual table cards, so it will wait for all schema work including the migration.
```

The `schema-ready` event fires after `db-push` completes (because `@emit schema-ready` appears after the migration card). The `auth` card depends on `schema-ready`, so it waits for all schema work to finish.

---

## @hook

Injects the next card's behavior before or after another card's execution. This allows cross-cutting concerns (logging, validation, cleanup) to be expressed as separate cards that attach to existing cards by id.

### Syntax

```
@hook before auth
@hook after delete-note
```

### Regex

```
/^@hook\s+(before|after)\s+(.+)$/gm
```

Capture group 1: the timing -- `before` or `after`.
Capture group 2: the target card id.

### What the script does

1. Takes the next card (everything until the next `---`) as the hook body.
2. Registers the hook with the target card id and the timing (before or after).
3. When the target card is about to be executed, the executor runs all `before` hooks first, then the target card, then all `after` hooks.
4. Multiple hooks can attach to the same card. Hooks with the same timing run in document order.
5. The hook card is removed from the normal card sequence -- it does not appear as a standalone card in the DAG. It runs only as part of the target card's execution.
6. The target card id must exist in the document. If it does not, the script raises an error.
7. Hook cards can have their own header fields (type, id, depends) but their `depends` is automatically set to include the target card's dependencies.

### What gets passed to LLM

The hook card's body is passed to the LLM at execution time, just like any card body. The LLM receives additional context indicating this is a hook running before/after the target card, along with the target card's header data.

### Example

```
type: endpoint
id: delete-note
method: DELETE
path: /api/notes/:id
auth: required
depends: auth

Delete the note and all its tag associations. Return 404 if not found or not owned.

---

@hook before delete-note
type: middleware
id: log-deletion

Log the note id and user id to an audit trail before the deletion executes. Write to `data/audit.log` with timestamp, user_id, note_id, and action "delete".

---

@hook after delete-note
type: middleware
id: cleanup-orphan-tags

After a note is deleted, check if any tags are now orphaned (not associated with any note). If so, delete those tag records to keep the tags table clean.
```

Execution order: `log-deletion` runs first, then `delete-note`, then `cleanup-orphan-tags`.

---

## Directive Processing Order

The script processes directives in this order during the top-down parsing pass:

1. **@import** -- Resolve all imports recursively, producing a single flat document.
2. **@pattern** -- Register all pattern definitions, removing them from the document.
3. **@name(args)** -- Expand all pattern instantiations into concrete cards.
4. **@repeat** -- Expand all repeat directives into multiple cards.
5. **@if** -- Evaluate all conditions and remove cards that fail.
6. **@use** -- Collect all tool declarations into the required-tools set.
7. **@emit** -- Register all event nodes in the DAG.
8. **@hook** -- Attach all hooks to their target cards.

After all directives are processed, the result is a flat sequence of cards with a resolved dependency DAG. The cards are then executed in topological order.

---

## Escaping

If a line must literally start with `@` followed by a directive name (extremely rare), prefix it with a backslash:

```
\@import this is literal text, not a directive
```

The script strips the leading backslash and treats the line as plain text.

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| Cycle detected in @import | File A imports B which imports A | Remove the circular import; use @emit for shared dependencies instead |
| Pattern not found | `@name(args)` references an undefined pattern | Define the pattern with `@pattern name(params)` before using it |
| Argument count mismatch | Pattern expects 3 params, instantiation provides 2 | Match the number of arguments to the pattern's parameter list |
| Duplicate pattern name | Two `@pattern` blocks share a name | Rename one of the patterns |
| Event/card id collision | An `@emit` name matches an existing card id | Use a distinct name for the event |
| Hook target not found | `@hook before xyz` but no card has id `xyz` | Check the target card id for typos |
| Tool not available | `@use` declared a tool the executor cannot find | Install the tool or remove the `@use` directive |
