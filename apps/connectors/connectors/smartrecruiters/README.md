# connect-smartrecruiters

SmartRecruiters API connector with multi-profile support. Manage jobs,
candidates, public postings, users, and configuration reference data from the
CLI or as a TypeScript library.

## Installation

```bash
bun install -g @hasna/connect-smartrecruiters
```

## Authentication

The connector uses a SmartRecruiters company **API key** (SmartToken), sent as
the `X-SmartToken` request header against `https://api.smartrecruiters.com`.

Create a key in SmartRecruiters under **Settings → Apps & Integrations →
Credentials**.

```bash
# Save the key to the active profile
connect-smartrecruiters config set-key YOUR_API_KEY

# Or use an environment variable
export SMARTRECRUITERS_API_KEY=YOUR_API_KEY
```

The public Posting API is keyed by a company identifier. Set a default so you
can omit it on posting commands:

```bash
connect-smartrecruiters config set-company YOUR_COMPANY_IDENTIFIER
# or
export SMARTRECRUITERS_COMPANY_ID=YOUR_COMPANY_IDENTIFIER
```

## CLI Usage

```bash
connect-smartrecruiters [options] [command]

Global options:
  -k, --api-key <key>      API key / SmartToken (overrides config)
  -f, --format <format>    Output format (json, pretty)   [default: pretty]
  -p, --profile <profile>  Use a specific profile
  -v, --verbose            Verbose output

Jobs:
  job list [--query --status --posting-status --limit --offset]
  job get <jobId>
  job status <jobId>
  job hiring-team <jobId>

Candidates:
  candidate list [--query --updated-after --limit --offset]
  candidate get <candidateId>
  candidate list-by-job <jobId> [--status --limit --offset]
  candidate status <jobId> <candidateId>

Postings (public job board):
  posting list [--company --query --department --city --country --limit --offset]
  posting get <postingId> [--company]

Users:
  user list [--query --status --limit --offset]
  user get <userId>

Configuration:
  configuration departments
  configuration locations
  configuration functions
  configuration industries

Profiles & config:
  profile list | use <name> | create <name> | delete <name> | show [name]
  config set-key <key> | set-company <id> | show | clear
```

### Examples

```bash
# List open jobs as JSON
connect-smartrecruiters -f json job list --status SOURCING --limit 25

# Inspect a job's hiring team
connect-smartrecruiters job hiring-team 1a2b3c

# List applicants on a job
connect-smartrecruiters candidate list-by-job 1a2b3c --status NEW

# Browse a company's public postings
connect-smartrecruiters posting list --company acme --query engineer
```

## Library Usage

```typescript
import { SmartRecruiters } from '@hasna/connect-smartrecruiters';

const sr = SmartRecruiters.fromEnv(); // reads SMARTRECRUITERS_API_KEY

const jobs = await sr.jobs.list({ status: 'SOURCING', limit: 20 });
const applicants = await sr.candidates.listByJob('job-id');
const postings = await sr.postings.list({ limit: 10 }, 'acme');
```

## Multi-Profile Configuration

Profiles are stored under `~/.hasna/connectors/connect-smartrecruiters/`:

```
~/.hasna/connectors/connect-smartrecruiters/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Environment Variables

| Variable                     | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| `SMARTRECRUITERS_API_KEY`    | Company API key (SmartToken)                       |
| `SMARTRECRUITERS_COMPANY_ID` | Default company identifier for the Posting API     |
| `SMARTRECRUITERS_BASE_URL`   | Override the API base URL (optional)               |

## Development

```bash
bun install
bun run dev        # run the CLI from source
bun run typecheck  # type-check
bun run build      # build dist/ and bin/
bun test           # run tests
```

## License

Apache-2.0
