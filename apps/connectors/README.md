# Connectors

Open source library of 63 TypeScript API connectors. Install any connector with a single command.

## Quick Start

```bash
# Interactive mode - browse and select connectors
npx @hasna/connectors

# Install specific connectors
npx @hasna/connectors install figma stripe github

# List all available connectors
npx @hasna/connectors list

# Open the auth dashboard
npx @hasna/connectors serve
```

## Installation

```bash
# Global install
bun install -g @hasna/connectors

# Or use npx (no install needed)
npx @hasna/connectors
```

## Usage

### Install Connectors

```bash
connectors install figma stripe github   # Install connectors
connectors install figma --overwrite     # Overwrite existing
connectors remove figma                  # Remove a connector
```

### Browse & Search

```bash
connectors                               # Interactive browser (TTY)
connectors list                          # List all connectors
connectors list --category "AI & ML"     # Filter by category
connectors search payment                # Search connectors
connectors info stripe                   # Connector details
connectors docs gmail                    # Auth, env vars, CLI docs
```

### Dashboard

Start a local web dashboard to manage connector authentication:

```bash
connectors serve                         # http://localhost:19426
connectors serve --port 3000             # Custom port
connectors serve --no-open               # Don't auto-open browser
connectors open                          # Open dashboard in browser
connectors dashboard                     # Alias for serve
```

The dashboard shows all 63 connectors with:
- Install status and auth type (OAuth, API Key, Bearer)
- Configure API keys via dialog
- Run OAuth flows for Google connectors
- Monitor token expiry and refresh tokens
- Light/dark theme, sorting, filtering, pagination

### MCP Server (for AI Agents)

```bash
connectors-mcp                           # Start MCP server on stdio
```

Add to your MCP config:
```json
{
  "mcpServers": {
    "connectors": {
      "command": "connectors-mcp"
    }
  }
}
```

Tools: `search_connectors`, `list_connectors`, `connector_docs`, `connector_info`, `install_connector`, `remove_connector`, `list_installed`, `connector_auth_status`

### JSON Output (for scripts & agents)

Every command supports `--json` for machine-readable output:

```bash
connectors list --json
connectors search ai --json
connectors info stripe --json
connectors docs gmail --json
```

## Available Connectors (63)

### AI & ML (12)
| Connector | Description |
|-----------|-------------|
| anthropic | Claude AI models and API |
| openai | GPT models, DALL-E, and Whisper |
| xai | Grok AI models |
| mistral | Mistral AI models |
| googlegemini | Gemini AI models |
| huggingface | ML models and datasets hub |
| stabilityai | Stable Diffusion image generation |
| midjourney | AI image generation |
| heygen | AI video generation |
| hedra | AI video generation |
| elevenlabs | AI voice synthesis and cloning |
| reducto | Document processing and extraction |

### Developer Tools (10)
| Connector | Description |
|-----------|-------------|
| github | Repositories, issues, PRs, and actions |
| docker | Container management and registry |
| sentry | Error tracking and monitoring |
| cloudflare | DNS, CDN, and edge computing |
| googlecloud | GCP services and APIs |
| aws | Amazon Web Services |
| e2b | Code interpreter sandboxes |
| firecrawl | Web scraping and crawling |
| browseruse | Browser automation for AI |
| shadcn | UI component registry |

### Design & Content (4)
| Connector | Description |
|-----------|-------------|
| figma | Design files, components, and comments |
| webflow | Website builder and CMS |
| wix | Website builder |
| icons8 | Icons and illustrations |

### Communication (6)
| Connector | Description |
|-----------|-------------|
| gmail | Email sending and management |
| discord | Messaging and communities |
| twilio | SMS, voice, and messaging |
| resend | Email API for developers |
| zoom | Video meetings and webinars |
| maropost | Email marketing automation |

### Social Media (7)
| Connector | Description |
|-----------|-------------|
| x | Posts, threads, and engagement |
| reddit | Posts, comments, and subreddits |
| substack | Newsletter publishing |
| meta | Facebook and Instagram APIs |
| snap | Snapchat marketing API |
| tiktok | TikTok content and ads |
| youtube | Videos, channels, and analytics |

### Commerce & Finance (6)
| Connector | Description |
|-----------|-------------|
| stripe | Payments, subscriptions, and billing |
| stripeatlas | Company incorporation |
| shopify | E-commerce platform |
| revolut | Banking and payments |
| mercury | Startup banking |
| pandadoc | Document signing and proposals |

### Google Workspace (8)
| Connector | Description |
|-----------|-------------|
| google | Google OAuth and APIs |
| googledrive | File storage and sharing |
| googledocs | Document creation and editing |
| googlesheets | Spreadsheets and data |
| googlecalendar | Calendar and events |
| googletasks | Task management |
| googlecontacts | Contact management |
| googlemaps | Maps, places, and directions |

### Data & Analytics (4)
| Connector | Description |
|-----------|-------------|
| exa | AI-powered web search |
| mixpanel | Product analytics |
| openweathermap | Weather data and forecasts |
| brandsight | Brand monitoring |

### Business Tools (4)
| Connector | Description |
|-----------|-------------|
| notion | Pages, databases, blocks, and property management |
| quo | Business quotes and invoices |
| tinker | Internal tooling |
| sedo | Domain marketplace |

### Patents & IP (1)
| Connector | Description |
|-----------|-------------|
| uspto | US Patent and Trademark Office |

### Advertising (1)
| Connector | Description |
|-----------|-------------|
| xads | Twitter/X advertising |

## Using Installed Connectors

After installing, import from the `.connectors` directory:

```typescript
import { figma, stripe, github } from './.connectors';

// Use the connectors
const files = await figma.files.get('file-key');
const customers = await stripe.customers.list();
const repos = await github.repos.list();
```

Each connector provides:
- TypeScript types
- Multi-profile configuration
- CLI tool
- Programmatic API

## Installing Individual Connectors

You can also install connectors individually as npm packages:

```bash
# Install individual connector packages
bun install @hasna/connect-figma
bun install @hasna/connect-stripe
bun install @hasna/connect-anthropic
```

Then use them directly:

```typescript
import { Figma } from '@hasna/connect-figma';
import { Stripe } from '@hasna/connect-stripe';
import { Anthropic } from '@hasna/connect-anthropic';

const figma = new Figma({ accessToken: 'xxx' });
const stripe = new Stripe({ apiKey: 'sk_xxx' });
const anthropic = new Anthropic({ apiKey: 'sk-ant-xxx' });
```

## Connector Structure

Each connector follows a consistent structure:

```
connect-{name}/
├── src/
│   ├── api/           # API client modules
│   ├── cli/           # CLI commands
│   ├── types/         # TypeScript types
│   └── utils/         # Configuration utilities
├── CLAUDE.md          # Development guide
├── AGENTS.md          # AI agent guide
├── GEMINI.md          # Gemini guide
├── README.md          # Usage documentation
└── package.json
```

## Multi-Profile Configuration

All connectors support multi-profile configuration:

```bash
# Create profiles for different accounts
connect-figma profile create work --api-key xxx --use
connect-figma profile create personal --api-key yyy

# Switch profiles
connect-figma profile use work

# Use profile for single command
connect-figma -p personal files get <key>

# List profiles
connect-figma profile list
```

Configuration stored in `~/.connect/{connector-name}/`:

```
~/.connect/connect-figma/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## Contributing

1. Fork the repository
2. Create a new connector in `connectors/connect-{name}/`
3. Follow the existing connector patterns
4. Submit a pull request

## License

Apache-2.0
