# @hasna/connect-voiceflow

TypeScript connector for the [Voiceflow](https://www.voiceflow.com/) Management API.

## Install

```bash
bun install
```

## Configuration

```bash
export VOICEFLOW_API_KEY=VF.DM.your-api-key-here
# optional
export VOICEFLOW_BASE_URL=https://api.voiceflow.com/v1
```

Or use profiles:

```bash
bun run dev config set-key VF.DM.your-api-key-here
```

## Usage

```bash
bun run dev projects list
bun run dev search --query "onboarding"
bun run dev raw GET /projects
```

## Library

```typescript
import { Voiceflow } from '@hasna/connect-voiceflow';

const vf = Voiceflow.fromEnv();
const projects = await vf.projects.list();
```

## License

Apache-2.0
