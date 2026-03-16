# @hasna/prompts

Reusable prompt library for AI agents. Save prompts from any session, search them instantly, render templates, and reuse across agents via MCP, CLI, or SDK.

```bash
bun install -g @hasna/prompts
```

---

## Quick Start

```bash
# Save a prompt
prompts save "TypeScript Code Review" \
  --body "Review this TypeScript code for correctness, types, and style:\n\n{{code}}" \
  --tags "code,review,typescript" \
  --collection "code"

# Use it (prints body, increments counter)
prompts use typescript-code-review

# Render a template
prompts render typescript-code-review --var code="$(cat myfile.ts)"

# Search
prompts search "code review"
```

---

## MCP Server

Add to your Claude/agent config:

```json
{
  "mcpServers": {
    "prompts": {
      "command": "prompts-mcp"
    }
  }
}
```

Then in any AI session:

```
Save this as a reusable prompt called "deploy-checklist"
→ prompts_save(title="Deploy Checklist", body="...", collection="devops")

Later, in any session:
→ prompts_use("deploy-checklist")    // body + increments counter
→ prompts_render("deploy-checklist", { env: "production" })
→ prompts_search("deploy")
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `prompts_save` | Create or update a prompt (upsert by slug) |
| `prompts_get` | Get by ID, slug, or partial ID |
| `prompts_list` | List with filters (collection, tags, is_template, source) |
| `prompts_use` | Get body + increment use counter |
| `prompts_delete` | Delete a prompt |
| `prompts_update` | Update fields |
| `prompts_search` | FTS5 full-text search (BM25 ranking) |
| `prompts_similar` | Find similar prompts by tag overlap |
| `prompts_render` | Fill `{{variables}}` in a template |
| `prompts_list_templates` | List templates only |
| `prompts_variables` | Inspect template variables |
| `prompts_validate_vars` | Check which vars are required/optional/extra |
| `prompts_collections` | List collections with counts |
| `prompts_move` | Move prompt to a different collection |
| `prompts_ensure_collection` | Create a collection |
| `prompts_history` | Version history |
| `prompts_restore` | Restore previous version |
| `prompts_export` | Export as JSON |
| `prompts_import` | Import from JSON array |
| `prompts_register_agent` | Register an agent for attribution |
| `prompts_stats` | Usage stats |

---

## CLI Reference

```bash
prompts save <title>        # Save a prompt (--body, --file, or stdin)
prompts use <id|slug>       # Get body, increment counter
prompts get <id|slug>       # Get details without incrementing
prompts list                # List all prompts
prompts search <query>      # Full-text search
prompts render <id> -v k=v  # Render template with variables
prompts templates           # List templates
prompts inspect <id>        # Show template variables
prompts update <id>         # Update fields
prompts delete <id>         # Delete
prompts history <id>        # Version history
prompts restore <id> <v>    # Restore version
prompts collections         # List collections
prompts move <id> <col>     # Move to collection
prompts export              # Export as JSON
prompts import <file>       # Import from JSON
prompts stats               # Usage statistics

# Global flags
prompts list --json         # Machine-readable output
prompts list -c code        # Filter by collection
prompts list -t review,ts   # Filter by tags
```

---

## Templates

Prompts with `{{variable}}` syntax are automatically detected as templates.

```bash
# Save a template
prompts save "PR Description" \
  --body "Write a PR description for this {{language|TypeScript}} change:\n\n{{diff}}\n\nFocus on: {{focus|what changed and why}}"

# Inspect variables
prompts inspect pr-description
# Variables for pr-description:
#   language  optional  (default: "TypeScript")
#   diff      required
#   focus     optional  (default: "what changed and why")

# Render
prompts render pr-description \
  --var diff="$(git diff main)" \
  --var language=Go
```

**Syntax:**
- `{{name}}` — required variable
- `{{name|default value}}` — optional variable with default

---

## SDK

```typescript
import {
  savePrompt, getPrompt, usePrompt, listPrompts,
  searchPrompts, renderTemplate, extractVariables,
  upsertPrompt, importFromJson, exportToJson
} from "@hasna/prompts"

// Save from a session
const { prompt } = await upsertPrompt({
  title: "Summarize Issue",
  body: "Summarize this GitHub issue in 3 bullets:\n\n{{issue_body}}",
  collection: "github",
  tags: ["github", "summary"],
  source: "ai-session",
})

// Use it
const p = usePrompt("summarize-issue")
console.log(p.body)

// Render a template
const result = renderTemplate(p.body, { issue_body: "..." })
console.log(result.rendered)
console.log(result.missing_vars)   // vars not provided
console.log(result.used_defaults)  // vars that fell back to defaults

// Search
const results = searchPrompts("github issue", { collection: "github" })

// Import from Claude Code slash commands
import { importFromClaudeCommands } from "@hasna/prompts"
importFromClaudeCommands([
  { filename: "code-review.md", content: fs.readFileSync(".claude/commands/code-review.md", "utf-8") }
])
```

---

## REST API

```bash
prompts-serve   # starts on port 19430
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/prompts` | List (supports `?collection=`, `?tags=`, `?templates=1`, `?limit=`) |
| POST | `/api/prompts` | Create/upsert |
| GET | `/api/prompts/:id` | Get by ID or slug |
| PUT | `/api/prompts/:id` | Update |
| DELETE | `/api/prompts/:id` | Delete |
| POST | `/api/prompts/:id/use` | Use (increment counter) |
| POST | `/api/prompts/:id/render` | Render template `{ vars: {...} }` |
| GET | `/api/prompts/:id/history` | Version history |
| POST | `/api/prompts/:id/restore` | Restore version `{ version: N }` |
| GET | `/api/prompts/:id/similar` | Similar prompts |
| GET | `/api/prompts/:id/variables` | Template variables |
| GET | `/api/search?q=` | Full-text search |
| GET | `/api/templates` | Templates only |
| GET | `/api/collections` | All collections |
| POST | `/api/collections` | Create collection |
| GET | `/api/stats` | Usage stats |
| GET | `/api/export` | Export JSON |
| POST | `/api/import` | Import JSON |

---

## Web Dashboard

```bash
prompts-serve   # start API on :19430
# open dashboard/dist/index.html or run dashboard dev server
```

Features: browse/search prompts, view/edit body, template renderer with variable inputs, collection sidebar, version history, stats view, create modal.

---

## Data Model

Each prompt has:

| Field | Description |
|-------|-------------|
| `id` | Sequential ID: `PRMT-00001` |
| `slug` | Unique kebab-case slug (auto-generated from title) |
| `title` | Human display name |
| `body` | Prompt content |
| `collection` | Namespace (default: `default`) |
| `tags` | String array for filtering |
| `variables` | Detected `{{vars}}` with required/default info |
| `is_template` | Auto-set when body contains `{{}}` |
| `source` | `manual` \| `ai-session` \| `imported` |
| `use_count` | Times retrieved via `use` |
| `last_used_at` | Last use timestamp |
| `version` | Increments on every edit |

---

## Database Location

Priority order:
1. `PROMPTS_DB_PATH` env var
2. `PROMPTS_DB_SCOPE=project` — uses `.prompts/prompts.db` at git root
3. Global: `~/.prompts/prompts.db`

---

## Import from Claude Code Slash Commands

```bash
# Export existing slash commands as prompts
for f in .claude/commands/*.md; do
  name=$(basename "$f" .md)
  prompts save "$name" --file "$f" --collection claude-commands --tags "slash-command"
done
```

Or programmatically via SDK using `importFromClaudeCommands()`.

---

## License

Apache-2.0
