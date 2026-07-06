# connect-telnyx

Telnyx API connector CLI — a TypeScript wrapper for the [Telnyx v2 API](https://developers.telnyx.com/api). Send SMS/MMS, manage and search phone numbers, list messaging profiles, and run carrier/caller number lookups, with multi-profile credential support.

## Installation

```bash
bun install -g @hasna/connect-telnyx
```

## Quick Start

```bash
# Set your API key (create one in the Telnyx portal under Account > API Keys)
connect-telnyx config set-api-key YOUR_API_KEY

# Or use an environment variable
export TELNYX_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Configuration
connect-telnyx config set-api-key <key>   # Store the API key
connect-telnyx config show                # Show config (API key masked)
connect-telnyx config clear               # Clear stored credentials

# Profiles
connect-telnyx profile list               # List profiles
connect-telnyx profile use <name>         # Switch profile
connect-telnyx profile create <name>      # Create a profile

# Messages
connect-telnyx message send --to +15551230000 --from +15550001111 --body "Hello"
connect-telnyx message get <message-id>

# Phone numbers
connect-telnyx numbers list
connect-telnyx numbers get <phone-number-id>
connect-telnyx numbers search --country-code US --national-destination-code 415 --feature sms

# Messaging profiles
connect-telnyx profiles list
connect-telnyx profiles get <messaging-profile-id>

# Number lookup
connect-telnyx lookup +15551230000 --type carrier
```

Add `--format json` (or `table`) to any command to change the output format, and `--profile <name>` to target a specific profile for a single command.

## Programmatic Usage

```ts
import { Telnyx } from '@hasna/connect-telnyx';

const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! });

const message = await telnyx.messages.send({
  from: '+15550001111',
  to: '+15551230000',
  text: 'Hello from Telnyx',
});

const numbers = await telnyx.availableNumbers.search({
  country_code: 'US',
  features: ['sms', 'mms'],
});
```

## API Coverage

| Module | Method | Endpoint |
|--------|--------|----------|
| `messages` | `send` | `POST /messages` |
| `messages` | `get` | `GET /messages/{id}` |
| `phoneNumbers` | `list` | `GET /phone_numbers` |
| `phoneNumbers` | `get` | `GET /phone_numbers/{id}` |
| `availableNumbers` | `search` | `GET /available_phone_numbers` |
| `messagingProfiles` | `list` | `GET /messaging_profiles` |
| `messagingProfiles` | `get` | `GET /messaging_profiles/{id}` |
| `numberLookup` | `lookup` | `GET /number_lookup/{phone_number}` |

## Authentication

All requests use `Authorization: Bearer <TELNYX_API_KEY>`. The key is read from
(in priority order) the `TELNYX_API_KEY` environment variable, the `--api-key`
flag, or the active profile config in `~/.hasna/connectors/connect-telnyx/`.

## Development

```bash
bun install
bun run dev --help
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
