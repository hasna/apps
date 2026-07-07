# AGENTS.md

## Project Overview

connect-sonarqube is a TypeScript connector for the SonarQube Web API with multi-profile configuration and CLI access to `/api/*` endpoints.

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
├── api/           # HTTP client and API modules
├── cli/           # Commander CLI
├── types/         # TypeScript types
├── utils/         # config + output helpers
└── index.ts       # Library exports
```

## Authentication

Basic auth with token as username and empty password. Both `SONARQUBE_BASE_URL` and `SONARQUBE_TOKEN` are required.

## Adding API Modules

1. Create `src/api/<module>.ts`
2. Export from `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`
