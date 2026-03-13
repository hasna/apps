# connect-digitalocean

DigitalOcean connector - Manage droplets, volumes, databases, domains, and more

## Installation

```bash
bun install -g @hasna/connect-digitalocean
```

## Quick Start

```bash
# Set your API key
connect-digitalocean config set-key YOUR_API_KEY

# Or use environment variable
export DIGITALOCEAN_TOKEN=YOUR_API_KEY
```

## CLI Commands

### Account & Infrastructure
```bash
connect-digitalocean account                # Get account info
connect-digitalocean regions                # List regions
connect-digitalocean sizes                  # List sizes
```

### Droplets
```bash
connect-digitalocean droplet list           # List droplets
connect-digitalocean droplet get <id>       # Get droplet details
connect-digitalocean droplet create         # Create droplet
connect-digitalocean droplet delete <id>    # Delete droplet
connect-digitalocean droplet action <id>    # Perform action
```

### Volumes
```bash
connect-digitalocean volume list            # List volumes
connect-digitalocean volume get <id>        # Get volume details
connect-digitalocean volume create          # Create volume
connect-digitalocean volume delete <id>     # Delete volume
connect-digitalocean volume attach <id> <dropletId>   # Attach volume
connect-digitalocean volume detach <id> <dropletId>   # Detach volume
```

### Domains
```bash
connect-digitalocean domain list            # List domains
connect-digitalocean domain get <domain>    # Get domain details
connect-digitalocean domain create <domain> # Create domain
connect-digitalocean domain delete <domain> # Delete domain
connect-digitalocean domain records <domain>    # List records
```

### Databases
```bash
connect-digitalocean database list          # List databases
connect-digitalocean database get <id>      # Get database details
connect-digitalocean database create        # Create database cluster
connect-digitalocean database delete <id>   # Delete database cluster
```

### Kubernetes
```bash
connect-digitalocean kubernetes list        # List K8s clusters
connect-digitalocean kubernetes get <id>    # Get cluster details
connect-digitalocean kubernetes delete <id> # Delete cluster
connect-digitalocean kubernetes kubeconfig <id>  # Get kubeconfig
```

### Profile & Config
```bash
connect-digitalocean profile list           # List profiles
connect-digitalocean profile use <name>     # Switch profile
connect-digitalocean profile create <name>  # Create profile
connect-digitalocean config set-key <key>   # Set API key
connect-digitalocean config show            # Show config
connect-digitalocean config clear           # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-digitalocean profile create work --api-key xxx --use
connect-digitalocean profile create personal --api-key yyy

# Switch profiles
connect-digitalocean profile use work

# Use profile for single command
connect-digitalocean -p personal <command>

# List profiles
connect-digitalocean profile list
```

## Library Usage

```typescript
import { DigitalOcean } from '@hasna/connect-digitalocean';

const client = new DigitalOcean({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DIGITALOCEAN_TOKEN` | API token (overrides profile) |
| `DIGITALOCEAN_ACCESS_TOKEN` | Alias for DIGITALOCEAN_TOKEN |

## Data Storage

Configuration stored in `~/.connect/connect-digitalocean/`:

```
~/.connect/connect-digitalocean/
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

Apache-2.0
