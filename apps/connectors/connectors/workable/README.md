# connect-workable

TypeScript connector for the [Workable SPI v3 API](https://workable.readme.io/) — jobs, candidates, offers, and recruiting workflows.

## Install

```bash
bun add @hasna/connect-workable
```

## Quick start

```bash
set WORKABLE_API_TOKEN and WORKABLE_SUBDOMAIN in your shell before running commands

connect-workable jobs list --state published
connect-workable candidates list ENG-1
```

## Library usage

```typescript
import { Connector } from '@hasna/connect-workable';

const workable = new Connector({
  apiKey: process.env.WORKABLE_API_TOKEN!,
  subdomain: process.env.WORKABLE_SUBDOMAIN!,
});

const jobs = await workable.jobs.list({ state: 'published' });
```

## License

Apache-2.0
