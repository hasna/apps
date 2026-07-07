# @hasna/connect-stampedio

Stamped.io connector — product reviews, ratings, customers, and loyalty for e-commerce.

Stamped.io is a reviews, ratings, UGC, and loyalty platform for online stores. This
connector wraps the public [Stamped REST API](https://developers.stamped.io/) as a
typed TypeScript client with a small CLI.

## Authentication

Stamped.io issues a **public API key**, a **private API key**, and a **store hash**
(all found under *Settings → API Keys* in your dashboard). Merchant (private)
endpoints authenticate via HTTP Basic Auth using the public key as the username and
the private key as the password; public widget endpoints use the public key and your
storefront domain as query parameters.

> Using the Stamped API requires a Professional or Enterprise plan.

Set credentials via environment variables (see `.env.example`):

```bash
export STAMPEDIO_PUBLIC_KEY="your-public-key"
export STAMPEDIO_PRIVATE_KEY="your-private-key"
export STAMPEDIO_STORE_HASH="your-store-hash"
export STAMPEDIO_STORE_URL="your-shop.myshopify.com"   # optional, for public widget calls
```

…or store them in a profile via the CLI:

```bash
connect-stampedio config set \
  --public-key  your-public-key \
  --private-key your-private-key \
  --store-hash  your-store-hash \
  --store-url   your-shop.myshopify.com
```

## Library usage

```ts
import { Stampedio } from "@hasna/connect-stampedio";

const stamped = Stampedio.fromEnv();

// Merchant dashboard reviews (private, Basic Auth)
const reviews = await stamped.reviews.list({ minRating: 4, take: 20 });

// Public storefront widget reviews (public key + storeUrl)
const published = await stamped.reviews.listPublic({ productId: "SKU-123" });

// Sync a customer
await stamped.customers.add({ email: "buyer@example.com", name: "Jane Buyer" });

// Award loyalty points
await stamped.loyalty.awardPoints("buyer@example.com", 100, "newsletter signup");
```

## CLI

```bash
connect-stampedio reviews list --min-rating 4 --take 20
connect-stampedio reviews public --product-id SKU-123
connect-stampedio customers add --email buyer@example.com --name "Jane Buyer"
connect-stampedio loyalty award --email buyer@example.com --points 100 --reason "signup"
connect-stampedio config show
connect-stampedio profile list
```

Global flags: `--format <json|table|pretty>` and `--profile <name>` for multi-store
credential profiles (stored under `~/.hasna/connectors/connect-stampedio/`).

## Endpoints covered

| Area      | Method | Path                                            | Auth        |
| --------- | ------ | ----------------------------------------------- | ----------- |
| Reviews   | GET    | `/v2/{storeHash}/dashboard/reviews`             | Basic       |
| Reviews   | GET    | `/widget/reviews`                               | Public key  |
| Customers | POST   | `/v2/{storeHash}/dashboard/customers/add`       | Basic       |
| Loyalty   | POST   | `/v2/{storeHash}/loyalty/transactions`          | Basic       |

Base URL: `https://stamped.io/api`

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
