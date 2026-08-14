# Toggl Track Connector

TypeScript connector for the [Toggl Track API v9](https://engineering.toggl.com/docs/).

## Install

```bash
bun install
```

## Configure

```bash
export TOGGL_TRACK_API_TOKEN=your-token
# or
bun run dev config set-token your-token
```

## Usage

```bash
bun run dev me
bun run dev workspaces list
bun run dev projects list <workspaceId>
bun run dev time-entries current
bun run dev time-entries stop <workspaceId> <entryId>
```

## Library

```typescript
import { TogglTrack } from '@hasna/connect-toggl-track';

const toggl = TogglTrack.fromEnv();
const user = await toggl.me.getCurrentUser();
```
