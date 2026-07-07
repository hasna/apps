# @hasna/connect-terminus

TypeScript connector and CLI for the [Terminus](https://www.terminusapp.com/) UTM parameter and link management API.

## Installation

```bash
bun add @hasna/connect-terminus
```

## Configuration

Copy `.env.example` and set your API key:

```bash
TERMINUS_API_KEY=your-api-key-here
```

Create API keys in your Terminus account. See [API documentation](https://www.terminusapp.com/apidocs).

## CLI

```bash
connect-terminus project list
connect-terminus campaign list prj_abc123
connect-terminus link create prj_abc123 -u https://example.com
```

## Programmatic usage

```typescript
import { Connector } from '@hasna/connect-terminus';

const client = Connector.fromEnv();
const projects = await client.projects.list();
const campaigns = await client.campaigns.list('prj_abc123');
```

## License

Apache-2.0
