# connect-zendesk

A TypeScript CLI and SDK for the Zendesk API. Built with Bun.

This connector provides programmatic access to Zendesk's Support API, including tickets, users, organizations, and groups.

## Infrastructure

| Resource | Name |
|----------|------|
| EC2 Instance | `hasna-prod-connect-zendesk` |
| RDS Database | `hasna-prod-connect-zendesk` |
| S3 Bucket | `hasna-prod-connect-zendesk` |
| Remote API | configured per deployment via `ZENDESK_REMOTE_API_URL` (no default) |

## Installation

### From npm (recommended)

```bash
# Install globally
npm install -g @hasna/connect-zendesk
# or
bun add -g @hasna/connect-zendesk
```

### From source

```bash
# Clone and install globally
git clone https://github.com/hasna/connect-zendesk.git
cd connect-zendesk
bun install -g .

# Or link for development
bun link
```

### As a Dependency

```bash
bun add @hasna/connect-zendesk
```

## Quick Start

### CLI Usage

```bash
# Configure authentication
connect-zendesk config set-email your-email@company.com
connect-zendesk config set-token YOUR_API_TOKEN
connect-zendesk config set-base-url https://your-subdomain.zendesk.com/api/v2

# Or use environment variables
export ZENDESK_EMAIL=your-email@company.com
export ZENDESK_API_TOKEN=YOUR_API_TOKEN
export ZENDESK_BASE_URL=https://your-subdomain.zendesk.com/api/v2

# List tickets
connect-zendesk tickets list

# Get a specific ticket
connect-zendesk tickets get 12345

# Create a ticket
connect-zendesk tickets create -s "Issue Subject" -b "Issue description"

# List users
connect-zendesk users list

# Get current user
connect-zendesk users me
```

### SDK Usage

```typescript
import { Zendesk } from 'connect-zendesk';

// Initialize with credentials
const client = new Zendesk({
  email: 'your-email@company.com',
  apiToken: 'YOUR_API_TOKEN',
  baseUrl: 'https://your-subdomain.zendesk.com/api/v2'
});

// Or use environment variables
const client = Zendesk.fromEnv();

// Work with tickets
const tickets = await client.tickets.list();
const ticket = await client.tickets.get(12345);
const newTicket = await client.tickets.create({
  ticket: {
    subject: 'Help needed',
    comment: { body: 'Description of the issue' }
  }
});

// Work with users
const users = await client.users.list();
const currentUser = await client.users.me();

// Work with organizations
const orgs = await client.organizations.list();
const org = await client.organizations.get(123);

// Work with groups
const groups = await client.groups.list();
```

## CLI Commands

### Configuration

```bash
connect-zendesk config set-email <email>       # Set Zendesk email
connect-zendesk config set-token <token>       # Set API token
connect-zendesk config set-base-url <url>      # Set base URL
connect-zendesk config set-account <name>      # Set default account
connect-zendesk config show                    # Show configuration
connect-zendesk config clear                   # Clear configuration
```

### Tickets

```bash
connect-zendesk tickets list                   # List all tickets
connect-zendesk tickets list -p 2 -l 50        # List with pagination
connect-zendesk tickets get <id>               # Get ticket by ID
connect-zendesk tickets create -s "Subject" -b "Body"  # Create ticket
connect-zendesk tickets update <id> -s "New Subject"   # Update ticket
connect-zendesk tickets delete <id>            # Delete ticket
```

### Users

```bash
connect-zendesk users list                     # List all users
connect-zendesk users list -r agent            # List users by role
connect-zendesk users get <id>                 # Get user by ID
connect-zendesk users me                       # Get current user
connect-zendesk users create -n "Name" -e "email@example.com"  # Create user
connect-zendesk users search -q "email@example.com"  # Search users
```

### Organizations

```bash
connect-zendesk organizations list             # List all organizations
connect-zendesk orgs get <id>                  # Get organization by ID
connect-zendesk orgs create -n "Company Name"  # Create organization
connect-zendesk orgs search -q "Company"       # Search organizations
```

### Groups

```bash
connect-zendesk groups list                    # List all groups
connect-zendesk groups get <id>                # Get group by ID
```

### Remote API

```bash
connect-zendesk remote status                  # Check remote API status
connect-zendesk remote health                  # Check remote API health
```

## Output Formats

Use the `-f` or `--format` flag to change output format:

```bash
connect-zendesk remote status -f json      # JSON output
connect-zendesk remote status -f table     # Table output
connect-zendesk remote status -f pretty    # Pretty output (default)
```

## API Reference

### Zendesk Class

```typescript
import { Zendesk } from 'connect-zendesk';

const client = new Zendesk({
  email: 'your-email@company.com',
  apiToken: 'YOUR_API_TOKEN',
  baseUrl: 'https://your-subdomain.zendesk.com/api/v2'
});

// Available APIs
client.tickets          // Tickets API
client.users            // Users API
client.organizations    // Organizations API
client.groups           // Groups API
```

### Authentication

Zendesk uses Basic Authentication with the following format:
- Email: Your Zendesk account email
- API Token: Generated in Zendesk Admin Center > Apps and integrations > APIs > Zendesk API > Settings
- Base64 encode: `{email}/token:{api_token}`

The connector handles this authentication automatically.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZENDESK_EMAIL` | Your Zendesk email address |
| `ZENDESK_API_TOKEN` | Your Zendesk API token |
| `ZENDESK_BASE_URL` | Your Zendesk base URL (e.g., https://your-subdomain.zendesk.com/api/v2) |

## Development

```bash
# Install dependencies
bun install

# Run CLI in development mode
bun run dev

# Build for production
bun run build

# Type check
bun run typecheck
```

## API Modules

This connector implements the following Zendesk API modules:

### Tickets API (`client.tickets`)
- `list(params?)` - List all tickets
- `get(ticketId)` - Get a ticket by ID
- `create(data)` - Create a new ticket
- `update(ticketId, data)` - Update a ticket
- `delete(ticketId)` - Delete a ticket
- `listByUser(userId, params?)` - List tickets for a user
- `listByOrganization(orgId, params?)` - List tickets for an organization
- `search(query, params?)` - Search tickets

### Users API (`client.users`)
- `list(params?)` - List all users
- `get(userId)` - Get a user by ID
- `create(data)` - Create a new user
- `update(userId, data)` - Update a user
- `delete(userId)` - Delete a user
- `me()` - Get current authenticated user
- `searchByEmail(email)` - Search users by email
- `searchByName(name)` - Search users by name
- `listByOrganization(orgId, params?)` - List users in an organization

### Organizations API (`client.organizations`)
- `list(params?)` - List all organizations
- `get(orgId)` - Get an organization by ID
- `create(data)` - Create a new organization
- `update(orgId, data)` - Update an organization
- `delete(orgId)` - Delete an organization
- `search(name)` - Search organizations by name
- `getByExternalId(externalId)` - Get organization by external ID

### Groups API (`client.groups`)
- `list(params?)` - List all groups
- `get(groupId)` - Get a group by ID
- `listAssignable(params?)` - List assignable groups
- `listByUser(userId, params?)` - List groups for a user

## Deployment

This connector is deployed to:

- **EC2**: `hasna-prod-connect-zendesk`
- **Database**: `hasna-prod-connect-zendesk`
- **S3**: `hasna-prod-connect-zendesk`

The remote API host is deployment-specific and has no built-in default. Point the CLI at your
deployment with `ZENDESK_REMOTE_API_URL` or `connect-zendesk config set-remote-url <url>`.

## License

MIT

## Resources

- [Zendesk API Documentation](https://developer.zendesk.com/api-reference/)
- [Zendesk API Authentication](https://developer.zendesk.com/api-reference/introduction/security-and-auth/)
- [Zendesk Tickets API](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/)
- [Zendesk Users API](https://developer.zendesk.com/api-reference/ticketing/users/users/)
- [Zendesk Organizations API](https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/)
- [Zendesk Groups API](https://developer.zendesk.com/api-reference/ticketing/groups/groups/)
