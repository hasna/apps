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

export async function startMcpHttpServer(buildServer, options = {}) {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? resolveMcpHttpPort();
  const serviceName = options.serviceName ?? MCP_HTTP_SERVICE_NAME;

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', name: serviceName }));
        return;
      }

      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
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
