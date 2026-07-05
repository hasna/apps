# connect-vultr

Vultr connector - Manage cloud instances, block storage, firewalls, and more

## Installation

```bash
bun install -g @hasna/connect-vultr
```

## Quick Start

```bash
# Set your API key
connect-vultr config set-key YOUR_API_KEY

# Or use environment variable
export VULTR_API_KEY=YOUR_API_KEY
```

Get your API key from: https://my.vultr.com/settings/#settingsapi

## CLI Commands

### Account & Infrastructure
```bash
connect-vultr account                # Get account info
connect-vultr regions                # List regions
connect-vultr plans                  # List plans
```

### Instances
```bash
connect-vultr instance list          # List instances
connect-vultr instance get <id>      # Get instance details
connect-vultr instance create        # Create instance
connect-vultr instance delete <id>   # Delete instance
connect-vultr instance reboot <id>   # Reboot instance
connect-vultr instance halt <id>     # Halt instance
connect-vultr instance start <id>    # Start instance
```

### SSH Keys
```bash
connect-vultr ssh-key list           # List SSH keys
connect-vultr ssh-key get <id>       # Get key details
connect-vultr ssh-key create         # Create SSH key
connect-vultr ssh-key delete <id>    # Delete SSH key
```

### Snapshots
```bash
connect-vultr snapshot list          # List snapshots
connect-vultr snapshot get <id>      # Get snapshot details
connect-vultr snapshot create        # Create snapshot from instance
connect-vultr snapshot delete <id>   # Delete snapshot
```

### Block Storage
```bash
connect-vultr block list             # List block storage
connect-vultr block get <id>         # Get block details
connect-vultr block create           # Create block storage
connect-vultr block delete <id>      # Delete block storage
connect-vultr block attach <id> <instanceId>  # Attach to instance
connect-vultr block detach <id>      # Detach from instance
```

### Firewalls
```bash
connect-vultr firewall list          # List firewall groups
connect-vultr firewall get <id>      # Get firewall group
connect-vultr firewall create        # Create firewall group
connect-vultr firewall delete <id>   # Delete firewall group
connect-vultr firewall rules <id>    # List firewall rules
```

### Profile & Config
```bash
connect-vultr profile list           # List profiles
connect-vultr profile use <name>     # Switch profile
connect-vultr profile create <name>  # Create profile
connect-vultr config set-key <key>   # Set API key
connect-vultr config show            # Show config
connect-vultr config clear           # Clear config
```

## Library Usage

```typescript
import { Vultr } from '@hasna/connect-vultr';

const client = new Vultr({ apiKey: 'YOUR_API_KEY' });
const { account } = await client.getAccount();
const { instances } = await client.listInstances();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VULTR_API_KEY` | API key (overrides profile) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-vultr/`:

```
~/.hasna/connectors/connect-vultr/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## License

Apache-2.0
