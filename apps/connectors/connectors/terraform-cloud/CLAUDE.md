# CLAUDE.md

This file provides guidance to Claude Code when working with the Terraform Cloud connector.

## Project Overview

connect-terraform-cloud is a TypeScript connector for HashiCorp Terraform Cloud / HCP Terraform JSON:API v2. It provides a CLI and programmatic interface for organizations, workspaces, runs, variables, state versions, configuration versions, teams, projects, and policy sets.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication against `https://app.terraform.io/api/v2` (or a custom Terraform Enterprise base URL).

- Token: https://app.terraform.io/app/settings/tokens
- Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.api+json`
- POST/PATCH bodies use `Content-Type: application/vnd.api+json`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TERRAFORM_CLOUD_TOKEN` | API token (overrides profile) |
| `TERRAFORM_CLOUD_BASE_URL` | Base URL (default `https://app.terraform.io`) |

## Data Storage

```
~/.hasna/connectors/connect-terraform-cloud/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON:
```json
{
  "apiToken": "your-token",
  "baseUrl": "https://app.terraform.io"
}
```

## CLI Commands

```bash
connect-terraform-cloud config set-token <token>
connect-terraform-cloud org ls
connect-terraform-cloud workspace ls <org>
connect-terraform-cloud run create <workspaceId> --message "API trigger"
connect-terraform-cloud var create <workspaceId> --key region --value us-east-1
```

## Project Structure

```
src/
├── api/
│   ├── client.ts       # JSON:API HTTP client
│   ├── index.ts        # TerraformCloud API wrapper
│   └── client.test.ts
├── cli/index.ts
├── types/index.ts
├── utils/config.ts
├── utils/output.ts
└── index.ts
```
