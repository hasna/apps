# connect-clickbank

A TypeScript CLI and SDK for the ClickBank API. Built with Bun.

## Installation

### Global Installation (CLI)

```bash
# Install globally
bun install -g .

# Or link for development
bun link
```

### As a Dependency

```bash
bun add connect-clickbank
```

## Quick Start

### CLI Usage

```bash
# Configure your API key
connect-clickbank config set-key YOUR_API_KEY

# Or use environment variable
export CLICKBANK_API_KEY=YOUR_API_KEY

# View today's stats
connect-clickbank stats today

# List orders
connect-clickbank orders list --start-date 2024-01-01 --end-date 2024-01-31

# Get order details
connect-clickbank orders get RECEIPT_NUMBER

# List products
connect-clickbank products list --account YOUR_ACCOUNT
```

### SDK Usage

```typescript
import { ClickBank } from 'connect-clickbank';

// Initialize with API key
const cb = new ClickBank({ apiKey: 'YOUR_API_KEY' });

// Or use environment variable
const cb = ClickBank.fromEnv();

// Get orders
const { orders, hasMore } = await cb.orders.list({
  startDate: '2024-01-01',
  endDate: '2024-01-31',
});

// Get quick stats
const stats = await cb.quickstats.getToday();
console.log(`Today's sales: ${stats.totalSales}`);

// Create a refund ticket
const ticket = await cb.tickets.createRefund(
  'RECEIPT_NUMBER',
  'FULL',
  'Customer requested refund'
);
```

## CLI Commands

### Configuration

```bash
connect-clickbank config set-key <apiKey>     # Set API key
connect-clickbank config set-account <name>   # Set default account
connect-clickbank config show                 # Show configuration
connect-clickbank config clear                # Clear configuration
```

### Orders

```bash
connect-clickbank orders get <receipt>        # Get order by receipt
connect-clickbank orders list                 # List orders
connect-clickbank orders count                # Count orders
connect-clickbank orders upsells <receipt>    # Get upsells
connect-clickbank orders is-active <receipt>  # Check subscription status
connect-clickbank orders pause <receipt>      # Pause subscription
connect-clickbank orders reinstate <receipt>  # Reinstate subscription
connect-clickbank orders extend <receipt>     # Extend subscription
```

### Products

```bash
connect-clickbank products get <sku> -a <account>     # Get product
connect-clickbank products list -a <account>          # List products
connect-clickbank products delete <sku> -a <account>  # Delete product
```

### Tickets

```bash
connect-clickbank tickets get <id>            # Get ticket
connect-clickbank tickets list                # List tickets
connect-clickbank tickets count               # Count tickets
connect-clickbank tickets refund <receipt>    # Create refund ticket
connect-clickbank tickets cancel <receipt>    # Create cancellation ticket
connect-clickbank tickets close <id>          # Close ticket
connect-clickbank tickets reopen <id>         # Reopen ticket
```

### Shipping

```bash
connect-clickbank shipping list               # List shipping orders
connect-clickbank shipping count              # Count shipping orders
connect-clickbank shipping unshipped          # List unshipped orders
connect-clickbank shipping mark-shipped <receipt>  # Mark as shipped
```

### Quickstats

```bash
connect-clickbank stats accounts              # List accounts
connect-clickbank stats summary               # Get summary stats
connect-clickbank stats today                 # Get today's stats
connect-clickbank stats daily                 # Get daily breakdown
```

### Analytics

```bash
connect-clickbank analytics status            # Get API status
connect-clickbank analytics subscriptions     # Get subscription trends
connect-clickbank analytics products          # Get product stats
connect-clickbank analytics countries         # Get country stats
```

### Images

```bash
connect-clickbank images list -a <account>    # List images
```

## Output Formats

Use the `-f` or `--format` flag to change output format:

```bash
connect-clickbank orders list -f json         # JSON output
connect-clickbank orders list -f table        # Table output
connect-clickbank orders list -f pretty       # Pretty output (default)
```

## API Reference

### ClickBank Class

```typescript
import { ClickBank } from 'connect-clickbank';

const cb = new ClickBank({ apiKey: 'YOUR_API_KEY' });

// Available APIs
cb.orders      // Orders API
cb.products    // Products API
cb.tickets     // Tickets API
cb.shipping    // Shipping API
cb.quickstats  // Quickstats API
cb.analytics   // Analytics API
cb.images      // Images API
```

### Orders API

```typescript
// Get order by receipt
const order = await cb.orders.getOrder('RECEIPT');

// List orders with filters
const { orders, hasMore } = await cb.orders.list({
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  type: 'SALE',
  role: 'VENDOR',
});

// Count orders
const count = await cb.orders.count({ type: 'SALE' });

// Check if subscription is active
const isActive = await cb.orders.isActive('RECEIPT');

// Manage subscriptions
await cb.orders.pause('RECEIPT', { restartDate: '2024-03-01' });
await cb.orders.reinstate('RECEIPT');
await cb.orders.extend('RECEIPT', { numPeriods: 3 });
```

### Tickets API

```typescript
// Create refund ticket
const ticket = await cb.tickets.createRefund('RECEIPT', 'FULL', 'reason');

// Create partial refund
const ticket = await cb.tickets.createRefund('RECEIPT', 'PARTIAL_AMOUNT', 'reason', {
  refundAmount: 25.00,
});

// Create cancellation
const ticket = await cb.tickets.createCancellation('RECEIPT', 'reason');

// Manage tickets
await cb.tickets.close('TICKET_ID', 'closing comment');
await cb.tickets.reopen('TICKET_ID', 'reopening reason');
```

### Shipping API

```typescript
// List unshipped orders
const { orders } = await cb.shipping.getUnshipped();

// Mark as shipped
await cb.shipping.markShipped('RECEIPT', 'ITEM_NO', 'TRACKING_ID', 'USPS');
```

### Quickstats API

```typescript
// Get today's stats
const today = await cb.quickstats.getToday();

// Get daily stats for date range
const daily = await cb.quickstats.getDailyStats('2024-01-01', '2024-01-31');
```

### Analytics API

```typescript
// Get subscription trends
const trends = await cb.analytics.getSubscriptionTrends({
  role: 'VENDOR',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
});

// Get product stats
const stats = await cb.analytics.getVendorProductStats();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLICKBANK_API_KEY` | Your ClickBank API key |

## Development

```bash
# Install dependencies
bun install

# Run CLI in development mode
bun run dev

# Build for production
bun run build

# Type check
bun run typecheck
```

## License

MIT

## Resources

- [ClickBank API Documentation](https://support.clickbank.com/hc/en-us/articles/220376527-ClickBank-APIs)
- [ClickBank API Specifications](https://support.clickbank.com/en/articles/10535397-clickbank-api-specifications)
- [How to Create ClickBank API Keys](https://support.clickbank.com/hc/en-us/articles/360040581831-How-to-Create-ClickBank-API-Keys)
