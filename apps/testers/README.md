# open-testers

AI-powered QA testing CLI — spawns cheap AI agents to test web apps with headless browsers.

## What is this?

`testers` is a CLI tool that creates AI testing agents (Claude Haiku 4.5 by default) to click through your website like a real human. Tests are stored in SQLite, screenshots are captured at every step, and results are queryable.

Part of the [@hasna](https://www.npmjs.com/org/hasnaxyz) open-source ecosystem.

## Install

```bash
npm install -g @hasna/testers

# Install browser (first time only)
testers install-browser
```

## Quick Start

```bash
# Create a test scenario
testers add "Login flow" --description "Test login with valid creds" --tag auth --priority high

# Run all scenarios against your app
testers run http://localhost:3000

# Run with live browser (non-headless)
testers run http://localhost:3000 --headed

# Run a quick ad-hoc test
testers run http://localhost:3000 "verify the signup page loads and shows a form"

# Use a smarter model for complex scenarios
testers run http://localhost:3000 --model sonnet
```

## Features

- **SQLite-backed scenarios** — Define, tag, filter, and reuse test scenarios
- **AI-powered** — Agents navigate, click, fill forms, and verify results autonomously
- **Screenshot-first** — Every action captured and organized by run/scenario/step
- **Cheap by default** — Haiku 4.5 (~$0.001/test), configurable per scenario
- **Headless by default** — Opt-in `--headed` mode to watch AI test live
- **open-todos integration** — Pull QA tasks as test scenarios
- **MCP server** — Let Claude Code trigger tests inline
- **Dashboard** — Web UI for browsing results and screenshots

## CLI Reference

### Scenario Management

```bash
testers add <name> [options]           # Create a test scenario
  --description <desc>                 # Scenario description
  --steps <step>                       # Add a step (repeatable)
  --tag <tag>                          # Add a tag (repeatable)
  --priority <low|medium|high|critical>
  --model <preset|model-id>            # Override model
  --path <path>                        # Target path (e.g., /login)
  --auth                               # Requires authentication
  --timeout <ms>                       # Custom timeout

testers list [options]                 # List scenarios
  --tag <tag>                          # Filter by tag
  --priority <priority>                # Filter by priority

testers show <id>                      # Show scenario details
testers update <id> [options]          # Update scenario
testers delete <id>                    # Delete scenario
```

### Running Tests

```bash
testers run <url> [description]        # Run tests
  --tag <tag>                          # Run scenarios with tag
  --scenario <id>                      # Run specific scenario
  --priority <priority>                # Run by priority
  --headed                             # Watch browser live
  --model <quick|thorough|deep>        # Model preset
  --parallel <n>                       # Concurrent agents (default: 1)
  --json                               # JSON output
  --output <file>                      # Write JSON to file
  --from-todos                         # Pull from open-todos
  --project <name>                     # Filter by project
```

### Results & Analysis

```bash
testers runs                           # List past runs
testers results <run-id>               # Show run results
testers screenshots <id>               # List screenshots
testers replay <run-id>                # Re-run all scenarios from a run
testers retry <run-id>                 # Re-run only failed scenarios
testers diff <run1> <run2>             # Compare two runs (regressions/fixes)
testers report <run-id>                # Generate HTML report with screenshots
testers costs                          # Show cost tracking & budget status
```

### Projects

```bash
testers project create <name>          # Create a project
testers project list                   # List projects
testers project show <id>              # Show project details
testers project use <name>             # Set active project
```

### Schedules (Recurring Tests)

```bash
testers schedule create <name>         # Create recurring schedule
  --cron "0 2 * * *"                   # Cron expression (required)
  --url http://localhost:3000          # Target URL (required)
  --tag <tag>                          # Filter scenarios
  --parallel <n>                       # Concurrent agents
testers schedule list                  # List all schedules
testers schedule enable <id>           # Enable a schedule
testers schedule disable <id>          # Disable a schedule
testers schedule run <id>              # Manually trigger
testers daemon                         # Start scheduler daemon
```

### Smoke Testing

```bash
testers smoke <url>                    # Zero-config autonomous exploration
  --model <preset>                     # AI model
  --headed                             # Watch live
```

### Templates & Auth

```bash
testers add --template auth            # Seed auth test scenarios
testers add --template crud            # Seed CRUD test scenarios
testers add --template forms           # Seed form validation scenarios
testers add --template nav             # Seed navigation scenarios
testers add --template a11y            # Seed accessibility scenarios

testers auth add <name>                # Create auth preset
  --email <email> --password <pwd>
testers auth list                      # List presets
```

### Watch Mode

```bash
testers watch <url>                    # Re-run on file changes
  --dir .                              # Directory to watch
  --tag <tag>                          # Filter scenarios
  --debounce <ms>                      # Debounce delay (default: 2000)
```

### Webhooks

```bash
testers webhook add <url>              # Add webhook for notifications
  --events failed,completed            # Events to listen for
testers webhook list                   # List webhooks
testers webhook test <id>              # Send test payload
testers webhook delete <id>            # Remove webhook
```

### Utilities

```bash
testers init                           # Setup wizard (detects framework)
testers config                         # Show config
testers status                         # Show auth & DB status
testers install-browser                # Install Playwright chromium
testers import <dir>                   # Import markdown tests to DB
testers serve                          # Start dashboard
```

## Model Presets

| Preset | Model | Use Case |
|--------|-------|----------|
| `quick` (default) | Claude Haiku 4.5 | Fast, cheap tests |
| `thorough` | Claude Sonnet 4.6 | Complex flows |
| `deep` | Claude Opus 4.6 | Multi-step critical paths |

## Configuration

Config file: `~/.testers/config.json`

```json
{
  "defaultModel": "claude-haiku-4-5-20251001",
  "browser": {
    "headless": true,
    "viewport": { "width": 1280, "height": 720 }
  },
  "screenshots": {
    "dir": "~/.testers/screenshots",
    "format": "png"
  }
}
```

Environment variables:
- `ANTHROPIC_API_KEY` — Your Anthropic API key (required)
- `TESTERS_DB_PATH` — Custom database path
- `TESTERS_MODEL` — Override default model
- `TESTERS_SCREENSHOTS_DIR` — Custom screenshot directory
- `TESTERS_PORT` — Dashboard server port (default: 19450)

## Screenshots

Screenshots are saved to `~/.testers/screenshots/` organized by:

```
{run-id}/
  {scenario-slug}/
    001-navigate-homepage.png
    002-click-login-button.png
    003-fill-email-field.png
    004-submit-form.png
    005-verify-dashboard.png
```

## MCP Server

Install for Claude Code:

```bash
claude mcp add --transport stdio --scope user testers -- testers-mcp
```

Available tools: `create_scenario`, `list_scenarios`, `run_scenarios`, `get_results`, `get_screenshots`, and more.

## open-todos Integration

Pull QA tasks from [open-todos](https://github.com/hasna/open-todos) as test scenarios:

```bash
testers run http://localhost:3000 --from-todos --project myapp
```

Tasks tagged with `qa`, `test`, or `testing` are automatically imported.

## Dashboard

```bash
testers serve
# Open http://localhost:19450
```

Browse scenarios, runs, results, and screenshots in a web UI.

## Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Database**: SQLite (bun:sqlite)
- **Browser**: Playwright (Chromium)
- **AI**: Anthropic Claude API
- **CLI**: Commander.js
- **Dashboard**: React + Vite + Tailwind CSS

## License

MIT
