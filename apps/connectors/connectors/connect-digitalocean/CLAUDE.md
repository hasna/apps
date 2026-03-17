# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-digitalocean is a TypeScript connector for DigitalOcean's REST API. It provides a CLI and programmatic interface for managing droplets, volumes, databases, domains, Kubernetes clusters, and more.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Authentication
connect-digitalocean config set-key <key>   # Set API key
connect-digitalocean config show            # Show current config
connect-digitalocean config clear           # Clear config

# Profile management
connect-digitalocean profile list           # List profiles
connect-digitalocean profile use <name>     # Switch profile
connect-digitalocean profile create <name>  # Create profile
connect-digitalocean profile delete <name>  # Delete profile

# Account
connect-digitalocean account                # Get account info

# Regions and Sizes
connect-digitalocean regions                # List regions
connect-digitalocean sizes                  # List sizes

# Droplets
connect-digitalocean droplet list           # List droplets
connect-digitalocean droplet get <id>       # Get droplet details
connect-digitalocean droplet create         # Create droplet
connect-digitalocean droplet delete <id>    # Delete droplet
connect-digitalocean droplet action <id>    # Perform action

# Images
connect-digitalocean image list             # List images
connect-digitalocean image get <id>         # Get image details
connect-digitalocean image delete <id>      # Delete image

# SSH Keys
connect-digitalocean ssh-key list           # List SSH keys
connect-digitalocean ssh-key get <id>       # Get key details
connect-digitalocean ssh-key create         # Create SSH key
connect-digitalocean ssh-key delete <id>    # Delete SSH key

# Volumes
connect-digitalocean volume list            # List volumes
connect-digitalocean volume get <id>        # Get volume details
connect-digitalocean volume create          # Create volume
connect-digitalocean volume delete <id>     # Delete volume
connect-digitalocean volume attach <id> <dropletId>   # Attach volume
connect-digitalocean volume detach <id> <dropletId>   # Detach volume

# Domains
connect-digitalocean domain list            # List domains
connect-digitalocean domain get <domain>    # Get domain details
connect-digitalocean domain create <domain> # Create domain
connect-digitalocean domain delete <domain> # Delete domain
connect-digitalocean domain records <domain>    # List records
connect-digitalocean domain record-create <domain>  # Create record
connect-digitalocean domain record-delete <domain> <recordId>  # Delete record

# Firewalls
connect-digitalocean firewall list          # List firewalls
connect-digitalocean firewall get <id>      # Get firewall details
connect-digitalocean firewall delete <id>   # Delete firewall

# Load Balancers
connect-digitalocean load-balancer list     # List load balancers
connect-digitalocean load-balancer get <id> # Get load balancer details
connect-digitalocean load-balancer delete <id>  # Delete load balancer

# Databases
connect-digitalocean database list          # List databases
connect-digitalocean database get <id>      # Get database details
connect-digitalocean database create        # Create database cluster
connect-digitalocean database delete <id>   # Delete database cluster

# Kubernetes
connect-digitalocean kubernetes list        # List K8s clusters
connect-digitalocean kubernetes get <id>    # Get cluster details
connect-digitalocean kubernetes delete <id> # Delete cluster
connect-digitalocean kubernetes kubeconfig <id>  # Get kubeconfig

# Projects
connect-digitalocean project list           # List projects
connect-digitalocean project get <id>       # Get project details
connect-digitalocean project create         # Create project
connect-digitalocean project delete <id>    # Delete project
connect-digitalocean project default        # Get default project

# Snapshots
connect-digitalocean snapshot list          # List snapshots
connect-digitalocean snapshot get <id>      # Get snapshot details
connect-digitalocean snapshot delete <id>   # Delete snapshot

# Floating IPs
connect-digitalocean floating-ip list       # List floating IPs
connect-digitalocean floating-ip get <ip>   # Get floating IP details
connect-digitalocean floating-ip create     # Create floating IP
connect-digitalocean floating-ip delete <ip>  # Delete floating IP

# VPCs
connect-digitalocean vpc list               # List VPCs
connect-digitalocean vpc get <id>           # Get VPC details
connect-digitalocean vpc create             # Create VPC
connect-digitalocean vpc delete <id>        # Delete VPC

# Actions
connect-digitalocean action list            # List all actions
connect-digitalocean action get <id>        # Get action details
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DIGITALOCEAN_TOKEN` | API token (overrides profile) |
| `DIGITALOCEAN_ACCESS_TOKEN` | Alias for DIGITALOCEAN_TOKEN |

## Authentication

Uses Bearer token authentication. Get your token from:
https://cloud.digitalocean.com/account/api/tokens

## Data Storage

```
~/.connect/connect-digitalocean/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "dop_v1_xxx"
}
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   └── index.ts      # DigitalOcean API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

- Account: Get account info
- Regions: List
- Sizes: List
- Droplets: List, get, create, delete, actions
- Images: List, get, delete
- SSH Keys: List, get, create, delete
- Volumes: List, get, create, delete, attach, detach
- Domains: List, get, create, delete
- Domain Records: List, get, create, update, delete
- Firewalls: List, get, create, update, delete
- Load Balancers: List, get, delete
- Databases: List, get, create, delete
- Kubernetes: List, get, delete, kubeconfig
- Projects: List, get, create, update, delete, default
- Snapshots: List, get, delete
- Floating IPs: List, get, create, delete
- VPCs: List, get, create, update, delete
- Actions: List, get
