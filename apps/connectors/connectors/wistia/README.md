# @hasna/connect-wistia

TypeScript connector and CLI for the [Wistia Data API](https://docs.wistia.com/).

## Features

- Bearer token authentication
- Multi-profile configuration
- Account, projects, medias, captions, channels, analytics, and sharing APIs
- Library and CLI entry points

## Install

```bash
bun install
```

## Configuration

```bash
export WISTIA_API_TOKEN=your-token-here
# or
connect-wistia config set-key your-token-here
```

## Usage

```bash
# Account
connect-wistia account get
connect-wistia account stats

# Projects
connect-wistia projects list
connect-wistia projects get <hashedId>
connect-wistia projects create --name "My Project"

# Medias
connect-wistia medias list --project-id <hashedId>
connect-wistia medias get <hashedId>

# Channels
connect-wistia channels list
connect-wistia channels create --name "Launch Channel"

# Analytics
connect-wistia stats visitors --start-date 2026-01-01
connect-wistia stats engagement <mediaHashedId>
```

## Library

```typescript
import { Wistia } from '@hasna/connect-wistia';

const wistia = Wistia.fromEnv();
const account = await wistia.account.get();
const projects = await wistia.projects.list();
```

## License

Apache-2.0
