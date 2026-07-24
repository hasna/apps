# AGENTS.md

Guidance for AI agents working with connect-workflow-trigger.

## Overview

TypeScript connector for the WorkflowTrigger REST API (`https://api.workflow-trigger.com/v1`). Bearer token auth via API key.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## Security

- No hardcoded API keys
- Use `WORKFLOW_TRIGGER_API_KEY` or profile config only
- No browser-use dependency
