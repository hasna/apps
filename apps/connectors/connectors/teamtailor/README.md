# connect-teamtailor

Teamtailor API connector CLI with multi-profile support.

Wraps the [Teamtailor Public API](https://docs.teamtailor.com/) (JSON:API) to
manage candidates, jobs, job applications, users, departments, locations, and
recruitment stages.

## Installation

```bash
bun install -g @hasna/connect-teamtailor
```

## Quick Start

```bash
# Set your API key (from Settings > Integrations > API keys in Teamtailor)
connect-teamtailor config set-key YOUR_API_KEY

# Or use environment variables
export TEAMTAILOR_API_KEY=YOUR_API_KEY
# Optional: pin the required X-Api-Version header (defaults to a stable version)
export TEAMTAILOR_API_VERSION=20240904
```

Teamtailor authenticates with `Authorization: Token token=<API_KEY>` and
requires an `X-Api-Version` date header on every request. This connector sets
both for you.

## Usage

```bash
# List candidates (JSON:API pagination)
connect-teamtailor candidates list --page 1 --size 20

# Filter and sort jobs
connect-teamtailor jobs list --filter status=published --sort -created-at

# Get a single job, sideloading its department
connect-teamtailor jobs get 42 --include department

# Create a candidate
connect-teamtailor candidates create --data '{"first-name":"Ada","last-name":"Lovelace","email":"ada@example.com"}'

# Update a candidate
connect-teamtailor candidates update 7 --data '{"pitch":"Great fit"}'

# Delete a candidate
connect-teamtailor candidates delete 7

# JSON output for scripting
connect-teamtailor jobs list --format json
```

Supported resources: `candidates`, `jobs`, `applications` (job applications),
`users`, `departments`, `locations`, `stages`. Each supports
`list`, `get`, `create`, `update`, and `delete`.

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

# Run tests
bun test
```

## License

Apache-2.0
