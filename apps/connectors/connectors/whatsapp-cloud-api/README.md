# WhatsApp Cloud API Connector

TypeScript connector for the [WhatsApp Cloud API](https://api.whatsappcloudapi.com/v1) (`api.whatsappcloudapi.com`).

**Note:** This is **not** Meta WhatsApp Business Cloud. For Meta Graph API messaging, use `connectors/whatsapp` (`connect-whatsapp`).

## Install

```bash
connectors install whatsapp-cloud-api
```

## Authentication

Bearer API key via profile or environment:

```bash
export WHATSAPP_CLOUD_API_KEY=your-api-key
# optional
export WHATSAPP_CLOUD_API_BASE_URL=https://api.whatsappcloudapi.com/v1
```

## CLI

```bash
connect-whatsapp-cloud-api config set-key <key>
connect-whatsapp-cloud-api items list
connect-whatsapp-cloud-api items get <itemId>
connect-whatsapp-cloud-api items create --json '{"name":"example"}'
connect-whatsapp-cloud-api events list
connect-whatsapp-cloud-api search --json '{"query":"term"}'
connect-whatsapp-cloud-api raw /items -X GET
```

## Library

```typescript
import { WhatsappCloudApi } from '@hasna/connect-whatsapp-cloud-api';

const api = WhatsappCloudApi.fromEnv();
const items = await api.listItems();
```
