# AGENTS.md

## Project Overview

connect-unit is a TypeScript connector for Unit.sh Banking-as-a-Service API with JSON:API request/response handling.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Structure

```
src/
├── api/           # JSON:API client and resource modules
├── cli/           # Commander CLI
├── types/         # TypeScript types
├── utils/         # Config and output helpers
└── index.ts       # Library exports
```

## Authentication

Bearer token via `UNIT_API_TOKEN` or profile config. Default environment is sandbox.

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- Application endpoints accept attributes via CLI/library — never commit real SSN/EIN values
