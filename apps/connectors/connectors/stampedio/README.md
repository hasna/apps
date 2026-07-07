# @hasna/connect-stampedio

Stamped.io connector — product reviews, ratings, customers, and loyalty for e-commerce.

Stamped.io is a reviews, ratings, UGC, and loyalty platform for online stores. This
connector wraps the public [Stamped REST API](https://developers.stamped.io/) as a
typed TypeScript client with a small CLI.

## Authentication

Stamped.io private API requests use a **ShopId/storeHash** in the request path and
a **private API key** in the `stamped-api-key` header. Public widget endpoints use
the public API key and your storefront domain as query parameters.

Official references:

- [Stamped API Overview](https://developers.stamped.io/docs/getting-started.md)
- [Create Customer](https://developers.stamped.io/reference/createcustomer.md)
- [Adjust Points](https://developers.stamped.io/reference/adjust-points.md)

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

// Merchant dashboard reviews (private, stamped-api-key header)
const reviews = await stamped.reviews.list({ minRating: 4, take: 20 });

// Public storefront widget reviews (public key + storeUrl)
const published = await stamped.reviews.listPublic({ productId: "SKU-123" });

// Sync a customer
await stamped.customers.add({
  email: "buyer@example.com",
  firstName: "Jane",
  lastName: "Buyer",
});

// Award loyalty points
await stamped.loyalty.awardPoints("customer-id-from-stamped", 100, "newsletter signup");
```

## CLI

```bash
connect-stampedio reviews list --min-rating 4 --take 20
connect-stampedio reviews public --product-id SKU-123
connect-stampedio customers add --email buyer@example.com --first-name Jane --last-name Buyer
connect-stampedio loyalty award --customer-id cus_123 --points 100 --reason "signup"
connect-stampedio config show
connect-stampedio profile list
```

Global flags: `--format <json|table|pretty>` and `--profile <name>` for multi-store
credential profiles (stored under `~/.hasna/connectors/connect-stampedio/`).

## Endpoints covered

| Area      | Method | Path                                                                      | Auth        |
| --------- | ------ | ------------------------------------------------------------------------- | ----------- |
| Reviews   | GET    | `/v2/{storeHash}/dashboard/reviews`                                       | Private key |
| Reviews   | GET    | `/widget/reviews`                                                         | Public key  |
| Customers | POST   | `/v3/merchant/shops/{shopId}/customers`                                   | Private key |
| Loyalty   | POST   | `/v3/loyalty/shops/{shopId}/customers/{customerId}/adjust-points`         | Private key |

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
