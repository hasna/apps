# connect-terraform-cloud

TypeScript connector for HashiCorp Terraform Cloud / HCP Terraform JSON:API v2.

## Features

- Bearer token authentication
- Multi-profile configuration
- Organizations, workspaces, runs, variables
- State versions, configuration versions
- Teams, projects, policy sets
- CLI with JSON and pretty output

## Quick Start

```bash
cd connectors/terraform-cloud
bun install
bun run dev config set-token <your-token>
bun run dev org ls
bun run dev workspace ls <organization>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TERRAFORM_CLOUD_TOKEN` | API token |
| `TERRAFORM_CLOUD_BASE_URL` | API base URL (default `https://app.terraform.io`) |

## Library Usage

```typescript
import { TerraformCloud } from '@hasna/connect-terraform-cloud';

const tfc = new TerraformCloud({ apiToken: process.env.TERRAFORM_CLOUD_TOKEN! });
const orgs = await tfc.listOrganizations();
const runs = await tfc.listWorkspaceRuns('ws-xxxxxxxx');
```

## License

Apache-2.0
