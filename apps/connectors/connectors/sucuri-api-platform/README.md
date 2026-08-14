# @hasna/connect-sucuri-api-platform

TypeScript connector and CLI for the [Sucuri API Platform](https://api.sucuriapiplatform.com/v1).

## Install

```bash
bun add @hasna/connect-sucuri-api-platform
```

## Configuration

```bash
export SUCURI_API_PLATFORM_API_KEY=your-api-key
# optional
export SUCURI_API_PLATFORM_BASE_URL=https://api.sucuriapiplatform.com/v1
```

Or use the CLI profile/config commands:

```bash
connect-sucuri-api-platform config set-key your-api-key
```

## CLI Usage

```bash
connect-sucuri-api-platform items list
connect-sucuri-api-platform items get <itemId>
connect-sucuri-api-platform items create --data '{"name":"example"}'
connect-sucuri-api-platform events list
connect-sucuri-api-platform search query --query "example"
connect-sucuri-api-platform raw request --path /items --method GET
```

## Library Usage

```ts
import { Connector } from '@hasna/connect-sucuri-api-platform';

const client = Connector.fromEnv();
const items = await client.items.list();
const item = await client.items.get('item-id');
```

## License

Apache-2.0
