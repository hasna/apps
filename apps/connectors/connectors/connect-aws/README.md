# connect-aws

AWS connector CLI - S3, Lambda, DynamoDB with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-aws
```

## Quick Start

```bash
# Set your API key
connect-aws config set-key YOUR_API_KEY

# Or use environment variable
export AWS_ACCESS_KEY_ID=YOUR_API_KEY
```

## CLI Commands

### S3
```bash
connect-aws s3 ls                      # List buckets
connect-aws s3 ls <bucket> [prefix]    # List objects
connect-aws s3 get <bucket> <key>      # Download object
connect-aws s3 put <bucket> <key> <file> # Upload file
connect-aws s3 rm <bucket> <key>       # Delete object
connect-aws s3 cp <s3://src> <s3://dst> # Copy object
connect-aws s3 head <bucket> <key>     # Get metadata
```

### Lambda
```bash
connect-aws lambda list                # List functions
connect-aws lambda get <name>          # Get function info
connect-aws lambda invoke <name>       # Invoke function
connect-aws lambda invoke <name> -p '{"key":"value"}' # With payload
connect-aws lambda invoke <name> --async # Async invocation
```

### DynamoDB
```bash
connect-aws dynamodb list              # List tables
connect-aws dynamodb describe <table>  # Describe table
connect-aws dynamodb get <table> <key> # Get item
connect-aws dynamodb put <table> <item> # Put item
connect-aws dynamodb delete <table> <key> # Delete item
connect-aws dynamodb query <table> -k "pk = :pk" -v '...'
connect-aws dynamodb scan <table>
```

### Profile & Config
```bash
connect-aws profile list               # List profiles
connect-aws profile use <name>         # Switch profile
connect-aws profile create <name>      # Create profile
connect-aws config set-credentials --access-key-id <key> --secret-access-key <secret>
connect-aws config set-region <region>
connect-aws config show
```

## Profile Management

```bash
# Create profiles for different accounts
connect-aws profile create work --api-key xxx --use
connect-aws profile create personal --api-key yyy

# Switch profiles
connect-aws profile use work

# Use profile for single command
connect-aws -p personal <command>

# List profiles
connect-aws profile list
```

## Library Usage

```typescript
import { Aws } from '@hasna/connect-aws';

const client = new Aws({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key ID (overrides profile) |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Access Key (overrides profile) |
| `AWS_REGION` | AWS Region (overrides profile, default: us-east-1) |
| `AWS_SESSION_TOKEN` | Session token for temporary credentials |

## Data Storage

Configuration stored in `~/.connect/connect-aws/`:

```
~/.connect/connect-aws/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
