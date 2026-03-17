# open-styles

Style management platform for AI coding agents. Enforce design consistency, manage style profiles, run automated health checks, and auto-inject design context into agent workflows.

## Features

- **10 built-in design styles** — Minimalist, Brutalist, Corporate, Startup, Glassmorphism, Editorial, Retro, Material, Neubrutalism, Neumorphic
- **SQLite-backed profiles, preferences, and project configs** — persistent storage across sessions
- **Automated health checks** — rule-based scanning for inline styles, magic color literals, nested cards, excessive z-index, and forbidden fonts
- **AI-powered inspection** — Cerebras LLM integration for deep design pattern analysis
- **Auto-inject Claude Code hooks** — real-time design enforcement on every file save
- **Auto-create todos tasks** from health violations via todos MCP integration
- **4 interfaces** — CLI (TUI), MCP server, REST API, and npm library

## Install

```bash
# Run without installing
npx @hasnaxyz/styles

# Install globally
bun add -g @hasnaxyz/styles

# Add as a library
bun add @hasnaxyz/styles
```

## Quick Start

```bash
# Initialize the styles directory
styles init

# Set the active style for the current project
styles use minimalist

# Run a health check on the current project
styles health

# List all available styles
styles list

# Get details about a style
styles info brutalist
```

## CLI Reference

### Styles

```bash
styles list                        # List all 10 built-in styles
styles info <name>                 # Show style details (description, principles, tags)
styles use <name>                  # Set active style for the current project
styles init                        # Initialize the ~/.styles directory
```

### Profiles

```bash
styles profile list                # List all custom style profiles
styles profile create              # Interactively create a new profile (TUI)
styles profile get <id-or-name>    # Get a profile by ID or name
styles profile delete <id>         # Delete a profile by ID
```

### Preferences

```bash
styles prefs list                  # List all preferences for the current context
styles prefs set <key> <value>     # Set a preference
styles prefs get <key>             # Get a preference value
```

### Health

```bash
styles health                      # Run a full health check on the current project
styles check-file <file>           # Run health check on a single file
```

### Templates

```bash
styles template list               # List all style templates
styles template apply <id>         # Apply a template to the current project
```

### Server / MCP

```bash
styles serve                       # Start the REST API server
styles mcp                         # Install the MCP server into Claude Code
styles-mcp                         # Run the MCP server directly (stdio transport)
```

## MCP Setup

The MCP server exposes all styles, profiles, preferences, and health check tools to AI coding agents.

```bash
# Install the MCP server into Claude Code
styles mcp

# Or install manually
claude mcp add --transport stdio --scope user styles -- styles-mcp
```

Once installed, Claude Code can use tools like `get_style`, `run_health_check`, `create_profile`, `set_pref`, and more.

## Library Usage

```typescript
import {
  STYLES,
  getStyle,
  searchStyles,
  createProfile,
  getProfile,
  setPref,
  getPref,
  runHealthCheck,
  isCerebrasAvailable,
} from "@hasnaxyz/styles";

// Get a specific style
const minimalist = getStyle("minimalist");

// Search styles by keyword
const results = searchStyles("clean");

// Create a custom profile
const profile = createProfile({
  name: "my-brand",
  displayName: "My Brand",
  description: "Our company design system",
  category: "Corporate",
  principles: ["Clarity over cleverness", "Accessible by default"],
  antiPatterns: ["Nesting cards", "Inline styles"],
  typography: { fontFamily: "Inter", scale: "modular" },
  colors: { primary: "var(--brand-blue)" },
  componentRules: {},
  tags: ["enterprise", "accessible"],
});

// Manage preferences
setPref("active_style", "minimalist", "global");
const style = getPref("active_style"); // "minimalist"

// Run a health check
const result = await runHealthCheck("/path/to/project");
console.log(`Score: ${result.score}, Status: ${result.status}`);
console.log(`Violations: ${result.violations.length}`);
```

## Health Checks

The health check engine scans all `.tsx`, `.jsx`, `.ts`, `.js`, `.css`, `.scss`, `.html`, and `.vue` files in a project, skipping `node_modules`, `dist`, `.git`, `.next`, and other build output directories.

### Built-in Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `no-inline-styles` | warning | Detects `style={{ }}` on JSX elements |
| `no-magic-colors` | warning | Detects hardcoded hex color literals |
| `no-card-nesting` | warning | Detects `<Card>` nested inside `<Card>` |
| `no-excessive-zindex` | info | Flags z-index values >= 50 |
| `no-forbidden-fonts` | warning | Detects Comic Sans, Papyrus, and other unprofessional fonts |

### Scoring

Violations reduce the score from 100:

| Severity | Penalty per violation |
|----------|-----------------------|
| critical | 10 points |
| warning | 3 points |
| info | 1 point |

The score is clamped to `[0, 100]`.

### Status

| Score | Status |
|-------|--------|
| >= 80 | pass |
| >= 50 | warn |
| < 50 | fail |

## AI-Powered Inspection (Cerebras)

When a `CEREBRAS_API_KEY` environment variable is set, open-styles can run AI-powered inspection using the Cerebras `llama-3.3-70b` model. The AI reviewer analyzes each file against the active style profile's principles and anti-patterns, returning specific violations and improvement suggestions.

```bash
export CEREBRAS_API_KEY=your-api-key
styles health  # AI inspection runs automatically if key is present
```

## Hook Auto-Injection

The hook manager can inject a pre-tool-use hook into Claude Code's `.claude/settings.json`. When installed, the hook runs `styles check-file` on every file that Claude Code writes or edits, providing real-time design feedback.

```bash
# Inject the hook into the current project's Claude settings
styles hook install

# Remove the hook
styles hook remove

# Check if the hook is installed
styles hook status
```

The hook entry added to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "styles check-file"
      }]
    }]
  }
}
```

## Custom Styles

Each built-in style has a `styles/style-{name}/STYLE.md` file at the package root. You can create custom styles by adding your own STYLE.md and registering a profile via the CLI or library API.

STYLE.md supports an optional JSON front-matter block for structured data:

```markdown
---json
{
  "description": "Our company design language",
  "principles": ["Brand first", "Accessible always"],
  "antiPatterns": ["Inline styles", "Magic colors"],
  "typography": { "fontFamily": "Inter", "scale": "4/3" },
  "colors": { "primary": "var(--brand-500)" }
}
---

# My Brand Design System

Extended markdown documentation here...
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CEREBRAS_API_KEY` | API key for Cerebras AI-powered inspection. Optional — rule-based health checks work without it. |

## Development

```bash
bun install
bun run dev          # Run CLI in dev mode
bun run dev:mcp      # Run MCP server in watch mode
bun test             # Run tests
bun run build        # Build CLI, MCP server, and library
bun run typecheck    # TypeScript type checking
```

## License

Apache-2.0
