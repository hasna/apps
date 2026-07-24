import { createServer } from 'node:http';
import {
  resolveScopedWorkspace,
  trustedKnowledgeWorkspaceIdentity,
} from './workspace.ts';
import {
  containmentErrorFor,
  readKnowledgeConfiguredMode,
  resolveKnowledgeRuntimeRoleWithConfig,
} from './runtime-role.ts';

export const MCP_HTTP_SERVICE_NAME = 'knowledge';
export const DEFAULT_MCP_HTTP_PORT = 8819;
export const MAX_MCP_HTTP_BODY_BYTES = 1_048_576;
export const MAX_MCP_HTTP_BODY_CHUNKS = 256;
export const MCP_HTTP_BODY_TIMEOUT_MS = 5_000;

export function assertLoopbackHost(host) {
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Knowledge MCP HTTP is loopback-only; use 127.0.0.1 or ::1');
  }
  return host;
}

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

class McpHttpRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requestError(status, code, message) {
  return new McpHttpRequestError(status, code, message);
}

function rawHeaderValues(req, name) {
  const values = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === name) values.push(req.rawHeaders[index + 1]);
  }
  return values;
}

function expectedBodyBytes(req, maxBytes) {
  if (rawHeaderValues(req, 'transfer-encoding').length > 0) {
    throw requestError(400, 'MCP_HTTP_TRANSFER_ENCODING_REJECTED', 'Transfer-Encoding is not accepted.');
  }
  const values = rawHeaderValues(req, 'content-length');
  if (values.length === 0) {
    throw requestError(411, 'MCP_HTTP_LENGTH_REQUIRED', 'A single Content-Length header is required.');
  }
  if (values.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(values[0] ?? '')) {
    throw requestError(400, 'MCP_HTTP_LENGTH_INVALID', 'Content-Length must be one canonical decimal value.');
  }
  const expected = Number(values[0]);
  if (!Number.isSafeInteger(expected)) {
    throw requestError(413, 'MCP_HTTP_BODY_TOO_LARGE', 'MCP HTTP body length is not safely bounded.');
  }
  if (expected > maxBytes) {
    throw requestError(413, 'MCP_HTTP_BODY_TOO_LARGE', `MCP HTTP body exceeds the ${maxBytes} byte hard limit.`);
  }
  if (expected === 0) {
    throw requestError(400, 'MCP_HTTP_BODY_REQUIRED', 'MCP HTTP requires a JSON request body.');
  }
  return expected;
}

function strictBound(value, hardLimit, label) {
  if (value === undefined) return hardLimit;
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardLimit) {
    throw new RangeError(`${label} must be a positive safe integer no greater than ${hardLimit}.`);
  }
  return value;
}

export function readBoundedMcpJsonBody(req, options = {}) {
  const maxBytes = strictBound(options.maxBytes, MAX_MCP_HTTP_BODY_BYTES, 'MCP HTTP maxBytes');
  const maxChunks = strictBound(options.maxChunks, MAX_MCP_HTTP_BODY_CHUNKS, 'MCP HTTP maxChunks');
  const timeoutMs = strictBound(options.timeoutMs, MCP_HTTP_BODY_TIMEOUT_MS, 'MCP HTTP timeoutMs');
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  const mediaType = contentType.split(';', 1)[0]?.trim();
  if (mediaType !== 'application/json') {
    throw requestError(415, 'MCP_HTTP_CONTENT_TYPE_REQUIRED', 'Content-Type must be application/json.');
  }
  const expected = expectedBodyBytes(req, maxBytes);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let chunkCount = 0;
    let settled = false;
    const timer = setTimeout(() => {
      fail(requestError(408, 'MCP_HTTP_BODY_TIMEOUT', 'MCP HTTP body streaming timed out.'));
    }, timeoutMs);
    timer.unref?.();

    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      req.off('error', onError);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.pause();
      reject(error);
    };
    const onData = (value) => {
      const chunk = typeof value === 'string' ? Buffer.from(value) : value;
      chunkCount += 1;
      bytes += chunk.byteLength;
      if (chunkCount > maxChunks) {
        fail(requestError(413, 'MCP_HTTP_TOO_MANY_CHUNKS', `MCP HTTP body exceeds the ${maxChunks} chunk hard limit.`));
        return;
      }
      if (bytes > maxBytes || bytes > expected) {
        fail(requestError(413, 'MCP_HTTP_BODY_TOO_LARGE', `MCP HTTP body exceeds its declared or ${maxBytes} byte hard limit.`));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      if (bytes !== expected || !req.complete) {
        fail(requestError(400, 'MCP_HTTP_LENGTH_MISMATCH', 'MCP HTTP body length does not match Content-Length.'));
        return;
      }
      settled = true;
      cleanup();
      try {
        const text = Buffer.concat(chunks, bytes).toString('utf8');
        resolve(JSON.parse(text));
      } catch {
        reject(requestError(400, 'MCP_HTTP_JSON_INVALID', 'MCP HTTP body must be valid JSON.'));
      }
    };
    const onAborted = () => fail(requestError(400, 'MCP_HTTP_BODY_ABORTED', 'MCP HTTP body was aborted.'));
    const onError = () => fail(requestError(400, 'MCP_HTTP_BODY_STREAM_ERROR', 'MCP HTTP body stream failed.'));

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('error', onError);
  });
}

function createHttpRuntimeBoundary(options) {
  const cwd = options.cwd ?? process.cwd();
  const scope = options.scope ?? 'project';
  const workspace = resolveScopedWorkspace(scope, cwd);
  const identity = trustedKnowledgeWorkspaceIdentity(workspace);
  return Object.freeze({ cwd, scope, workspace, identity, env: options.env });
}

function invalidWorkspaceRuntime(detail) {
  return {
    role: 'invalid',
    surface: 'mcp-http',
    source: 'startup-workspace-identity',
    signals: [],
    issues: ['startup-workspace-identity-invalid'],
    detail,
  };
}

function runtimeFor(boundary) {
  try {
    const current = trustedKnowledgeWorkspaceIdentity(boundary.workspace);
    if (
      current.key !== boundary.identity.key
      || current.home !== boundary.identity.home
      || current.projectRoot !== boundary.identity.projectRoot
    ) return invalidWorkspaceRuntime('MCP HTTP startup workspace identity changed after validation.');
  } catch (error) {
    return invalidWorkspaceRuntime(
      error instanceof Error ? error.message : 'MCP HTTP startup workspace identity is unavailable.',
    );
  }
  return resolveKnowledgeRuntimeRoleWithConfig({
    surface: 'mcp-http',
    env: boundary.env ?? process.env,
  }, () => readKnowledgeConfiguredMode(
    boundary.workspace.configPath,
  ));
}

function sendJson(res, status, payload, closeConnection = false) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(closeConnection ? { Connection: 'close' } : {}),
  });
  res.end(JSON.stringify(payload));
}

function sendRequestError(req, res, error) {
  res.writeHead(error.status, { 'Content-Type': 'application/json', Connection: 'close' });
  res.once('finish', () => req.destroy());
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32600, message: error.message, data: { code: error.code } },
    id: null,
  }));
}

export async function startMcpHttpServer(buildServer, options = {}) {
  const host = assertLoopbackHost(options.host ?? '127.0.0.1');
  const requestedPort = options.port ?? resolveMcpHttpPort();
  const serviceName = options.serviceName ?? MCP_HTTP_SERVICE_NAME;
  const runtimeBoundary = createHttpRuntimeBoundary(options);
  const initialRuntime = runtimeFor(runtimeBoundary);
  if (initialRuntime.role !== 'local') throw containmentErrorFor(initialRuntime);

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', name: serviceName }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/ready') {
        const current = runtimeFor(runtimeBoundary);
        if (current.role !== 'local') {
          const error = containmentErrorFor(current);
          const { status: httpStatus, ...containmentPayload } = error.toJSON();
          sendJson(res, error.status, { status: 'unavailable', http_status: httpStatus, ...containmentPayload });
          return;
        }
        sendJson(res, 200, { status: 'ready', name: serviceName });
        return;
      }

      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const current = runtimeFor(runtimeBoundary);
      if (current.role !== 'local') {
        const containment = containmentErrorFor(current);
        sendJson(res, containment.status, containment.toJSON());
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, {
          'Content-Type': 'application/json',
          Allow: 'POST',
          Connection: 'close',
        });
        res.once('finish', () => req.destroy());
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }

      let parsedBody;
      try {
        parsedBody = await readBoundedMcpJsonBody(req, {
          maxBytes: options.maxBodyBytes,
          maxChunks: options.maxBodyChunks,
          timeoutMs: options.bodyTimeoutMs,
        });
      } catch (error) {
        if (error instanceof McpHttpRequestError) {
          sendRequestError(req, res, error);
          return;
        }
        throw error;
      }

      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);

      await transport.handleRequest(req, res, parsedBody);

      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error(`[${serviceName}-mcp] HTTP error: ${error instanceof Error ? error.message : 'unknown failure'}`);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
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
