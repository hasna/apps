# @hasna/connect-smtp2go

A TypeScript library and CLI for the [SMTP2GO](https://www.smtp2go.com/) v3 API.
Send transactional email and manage delivery statistics, suppressions, sender
domains, single senders, and SMTP users.

## Features

- Real SMTP2GO v3 API client (`https://api.smtp2go.com/v3`)
- `X-Smtp2go-Api-Key` header authentication (with `api_key` body fallback)
- Automatic retry with exponential backoff for rate-limit (429) and 5xx errors
- Multi-profile configuration
- Pretty, JSON, and table output formats
- TypeScript with strict mode

## Install

```bash
bun install
```

## Authentication

Create an API key in the SMTP2GO dashboard under **Settings → API Keys**, then
either export it or store it in a profile:

```bash
export SMTP2GO_API_KEY=api-your-key-here
# or
bun run dev config set-key api-your-key-here
```

## CLI

```bash
connect-smtp2go [options] [command]

Options:
  -k, --api-key <key>      API key (overrides config)
  -f, --format <format>    Output format (json, pretty, table)
  -p, --profile <profile>  Use a specific profile

Commands:
  profile ...              Manage configuration profiles
  config set-key <key>     Set API key for the active profile
  config show              Show current configuration

  email send               Send an email
  email search             Search sent emails
  activity search          Search the activity stream for events

  stats summary            Email summary statistics
  stats bounces            Bounce statistics
  stats cycle              Delivery cycle / allowance
  stats history            Historical statistics
  stats spam               Spam complaint statistics
  stats unsubscribes       Unsubscribe statistics

  suppression list|add|remove   Manage suppressed recipients
  domain list|add|verify|remove Manage sender domains
  sender list|add|remove        Manage single (verified) senders
  smtp-user list|add|remove     Manage SMTP credentials
```

### Send an email

```bash
connect-smtp2go email send \
  --sender "Acme <hello@acme.com>" \
  --to "user@example.com,other@example.com" \
  --subject "Welcome" \
  --html "<h1>Hi there</h1>" \
  --text "Hi there"
```

## Library usage

```typescript
import { Smtp2go } from '@hasna/connect-smtp2go';

const smtp = Smtp2go.fromEnv(); // reads SMTP2GO_API_KEY

const result = await smtp.sendEmail({
  sender: 'hello@acme.com',
  to: ['user@example.com'],
  subject: 'Welcome',
  html_body: '<h1>Hi there</h1>',
});

console.log(result.email_id);
```

## Development

```bash
bun run dev          # run the CLI
bun run typecheck    # type check
bun test             # run tests
bun run build        # build dist/ and bin/
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `SMTP2GO_API_KEY` | API key (overrides profile config) |
| `CONNECTOR_BASE_URL` | Override the base URL (optional) |

## License

Apache-2.0
