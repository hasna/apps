# @hasna/connect-twocaptcha

TypeScript connector for the [2Captcha API](https://2captcha.com/2captcha-api).

## Install

```bash
bun install
```

## Configuration

Set your API key via environment variable or CLI:

```bash
export TWOCAPTCHA_API_KEY=your-api-key
# or
connect-twocaptcha config set-key your-api-key
```

## CLI Usage

```bash
# Create a captcha task
connect-twocaptcha task create --task '{"type":"RecaptchaV2TaskProxyless","websiteURL":"https://example.com","websiteKey":"site-key"}'

# Poll task result
connect-twocaptcha task result 123456789

# Check balance
connect-twocaptcha balance get

# Report solution quality
connect-twocaptcha report correct 123456789
connect-twocaptcha report incorrect 123456789
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-twocaptcha';

const client = Connector.fromEnv();
const { taskId } = await client.tasks.createTask({
  task: {
    type: 'RecaptchaV2TaskProxyless',
    websiteURL: 'https://example.com',
    websiteKey: 'site-key',
  },
});
const result = await client.tasks.getTaskResult({ taskId: taskId! });
```

## License

Apache-2.0
