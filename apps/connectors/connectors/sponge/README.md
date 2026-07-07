# connect-sponge

Sponge (PaySponge Agent Wallet) API connector CLI — agent wallets, transfers,
swaps/bridges, fiat onramps, cards, and x402/MPP paid requests.

Built against the public Sponge REST API documented at
[docs.paysponge.com](https://docs.paysponge.com)
(base URL `https://api.wallet.paysponge.com`).

## Installation

```bash
bun install -g @hasna/connect-sponge
```

## Quick Start

```bash
# Set your agent API key
connect-sponge config set-key YOUR_API_KEY

# Or use an environment variable
export SPONGE_API_KEY=YOUR_API_KEY

# Show the current agent
connect-sponge agent me
```

Configuration is stored per-profile under `~/.hasna/connectors/sponge/`.

## Configuration

| Variable          | Required | Description                                                       |
| ----------------- | -------- | ----------------------------------------------------------------- |
| `SPONGE_API_KEY`  | yes      | Agent API key, sent as `Authorization: Bearer <key>`.             |
| `SPONGE_BASE_URL` | no       | Override the API base (`https://api.wallet.paysponge.com`).       |
| `SPONGE_VERSION`  | no       | Pin an API revision via the `Sponge-Version` header.              |

Global flags: `--api-key`, `--base-url`, `--profile`, `--format <json|table|pretty>`.

## CLI Commands

### Profiles & config

```bash
connect-sponge profile list
connect-sponge profile create work --api-key KEY --use
connect-sponge config set-key KEY
connect-sponge config set-base-url https://api.wallet.paysponge.com
connect-sponge config show
```

### Agents

```bash
connect-sponge agent me
connect-sponge agent list --include-balances
connect-sponge agent create --name "Buyer" --daily-limit 100
connect-sponge agent get <id>
connect-sponge agent update <id> --status paused
connect-sponge agent delete <id>
connect-sponge agent api-key <id>
connect-sponge agent regenerate-key <id>
```

### Wallets & balances

```bash
connect-sponge wallet balances --chain base --only-usdc
connect-sponge wallet list
connect-sponge wallet get <id>
connect-sponge wallet balance <id> --chain-id 8453
```

### Transfers, tokens, swaps & transactions

```bash
connect-sponge transfer evm --chain base --to 0x... --amount 1.5 --currency USDC
connect-sponge transfer solana --chain solana --to <addr> --amount 0.1 --currency SOL
connect-sponge transfer tokens solana
connect-sponge transfer search-tokens usdc --limit 10
connect-sponge transfer history --limit 25
connect-sponge transfer status <txHash> --chain base
connect-sponge transfer swap --chain base --input USDC --output ETH --amount 100
connect-sponge transfer base-swap --chain base --input USDC --output ETH --amount 100
connect-sponge transfer bridge --source-chain base --destination-chain solana --token USDC --amount 50
```

### Payments (x402 / MPP)

```bash
connect-sponge payment x402-fetch https://api.example.com/data --method GET
connect-sponge payment mpp-start --deposit 10
connect-sponge payment mpp-request <sessionId> https://api.example.com --method POST --body '{"q":1}'
connect-sponge payment mpp-sessions --status open
connect-sponge payment mpp-close <sessionId>
```

### Trading (Hyperliquid)

```bash
connect-sponge hyperliquid markets
connect-sponge hyperliquid order --symbol ETH --side buy --type limit --amount 0.1 --price 3000
connect-sponge hyperliquid positions
```

### Fiat onramps

```bash
connect-sponge onramp crypto <walletAddress> --provider auto --chain base --fiat-amount 50
connect-sponge onramp coinbase-url --addresses '[{"chainId":8453,"address":"0x..."}]'
connect-sponge onramp stripe-session --addresses '[{"chainId":8453,"address":"0x..."}]'
```

### Cards

```bash
connect-sponge card list-credit-cards
connect-sponge card issue-virtual-card --data '{"amount":"25","merchant_name":"Acme","merchant_url":"https://acme.test"}'
connect-sponge card sponge-status
connect-sponge card sponge-fund --amount 20 --chain base
```

### Agent service keys (secrets)

```bash
connect-sponge key store --service openai --key sk-... --label prod
connect-sponge key list
connect-sponge key value openai
connect-sponge key delete openai
```

### Raw escape hatch

```bash
connect-sponge raw /api/agents/me
connect-sponge raw /api/transfers/evm --method POST --body '{"chain":"base","to":"0x...","amount":"1","currency":"USDC"}'
```

## Programmatic usage

```ts
import { Sponge } from '@hasna/connect-sponge';

const sponge = Sponge.fromEnv(); // reads SPONGE_API_KEY
const me = await sponge.agents.me();
const balances = await sponge.wallets.balances({ onlyUsdc: true });
```

## License

Apache-2.0
