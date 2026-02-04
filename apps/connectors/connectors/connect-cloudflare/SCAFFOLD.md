# Scaffold: connect

This is a scaffold template for creating Beep Media API connectors.

## Placeholders

The following placeholders are used throughout this scaffold:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{CONNECTOR_NAME}}` | Lowercase connector name | `notion`, `gmail`, `github` |
| `{{SERVICE_NAME}}` | Human-readable service name | `Notion`, `Gmail`, `GitHub` |
| `{{SERVICE_NAME_UPPER}}` | Uppercase with underscores (for env vars) | `NOTION`, `GMAIL`, `GITHUB` |
| `{{SERVICE_NAME_PASCAL}}` | PascalCase (for class names) | `Notion`, `Gmail`, `GitHub` |

## Creating a New Connector

### Option 1: Using the init script

```bash
# Copy the scaffold to a new directory
cp -r scaffold-connect connect-notion
cd connect-notion

# Run the init script
./scripts/init.sh notion "Notion"
```

### Option 2: Manual replacement

1. Copy the scaffold directory
2. Replace all placeholders in all files
3. Update the API base URL in `src/api/client.ts`
4. Add your API modules

## Infrastructure Naming Convention

Each connector follows this naming pattern:

| Resource | Pattern | Example (for Notion) |
|----------|---------|----------------------|
| CLI | `connect-{name}` | `connect-notion` |
| EC2 Instance | `beepmedia-prod-connect-{name}` | `beepmedia-prod-connect-notion` |
| RDS Database | `beepmedia-prod-connect-{name}` | `beepmedia-prod-connect-notion` |
| S3 Bucket | `beepmedia-prod-connect-{name}` | `beepmedia-prod-connect-notion` |
| Remote API | `https://connect.beepmedia.com/{name}` | `https://connect.beepmedia.com/notion` |

## Project Structure

```
connect-{name}/
├── src/
│   ├── api/
│   │   ├── client.ts      # Base HTTP client with auth
│   │   ├── index.ts       # Main connector class
│   │   └── example.ts     # Example API module (rename/customize)
│   ├── cli/
│   │   └── index.ts       # CLI commands
│   ├── types/
│   │   └── index.ts       # TypeScript types
│   ├── utils/
│   │   ├── config.ts      # CLI config storage
│   │   └── output.ts      # Output formatting
│   └── index.ts           # SDK entry point
├── scripts/
│   └── init.sh            # Initialization script
├── package.json
├── tsconfig.json
├── Makefile
├── README.md
├── CLAUDE.md
├── SCAFFOLD.md            # This file (delete after init)
├── .env.example
└── .gitignore
```

## Adding API Modules

1. **Create the API module** in `src/api/{resource}.ts`:

```typescript
import { {{SERVICE_NAME_PASCAL}}Client } from './client';

export class ResourceApi {
  constructor(private readonly client: {{SERVICE_NAME_PASCAL}}Client) {}

  async get(id: string): Promise<Resource> {
    return this.client.get(`/resources/${id}`);
  }

  async list(): Promise<{ data: Resource[]; hasMore: boolean }> {
    const response = await this.client.get<{ data: Resource[]; _hasMore?: boolean }>('/resources');
    return { data: response.data || [], hasMore: !!response._hasMore };
  }
}
```

2. **Add types** in `src/types/index.ts`:

```typescript
export interface Resource {
  id: string;
  name: string;
  // ...
}
```

3. **Register the module** in `src/api/index.ts`:

```typescript
import { ResourceApi } from './resource';

export class {{SERVICE_NAME_PASCAL}} {
  public readonly resource: ResourceApi;

  constructor(config: {{SERVICE_NAME_PASCAL}}Config) {
    this.client = new {{SERVICE_NAME_PASCAL}}Client(config);
    this.resource = new ResourceApi(this.client);
  }
}
```

4. **Add CLI commands** in `src/cli/index.ts`:

```typescript
const resourceCmd = program.command('resources').description('Manage resources');

resourceCmd
  .command('get <id>')
  .description('Get resource by ID')
  .action(async (id: string) => {
    const client = getClient();
    const resource = await client.resource.get(id);
    print(resource, getFormat(resourceCmd));
  });
```

## Authentication

Update `src/api/client.ts` to match your service's authentication method:

```typescript
// Bearer token (most common)
'Authorization': `Bearer ${this.apiKey}`

// API key header
'X-API-Key': this.apiKey

// Basic auth
'Authorization': `Basic ${btoa(`${this.apiKey}:`)}`

// Custom header
'Api-Key': this.apiKey
```

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run dev

# Build for production
bun run build

# Type check
bun run typecheck
```

## Deployment

The connector is deployed to AWS infrastructure:

1. Build the project: `make build`
2. Deploy to EC2: `make deploy-ec2`
3. Configure the remote API at `https://connect.beepmedia.com/{name}`
