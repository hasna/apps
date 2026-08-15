# connect-vidyard

TypeScript connector and CLI for the [Vidyard Dashboard API](https://developer.vidyard.com/).

## Install

```bash
bun install
bun run build
```

## Authentication

Get an API token from **Admin > API Tokens** in your Vidyard account.

```bash
export VIDYARD_API_KEY=your-token
# or
connect-vidyard config set-key your-token
```

## Usage

```bash
connect-vidyard videos list
connect-vidyard videos get 123
connect-vidyard videos create --name "Demo" --upload-url https://example.com/video.mp4
connect-vidyard events list
connect-vidyard search events --query "webinar"
connect-vidyard raw GET /accounts
```

## Library

```typescript
import { Vidyard } from '@hasna/connect-vidyard';

const vidyard = Vidyard.fromEnv();
const videos = await vidyard.listVideos();
```

## License

Apache-2.0
