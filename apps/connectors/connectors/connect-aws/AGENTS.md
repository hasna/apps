# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-aws is a TypeScript connector for AWS services (S3, Lambda, DynamoDB) with multi-profile configuration support. It implements AWS Signature V4 signing natively without requiring the AWS SDK.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-aws config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-aws/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses AWS Signature V4 signing for all requests. Credentials can be set via:
- Environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Profile configuration: `connect-aws config set-credentials`

### Service APIs

Each AWS service has its own API module:
- **S3Api**: List buckets, list/get/put/delete objects, copy objects
- **LambdaApi**: List functions, get function info, invoke functions
- **DynamoDBApi**: List/describe tables, get/put/delete/query/scan items

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key ID (overrides profile) |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Access Key (overrides profile) |
| `AWS_REGION` | AWS Region (overrides profile, default: us-east-1) |
| `AWS_SESSION_TOKEN` | Session token for temporary credentials |

## Data Storage

```
~/.connect/connect-aws/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
