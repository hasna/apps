# @hasna/connect-veo

TypeScript connector and CLI for the [Veo](https://www.veo.co.uk/) sports video library API (not Google Gemini Veo).

## Install

```bash
bun add @hasna/connect-veo
```

## Setup

```bash
export VEO_API_KEY=your-bearer-access-token
# or
connect-veo config set-key your-bearer-access-token
```

Obtain a bearer token via Veo's OAuth2 password grant or your Veo dashboard. See https://developer.veo.co.uk/ for API documentation.

## CLI

```bash
connect-veo videos list
connect-veo videos get <videoId>
connect-veo videos transcript <videoId>
connect-veo users list
connect-veo groups list
connect-veo raw-request --method GET --path /videos/v3/get-all
```

## Library

```typescript
import { Veo } from '@hasna/connect-veo';

const veo = Veo.fromEnv();
const videos = await veo.videos.list();
const transcript = await veo.videos.getTranscript('video-id');
```

## License

Apache-2.0
