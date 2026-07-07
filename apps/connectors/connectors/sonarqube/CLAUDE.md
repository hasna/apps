# CLAUDE.md

## Project Overview

connect-sonarqube is a TypeScript connector for the SonarQube Web API. It provides multi-profile configuration, token-based Basic authentication, and a CLI for code quality operations.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

SonarQube uses Basic auth with the user token as username and an empty password:

```typescript
Authorization: Basic base64(`${token}:`)
```

Credentials via:
- `SONARQUBE_TOKEN` and `SONARQUBE_BASE_URL` environment variables
- Profile configuration: `connect-sonarqube config set-token <token>`

## API Modules

- **SystemApi**: status, health, ping
- **ProjectsApi**: search, show, create, delete
- **IssuesApi**: search
- **MeasuresApi**: component, search
- **RulesApi**: search
- **UsersApi**: search
- **GroupsApi**: search
- **QualityGatesApi**: list, show
- **QualityProfilesApi**: search
- **WebhooksApi**: list, create, delete
- **CeApi**: activity, analysis_status

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SONARQUBE_TOKEN` | SonarQube user token (required) |
| `SONARQUBE_BASE_URL` | SonarQube instance URL (required) |

## Data Storage

```
~/.hasna/connectors/sonarqube/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```
