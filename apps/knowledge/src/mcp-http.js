import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const MCP_HTTP_SERVICE_NAME = 'knowledge';
export const DEFAULT_MCP_HTTP_PORT = 8819;

export function isHttpMode(argv = process.argv, env = process.env) {
  return argv.includes('--http') || env.MCP_HTTP === '1';
}

export function resolveMcpHttpPort(argv = process.argv, env = process.env) {
  const portIdx = argv.indexOf('--port');
  if (portIdx !== -1 && argv[portIdx + 1]) {
    return parsePort(argv[portIdx + 1], '--port');
  }
  if (env.MCP_HTTP_PORT) {
    return parsePort(env.MCP_HTTP_PORT, 'MCP_HTTP_PORT');
  }
  return DEFAULT_MCP_HTTP_PORT;
}

export function resolveMcpHttpBearerToken(env = process.env) {
  return env.MCP_HTTP_BEARER_TOKEN || env.KNOWLEDGE_MCP_HTTP_TOKEN || null;
}

function parsePort(raw, source) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid ${source} value "${raw}". Expected 0-65535.`);
  }
  return parsed;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  return JSON.parse(text);
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function requestAuthorized(req, token) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

export async function startMcpHttpServer(buildServer, options = {}) {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? resolveMcpHttpPort();
  const serviceName = options.serviceName ?? MCP_HTTP_SERVICE_NAME;
  const bearerToken = options.bearerToken ?? resolveMcpHttpBearerToken(options.env ?? process.env);

  if (!isLoopbackHost(host) && !bearerToken) {
    throw new Error('MCP HTTP requires MCP_HTTP_BEARER_TOKEN or KNOWLEDGE_MCP_HTTP_TOKEN when binding outside loopback.');
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', name: serviceName, auth_required: Boolean(bearerToken) }));
        return;
      }

      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      if (!requestAuthorized(req, bearerToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized' },
          id: null,
        }));
        return;
      }

      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);

      let parsedBody;
      if (req.method === 'POST') {
        parsedBody = await readJsonBody(req);
      }

      await transport.handleRequest(req, res, parsedBody);

      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error(`[${serviceName}-mcp] HTTP error:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }));
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, host, () => resolve());
  });

  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : requestedPort;

  console.error(`[${serviceName}-mcp] Streamable HTTP listening on http://${host}:${port}/mcp`);

  return {
    port,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
