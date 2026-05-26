import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { ClickBank } from '../api';
import type { Role, TransactionType } from '../types';

const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Get API key from environment or request header
function getClient(c: any): ClickBank | null {
  const apiKey = c.req.header('X-ClickBank-API-Key') || process.env.CLICKBANK_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new ClickBank({ apiKey });
}

// Health check
app.get('/', (c) => {
  return c.json({
    service: 'connect-clickbank',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy' });
});

// ============================================
// Orders API
// ============================================
app.get('/api/orders', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      affiliate: c.req.query('affiliate'),
      vendor: c.req.query('vendor'),
      email: c.req.query('email'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      type: c.req.query('type') as TransactionType | undefined,
      role: c.req.query('role') as Role | undefined,
      page: c.req.query('page') ? parseInt(c.req.query('page')!) : undefined,
    };
    const result = await client.orders.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/orders/count', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      affiliate: c.req.query('affiliate'),
      vendor: c.req.query('vendor'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      type: c.req.query('type') as TransactionType | undefined,
    };
    const count = await client.orders.count(params);
    return c.json({ count });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/orders/:receipt', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const receipt = c.req.param('receipt');
    const sku = c.req.query('sku');
    const order = await client.orders.getOrder(receipt, sku);
    return c.json(order);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/orders/:receipt/upsells', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const receipt = c.req.param('receipt');
    const upsells = await client.orders.getUpsells(receipt);
    return c.json(upsells);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/orders/:receipt/active', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const receipt = c.req.param('receipt');
    const sku = c.req.query('sku');
    const isActive = await client.orders.isActive(receipt, sku);
    return c.json({ active: isActive });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/orders/:receipt/pause', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const receipt = c.req.param('receipt');
    const body = await c.req.json();
    await client.orders.pause(receipt, body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/orders/:receipt/reinstate', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const receipt = c.req.param('receipt');
    const body = await c.req.json().catch(() => ({}));
    await client.orders.reinstate(receipt, body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/orders/:receipt/extend', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const receipt = c.req.param('receipt');
    const body = await c.req.json();
    await client.orders.extend(receipt, body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============================================
// Products API
// ============================================
app.get('/api/products', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const site = c.req.query('site');
    if (!site) {
      return c.json({ error: 'site parameter required' }, 400);
    }
    const type = c.req.query('type');
    const products = await client.products.list({ site, type: type as any });
    return c.json(products);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/products/:sku', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const sku = c.req.param('sku');
    const site = c.req.query('site');
    if (!site) {
      return c.json({ error: 'site parameter required' }, 400);
    }
    const product = await client.products.get(sku, site);
    return c.json(product);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.put('/api/products/:sku', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const sku = c.req.param('sku');
    const body = await c.req.json();
    const result = await client.products.create({ sku, ...body });
    return c.json({ sku: result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.delete('/api/products/:sku', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const sku = c.req.param('sku');
    const site = c.req.query('site');
    if (!site) {
      return c.json({ error: 'site parameter required' }, 400);
    }
    await client.products.delete(sku, site);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============================================
// Tickets API
// ============================================
app.get('/api/tickets', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      receipt: c.req.query('receipt'),
      status: c.req.query('status') as any,
      type: c.req.query('type') as any,
      createDateFrom: c.req.query('createDateFrom'),
      createDateTo: c.req.query('createDateTo'),
      page: c.req.query('page') ? parseInt(c.req.query('page')!) : undefined,
    };
    const result = await client.tickets.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/tickets/count', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      receipt: c.req.query('receipt'),
      status: c.req.query('status') as any,
      type: c.req.query('type') as any,
    };
    const count = await client.tickets.count(params);
    return c.json({ count });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/tickets/:ticketId', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const ticketId = c.req.param('ticketId');
    const ticket = await client.tickets.get(ticketId);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/tickets/:receipt', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const receipt = c.req.param('receipt');
    const body = await c.req.json();
    const ticket = await client.tickets.create(receipt, body);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.put('/api/tickets/:ticketId', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const ticketId = c.req.param('ticketId');
    const body = await c.req.json();
    const ticket = await client.tickets.update(ticketId, body);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/tickets/:ticketId/close', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const ticketId = c.req.param('ticketId');
    const body = await c.req.json().catch(() => ({}));
    const ticket = await client.tickets.close(ticketId, body.comment);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/tickets/:ticketId/reopen', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const ticketId = c.req.param('ticketId');
    const body = await c.req.json();
    const ticket = await client.tickets.reopen(ticketId, body.comment);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============================================
// Shipping API
// ============================================
app.get('/api/shipping', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      status: c.req.query('status') as any,
      receipt: c.req.query('receipt'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      days: c.req.query('days') ? parseInt(c.req.query('days')!) : undefined,
      page: c.req.query('page') ? parseInt(c.req.query('page')!) : undefined,
    };
    const result = await client.shipping.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/shipping/count', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      status: c.req.query('status') as any,
      receipt: c.req.query('receipt'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    };
    const count = await client.shipping.count(params);
    return c.json({ count });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/shipping/shipnotice', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const body = await c.req.json();
    await client.shipping.createShipNotice(body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============================================
// Quickstats API
// ============================================
app.get('/api/quickstats/accounts', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const accounts = await client.quickstats.getAccounts();
    return c.json(accounts);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/quickstats', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      account: c.req.query('account'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      page: c.req.query('page') ? parseInt(c.req.query('page')!) : undefined,
    };
    const result = await client.quickstats.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/quickstats/count', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      account: c.req.query('account'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    };
    const result = await client.quickstats.count(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============================================
// Analytics API
// ============================================
app.get('/api/analytics/status', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const status = await client.analytics.getStatus();
    return c.json(status);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/analytics/subscriptions/trends', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      role: (c.req.query('role') || 'VENDOR') as Role,
      account: c.req.query('account'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    };
    const trends = await client.analytics.getSubscriptionTrends(params);
    return c.json(trends);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/analytics/subscriptions/details', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const params = {
      role: (c.req.query('role') || 'VENDOR') as Role,
      account: c.req.query('account'),
      status: c.req.query('status'),
      page: c.req.query('page') ? parseInt(c.req.query('page')!) : undefined,
    };
    const result = await client.analytics.getSubscriptionDetails(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/analytics/stats/:dimension', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const dimension = c.req.param('dimension').toUpperCase() as any;
    const params = {
      role: (c.req.query('role') || 'VENDOR') as Role,
      dimension,
      account: c.req.query('account'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    };
    const stats = await client.analytics.getStats(params);
    return c.json(stats);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============================================
// Images API
// ============================================
app.get('/api/images', async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: 'API key required' }, 401);
  }

  try {
    const site = c.req.query('site');
    if (!site) {
      return c.json({ error: 'site parameter required' }, 400);
    }
    const params = {
      site,
      type: c.req.query('type') as any,
      approvedOnly: c.req.query('approvedOnly') === 'true' ? true : c.req.query('approvedOnly') === 'false' ? false : undefined,
      page: c.req.query('page') ? parseInt(c.req.query('page')!) : undefined,
    };
    const result = await client.images.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Start server
const port = parseInt(process.env.PORT || '3013');

export default {
  port,
  fetch: app.fetch,
};

console.log(`connect-clickbank server running on port ${port}`);
