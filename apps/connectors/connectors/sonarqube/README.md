# @hasna/connect-sonarqube

TypeScript connector for the [SonarQube Web API](https://docs.sonarsource.com/sonarqube/latest/extension-guide/web-api/).

## Features

- Multi-profile configuration
- Basic token authentication (`token:`)
- CLI for projects, issues, measures, rules, users, groups, quality gates/profiles, webhooks, and compute engine tasks
- Works with SonarQube Server and SonarCloud

## Install

```bash
bun install
```

## Configuration

Set credentials via environment variables or CLI profiles:

```bash
export SONARQUBE_BASE_URL=https://sonarcloud.io
export SONARQUBE_TOKEN=your-token
```

Or use profiles:

```bash
bun run dev config set-base-url https://sonarcloud.io
bun run dev config set-token your-token
```

## CLI Examples

```bash
# System
bun run dev system ping
bun run dev system status

# Projects
bun run dev projects search -q my-app
bun run dev projects show my-project-key

# Issues
bun run dev issues search --project-keys my-project --severities MAJOR,CRITICAL

# Quality gates
bun run dev quality-gates list

# Compute engine
bun run dev ce analysis-status --component my-project-key
```

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
