# connect-upcloud

UpCloud connector - Manage cloud servers, storage, and networking via the UpCloud API.

## Installation

```bash
bun install -g @hasna/connect-upcloud
```

## Quick Start

```bash
# Set credentials
connect-upcloud config set-username YOUR_API_USERNAME
connect-upcloud config set-password YOUR_API_PASSWORD

# Or use environment variables
export UPCLOUD_USERNAME=YOUR_API_USERNAME
export UPCLOUD_PASSWORD=YOUR_API_PASSWORD
```

Create API credentials at https://hub.upcloud.com/account/people

## CLI Commands

### Account
```bash
connect-upcloud account          # Get account info
connect-upcloud plans            # List server plans
connect-upcloud zones            # List zones
connect-upcloud prices           # List prices
```

### Servers
```bash
connect-upcloud server list
connect-upcloud server get <uuid>
connect-upcloud server create -n <hostname> -z <zone>
connect-upcloud server start <uuid>
connect-upcloud server stop <uuid>
connect-upcloud server restart <uuid>
connect-upcloud server delete <uuid>
```

### Storage
```bash
connect-upcloud storage list
connect-upcloud storage get <uuid>
connect-upcloud storage create -n <title> -s <size> -z <zone>
connect-upcloud storage attach <serverUuid> <storageUuid>
connect-upcloud storage detach <serverUuid> <address>
connect-upcloud storage delete <uuid>
```

### Network
```bash
connect-upcloud network ip-list
connect-upcloud network ip-get <ip>
connect-upcloud network firewall-list <serverUuid>
connect-upcloud network list
```

## Programmatic Usage

```typescript
import { UpCloud } from '@hasna/connect-upcloud';

const client = new UpCloud({
  apiKey: process.env.UPCLOUD_USERNAME!,
  apiSecret: process.env.UPCLOUD_PASSWORD!,
});

const { account } = await client.account.getAccount();
const { servers } = await client.servers.listServers();
```

## License

Apache-2.0
