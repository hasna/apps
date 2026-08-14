# connect-contactout

ContactOut API connector - Find emails, phone numbers, and enrich LinkedIn profiles.

## Installation

```bash
# Install globally
bun install -g @hasna/connect-contactout

# Or run locally
bun install
bun run dev
```

## Quick Start

```bash
# Set your API key
connect-contactout config set-key <your-api-key>

# Enrich a LinkedIn profile
connect-contactout linkedin enrich "https://www.linkedin.com/in/username"

# Get company info from domain (free, no credits)
connect-contactout company domain google.com

# Search for people
connect-contactout people search --company "Google" --title "Engineer" --location "San Francisco"

# Verify an email
connect-contactout email verify test@example.com

# Check API usage
connect-contactout stats show
```

## Multi-Profile Support

```bash
# Create a profile
connect-contactout profile create work --api-key <key> --use

# Switch profiles
connect-contactout profile use personal

# List profiles
connect-contactout profile list

# Use a profile for single command
connect-contactout -p work linkedin enrich <url>
```

## Commands

### LinkedIn

```bash
# Enrich profile with contact info
connect-contactout linkedin enrich <url>
connect-contactout linkedin enrich <url> --profile-only  # Without contact info

# Get contact info only
connect-contactout linkedin contact <url> --phone --email-type personal

# Batch requests
connect-contactout linkedin batch <url1> <url2> <url3>
connect-contactout linkedin batch-async <urls...> --phone --callback <webhook-url>
connect-contactout linkedin job <job-id>

# Check availability (free)
connect-contactout linkedin check-email <url>
connect-contactout linkedin check-phone <url>
```

### People

```bash
# Search
connect-contactout people search --name "John" --company "Google" --title "Engineer"
connect-contactout people search --location "NYC" --industry "Technology" --reveal

# Count (free)
connect-contactout people count --company "Google" --title "Engineer"

# Enrich
connect-contactout people enrich --email test@google.com --name "John Doe"
connect-contactout people enrich --linkedin <url> --include work_email phone

# Decision makers
connect-contactout people decision-makers --domain google.com
connect-contactout people decision-makers --name "Google" --reveal
```

### Company

```bash
# Search
connect-contactout company search --name "Google" --industry "Technology"
connect-contactout company search --size "1000+" --location "California"

# Domain enrichment (free)
connect-contactout company domain google.com microsoft.com apple.com
```

### Email

```bash
# Enrich from email
connect-contactout email enrich test@example.com

# Verify
connect-contactout email verify test@example.com
connect-contactout email verify-batch email1@test.com email2@test.com
connect-contactout email verify-job <job-id>

# Find LinkedIn from email
connect-contactout email to-linkedin test@example.com
```

### Stats

```bash
connect-contactout stats show
connect-contactout stats show --period 2024-01
connect-contactout stats current
```

## Output Formats

```bash
# Pretty print (default)
connect-contactout linkedin enrich <url>

# JSON output
connect-contactout -f json linkedin enrich <url>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONTACTOUT_API_KEY` | API key (overrides profile config) |
| `CONTACTOUT_BASE_URL` | Override base URL |

## Programmatic Usage

```typescript
import { ContactOut } from '@hasna/connect-contactout';

const client = new ContactOut({ apiKey: 'your-key' });

// Or from environment
const client = ContactOut.fromEnv();

// LinkedIn enrichment
const profile = await client.linkedin.enrich({
  profile: 'https://linkedin.com/in/username',
});

// Company domain (free)
const companies = await client.company.enrichFromDomains({
  domains: ['google.com', 'microsoft.com'],
});

// People search
const results = await client.people.search({
  company: ['Google'],
  job_title: ['Engineer'],
  location: ['San Francisco'],
  reveal_info: true,
});

// Email verification
const status = await client.email.verify('test@example.com');
```

## Rate Limits

- People Search: 60 requests/minute
- Contact Checker: 150 requests/minute
- Other endpoints: 1000 requests/minute

## License

Apache-2.0
