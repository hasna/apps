# Open Markdown Protocol (OMP) v1 Specification

Version: 1.0.0
Status: Draft
Date: 2026-03-22

---

## 1. Overview

### 1.1 What is OMP?

The Open Markdown Protocol (OMP) is an open standard for structured markdown that serves as an intermediate representation (IR) between AI models. A smart, expensive LLM (the **planner**) writes an OMP document. A cheap, fast LLM paired with a deterministic regex-based parser (the **executor**) reads and executes it.

OMP is not a programming language. It contains no code. It is a specification format that blends deterministic machine-parseable data with natural language instructions, producing documents that are simultaneously:

- **Human-readable** -- any developer can open the `.omp.md` file and understand the project
- **Machine-parseable** -- a regex parser extracts all structured data without an LLM
- **LLM-executable** -- a cheap model follows the natural language instructions card by card

### 1.2 The Planner-Executor Model

```
Smart LLM (planner)          OMP Document          Cheap LLM + Parser (executor)
     |                           |                          |
     |   writes structured   --> |                          |
     |   markdown with           | --- parse headers ----> |  deterministic (regex)
     |   full application        | --- extract tables ---> |  deterministic (regex)
     |   context                 | --- resolve {{}} -----> |  built-in tools / cheap LLM
     |                           | --- read NL body -----> |  cheap LLM
     |                           |                          |
     |                           |                     code / artifacts
```

The planner has full application context and produces a complete OMP document specifying every unit of work as a card. The executor processes each card by extracting structured data deterministically, then using a cheap LLM only for the natural language body. The expensive model is called once (planning). Execution is cheap.

### 1.3 Why Markdown?

- Renders natively in every code editor, GitHub, GitLab, and documentation tool
- Developers already know how to read and write it
- Tables, lists, and headers provide natural structure without inventing new syntax
- The `.omp.md` extension means any markdown viewer renders it as readable documentation
- Diff-friendly for version control

---

## 2. The Three Layers

Every OMP document consists of three layers, each processed by a different mechanism:

| Layer | Where it appears | How it is parsed | Cost |
|-------|-----------------|------------------|------|
| **Deterministic** | Card headers (`key: value`), markdown tables in bodies | Regex -- no LLM | Zero |
| **Probabilistic** | Natural language prose in card bodies | Cheap LLM | Low |
| **Inline blend** | `{{}}` directives in headers or bodies | Built-in tools (deterministic) or cheap LLM (probabilistic) | Zero or low |

**Deterministic**: all card headers and structured data (markdown tables, lists) are extracted with regex before any LLM call. **Probabilistic**: prose paragraphs in card bodies are passed to a cheap LLM with the deterministic data as context. **Inline blend**: `{{}}` directives are classified as deterministic (matches a built-in tool like `{{uuid}}`) or probabilistic (free-form text for the cheap LLM). Deterministic directives resolve first, so their outputs are visible to the LLM.

---

## 3. Document Structure

### 3.1 File Extension and Encoding

OMP documents use the double extension `.omp.md` (e.g., `app.omp.md`, `api/endpoints.omp.md`). The `.md` suffix ensures standard rendering; the `.omp` prefix identifies the file for tooling. Documents MUST be UTF-8 encoded. MIME type: `text/markdown`.

### 3.2 Title

Every document begins with a single `#` heading before the first card separator. This is metadata only -- it does not create a card.

### 3.3 Cards

The fundamental unit is the **card**. Cards are separated by `---` (horizontal rule). Each card is one discrete unit of work.

```markdown
# NoteApp

---

type: project
id: init

Initialize the project.

---

type: database
id: db
depends: init

Configure the database.
```

### 3.4 Card Anatomy

Every card has two parts separated by the first blank line after the `---`:

```
---

type: endpoint            <- header: key-value lines, no blanks between them
id: list-notes
method: GET
path: /api/notes
depends: auth
                          <- first blank line: header ends, body begins
Return all notes for      <- body: natural language, tables, accepts
the authenticated user.

accepts: only user's own notes returned
```

**Header**: one or more `key: value` lines with no blank lines between them.

**Body**: everything after the first blank line until the next `---` or EOF. Contains natural language prose, markdown tables, lists, `{{}}` inline directives, and optionally an `accepts:` line.

A card with no body (header only) is valid.

---

## 4. Card Format

### 4.1 Required and Optional Fields

Every card MUST have `type` and `id`. Universal optional fields:

| Field | Description |
|-------|-------------|
| `depends` | Comma-separated card IDs or `@emit` event names this card waits for |
| `tags` | Comma-separated labels for filtering and grouping |

Additional fields are type-specific. See [Section 7](#7-card-types).

### 4.2 Header Parsing

Headers are parsed line by line with `/^(\w[\w-]*)\s*:\s*(.+)$/`. Non-matching lines in the header block are parsing errors.

### 4.3 Header Value Types

| Syntax | Type | Example |
|--------|------|---------|
| bare word or phrase | string | `method: GET` |
| number | number | `sample-notes: 5` |
| `[a, b, c]` | array | `tags: [work, personal, ideas]` |
| `{k: v, k2: v2}` | object | `body: {title: string, content: string}` |

### 4.4 The `depends` Field

Declares edges in the execution DAG. Every ID MUST reference an existing card or `@emit` event. Circular dependencies are forbidden. A card with no `depends` can execute immediately.

### 4.5 The `accepts` Field

Testable acceptance criteria as a semicolon-separated list. Can appear as a header field or at the end of the body (both locations are concatenated). Serves as a contract between planner and executor, input for test generation, and validation checkpoints.

### 4.6 ID Rules

IDs MUST be unique across the entire merged document, are case-sensitive, SHOULD use lowercase kebab-case, and MUST match `/^[\w][\w-]*$/`.

---

## 5. Directives (`@`)

Directives are lines beginning with `@` that control document structure, composition, and execution. They operate at the document level, outside of or between cards. Processed in a top-down pass before building the card DAG.

For the complete specification with regex patterns, processing rules, and examples, see [directives.md](directives.md).

### 5.1 Summary

| Directive | Purpose | Example |
|-----------|---------|---------|
| `@import` | Include another OMP file | `@import ./auth.omp.md` |
| `@pattern` | Define a reusable card template | `@pattern crud-api(entity, fields)` |
| `@name(args)` | Instantiate a defined pattern | `@crud-api(notes, title\|content)` |
| `@repeat N` | Repeat the next card N times | `@repeat 3` |
| `@if condition` | Conditionally include next card | `@if the project uses authentication` |
| `@use tool` | Declare a tool/MCP dependency | `@use mcp:filesystem` |
| `@emit event` | Create a virtual DAG node | `@emit schema-ready` |
| `@hook timing id` | Inject behavior around a card | `@hook after delete-note` |

### 5.2 Processing Order

Directives are processed in this strict order:

1. **@import** -- resolve all imports recursively, producing a flat document
2. **@pattern** -- register all pattern definitions, removing them from the document
3. **@name(args)** -- expand all pattern instantiations into concrete cards
4. **@repeat** -- expand repeat directives into multiple cards
5. **@if** -- evaluate conditions and remove cards that fail
6. **@use** -- collect tool declarations into the required-tools set
7. **@emit** -- register event nodes in the DAG
8. **@hook** -- attach hooks to their target cards

---

## 6. Inline Directives (`{{}}`)

Inline directives use `{{content}}` syntax and can appear anywhere in card headers or bodies. Resolved after all `@` directives but before cards are sent to the execution LLM.

For the complete specification with regex patterns, classification rules, and examples, see [inline-directives.md](inline-directives.md).

### 6.1 Classification

**Deterministic (built-in tool)** -- matches a known pattern, resolved with no LLM call:

| Directive | Output |
|-----------|--------|
| `{{random(N, charset)}}` | Cryptographically random string |
| `{{uuid}}` | UUID v4 |
| `{{timestamp}}` / `{{timestamp:format}}` | ISO 8601 or formatted timestamp |
| `{{env:VAR}}` | Environment variable value |
| `{{ref:card-id.key}}` | Header value from another card |
| `{{count:type}}` | Number of cards of a given type |
| `{{index}}` | Current iteration inside `@repeat` |
| `{{hash:algo:input}}` | Hash digest of input string |

**Probabilistic (LLM prompt)** -- no built-in match, sent to cheap LLM with card context:

```
{{generate 5 realistic note titles for a productivity app}}
{{a friendly empty state message for when there are no notes}}
```

### 6.2 Resolution Order

1. Inner directives resolve before outer: `{{hash:sha256:{{ref:init.name}}}}` resolves `ref` first
2. Deterministic resolve before probabilistic
3. Top-to-bottom within a card
4. Cards earlier in DAG order resolve first

---

## 7. Card Types

The `type` field determines how the executor processes a card -- which header keys it expects, what structured data it extracts, and what context it provides to the LLM.

For required/optional fields, regex patterns, and examples for each type, see [card-types.md](card-types.md).

### 7.1 Type Registry

| Type | Purpose |
|------|---------|
| `project` | Project initialization and global configuration |
| `database` | Database connection and ORM setup |
| `table` | Database table schema (columns as markdown table) |
| `migration` | Schema migration execution |
| `auth` | Authentication and session management |
| `endpoint` | API route definition |
| `page` | Frontend page/route |
| `layout` | Shared layout wrapper |
| `component` | Reusable UI component |
| `functions` | Utility functions in a single file |
| `tree` | File/directory structure declaration |
| `middleware` | Request/response middleware |
| `test` | Test suite definition |
| `seed` | Database seeding script |
| `deploy` | Deployment configuration |
| `cron` | Scheduled recurring task |
| `job` | Background job/worker |
| `email` | Email template or sending logic |
| `call` | External API or MCP tool invocation |
| `monitor` | Health checks and monitoring |
| `custom` | Escape hatch -- all headers extracted, no type-specific validation |

---

## 8. Patterns

Patterns are reusable card templates defined with `@pattern` and instantiated with `@name(args)`. They expand into concrete cards with parameter substitution.

### 8.1 Defining and Instantiating

```
@pattern rest-endpoint(method, path, entity, desc)
type: endpoint
id: {{method}}-{{entity}}
method: {{method}}
path: /api/{{path}}
auth: required
depends: auth

{{desc}}
```

Instantiate with `@rest-endpoint(GET, notes, list-notes, Return all notes)`. The LLM sees expanded cards as if hand-written.

### 8.2 Built-in Patterns

**`@crud-api(entity, fields)`** -- expands to 5 endpoint cards (list, create, get, update, delete).

**`@page-set(entity, features)`** -- expands to list and detail/editor page cards.

### 8.3 Expansion Rules

1. Parameters are positional, comma-separated
2. `{{param}}` placeholders replaced with corresponding arguments
3. Expansion happens before inline directive resolution
4. Card IDs after substitution MUST be unique
5. Patterns may contain multiple `---`-separated cards
6. Patterns cannot nest

For the full specification, see [directives.md](directives.md).

---

## 9. Imports

```
@import ./path/to/file.omp.md
```

Path is resolved relative to the importing file's directory.

**Rules**: relative paths only (`./` or `../`); `.omp.md` extension required; recursive resolution supported; circular imports rejected; imported cards appear at the `@import` position.

**Merging**: all IDs must be unique across the combined document. Imported and parent cards may freely reference each other's IDs in `depends`. The DAG is built from the merged set.

For the full specification, see [directives.md](directives.md).

---

## 10. Execution Model

### 10.1 Pipeline

```
1. Parse          Split on --- into cards, extract headers and bodies
2. Resolve        Process @import, merge imported cards
3. Expand         Process @pattern/@repeat/@if, produce final card set
4. Validate       Check required fields, unique IDs, valid references, no cycles
5. Resolve {{}}   Evaluate inline directives (deterministic first, then LLM)
6. Build DAG      Construct dependency graph from depends fields
7. Execute        Process cards in topological order
```

### 10.2 Stages

**Parse**: extract title from `#` line; split on `---`; separate header from body at first blank line; parse headers with `/^(\w[\w-]*)\s*:\s*(.+)$/`; extract tables and `accepts:` from body.

**Resolve imports**: scan `@import` directives in order; recursively resolve; maintain visited-paths set for cycle detection; replace directives with parsed cards.

**Expand**: register `@pattern` blocks; substitute `@name(args)` instantiations; duplicate `@repeat N` cards with `{{index}}`; evaluate `@if` conditions; collect `@use`, `@emit`, `@hook`.

**Validate**: every card has `type` and `id`; all IDs unique; all `depends` references valid; no cycles; all `{{ref}}` and `{{env}}` references valid; all `{{}}` well-formed.

**Resolve inline directives**: Pass 1 resolves all deterministic built-ins (`uuid`, `timestamp`, `random`, `env`, `ref`, `count`, `index`, `hash`). Pass 2 sends remaining `{{...}}` to cheap LLM with card context.

**Build DAG**: create node per card; add edges from `depends`; topological sort; group independent cards into parallel groups.

**Execute**: for each card or parallel group -- extract structured data from headers, extract tables from body, build prompt for cheap LLM (see Section 11), LLM generates implementation, validate against `accepts`. Cards in a parallel group MAY execute concurrently.

### 10.3 DAG Example

```
init
 |-- db
 |    |-- users, notes (tables)
 |    |-- db-push (depends: users, notes)
 |         |-- auth
 |              |-- list-notes, create-note, delete-note (parallel)
 |-- root-layout
      |-- notes-list (also depends: list-notes)
```

---

## 11. Prompt Engineering

### 11.1 How the Runtime Builds Prompts

When a card body requires LLM processing, the executor constructs:

```
You are implementing a card of type "{type}" with id "{id}".

## Structured Data (already extracted)
{all header key-value pairs}
{all tables extracted from the body}

## Context from Dependencies
{for each card in depends: summary of what it produced}

## Instructions
{card body text, with {{}} directives already resolved}

## Acceptance Criteria
{the accepts field, if present}

Implement this card. Follow the instructions exactly.
Do not deviate from the structured data provided.
```

### 11.2 Why This Works with Cheap Models

The prompt makes the cheap LLM's job narrow: it knows **what to build** (type), has **structured data pre-extracted** (headers/tables), knows **what exists** (dependency summaries), knows **what done looks like** (accepts), and **just follows prose** (body). Even small models (GPT-4o-mini, Claude Haiku, Llama 3.1 8B) produce correct output because the planner already made all the hard decisions.

---

## 12. Complete Example

A three-card document:

```markdown
# TaskTracker

@use mcp:filesystem

---

type: project
id: init
framework: nextjs@14
language: typescript
pkg: bun

Initialize the project scaffolding. Enable strict TypeScript.

---

type: database
id: db
engine: sqlite
orm: drizzle
file: data/tasks.db
depends: init

Configure Drizzle ORM to connect to SQLite at the specified path.
Create the database client at `src/db/index.ts`.

---

type: table
id: tasks
db: db

| column     | type     | constraints       |
|------------|----------|-------------------|
| id         | text     | primary key, uuid |
| title      | text     | not null          |
| status     | text     | default 'pending' |
| created_at | datetime | default now       |

Define in `src/db/schema/tasks.ts`.

accepts: status defaults to pending; id is uuid
```

Processing: parse 3 cards + `@use` directive; no imports or patterns to resolve; validate IDs/depends; no `{{}}` to resolve; build DAG `init -> db -> tasks`; execute in order, each body sent to cheap LLM with headers as context.

---

## 13. Validation Rules

| Rule | Details |
|------|---------|
| Required fields | Every card MUST have `type` and `id` |
| Unique IDs | All IDs unique across merged document; case-sensitive; should be kebab-case |
| Dependency integrity | Every `depends` ID must exist; no self-references; no cycles |
| Inline directive integrity | `{{` must have `}}`; `ref` must point to valid card.key; `env` must be defined; `index` only inside `@repeat` |
| Import integrity | Paths must resolve to `.omp.md` files; no circular imports |
| Type-specific (warnings) | `endpoint` expects `method`/`path`; `page` expects `path`; `table` expects `db`; `database` expects `engine`; `auth` expects `method` |

---

## 14. Grammar Summary

### Document

```
document     = title NL (directive | separator card)* EOF
title        = "#" SP text NL
separator    = "---" NL
directive    = "@" directive-name arguments? NL
```

### Card

```
card         = header blank-line body?
header       = header-line+
header-line  = key ":" SP value NL
key          = /[\w][\w-]*/
value        = string | number | array | object
body         = (paragraph | table | accepts-line | inline-directive)*
accepts-line = "accepts:" SP assertion (";" SP assertion)* NL
```

### Inline Directives

```
inline       = "{{" expression "}}"
expression   = builtin-tool | llm-prompt
builtin-tool = "random(" number "," charset ")" | "uuid"
             | "timestamp" (":" format)? | "env:" var-name
             | "ref:" card-id "." key | "count:" type-name
             | "index" | "hash:" algorithm ":" input
llm-prompt   = text
```

### Directives

```
import       = "@import" SP path NL
pattern-def  = "@pattern" SP name "(" params ")" NL template-body
pattern-call = "@" name "(" args ")" NL
repeat       = "@repeat" SP number NL
conditional  = "@if" SP condition NL
use          = "@use" SP tool-ref NL
emit         = "@emit" SP event-name NL
hook         = "@hook" SP ("before" | "after") SP card-id NL
```

---

## 15. Design Rationale

**Why no code?** OMP specifies *what* to build, not *how*. Including code would tie the document to a language and reduce the planner's ability to be technology-agnostic. The executor generates code.

**Why both deterministic and probabilistic?** Pure deterministic formats (JSON, OpenAPI) are verbose. Pure NL is ambiguous and expensive. OMP uses regex for everything that CAN be structured and reserves LLM processing for the body. Minimizes cost, maximizes reliability.

**Why cards?** Self-contained units with `---` boundaries enable parallel execution, incremental processing, DAG-based reordering, cross-file modularity via `@import`, and focused LLM context per call.

**Why `accepts`?** Terse semicolon-separated criteria serve as planner-executor contract, test generation input, and validation checkpoints -- without verbose AC-XX numbered lists.

---

## Reference Documents

| Document | Content |
|----------|---------|
| [directives.md](directives.md) | Complete `@` directive specification: syntax, regex, processing rules, examples |
| [card-types.md](card-types.md) | All card types: required/optional fields, regex extraction, LLM interpretation |
| [inline-directives.md](inline-directives.md) | All `{{}}` syntax: built-in tools, LLM prompts, resolution order |
