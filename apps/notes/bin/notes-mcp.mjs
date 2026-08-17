#!/usr/bin/env node
import { createCloudClient } from '../cloud/index.mjs';
import { assertNoRetiredModeSelector, hasnaEnv } from '../tools/notes-env.mjs';

assertNoRetiredModeSelector();
// Hosted-path selection is config/API-key presence only (the mode-enum
// selector was retired): an API key or token selects the hosted/cloud client.
const hosted = !!hasnaEnv('API_KEY') || !!hasnaEnv('TOKEN');

if (!hosted) {
  await import('../mcp/notes-mcp.mjs');
} else {
  const client = await createCloudClient();
  const tools = [
    { name: 'notes_whoami', description: 'Show the authenticated hosted Hasna Notes account.', inputSchema: { type: 'object', properties: {} } },
    { name: 'notes_notes_list', description: 'List hosted Hasna Notes notes.', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, includeDeleted: { type: 'boolean' } } } },
    { name: 'notes_notes_get', description: 'Read a hosted Hasna Notes note.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'notes_notes_create', description: 'Create a hosted Hasna Notes note.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, bodyMarkdown: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } } } },
    { name: 'notes_sync', description: 'Run a hosted Hasna Notes sync batch.', inputSchema: { type: 'object', properties: { items: { type: 'array' }, idempotencyKey: { type: 'string' } } } },
    { name: 'notes_export', description: 'Export hosted Hasna Notes notes for the authenticated account.', inputSchema: { type: 'object', properties: {} } },
  ];

  let buffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    readMessages().catch((err) => send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message || String(err) } }));
  });

  async function readMessages() {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString('utf8');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      buffer = buffer.subarray(bodyStart + length);
      await handle(JSON.parse(body));
    }
  }

  function send(msg) {
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  }

  function textResult(value, isError = false) {
    return {
      content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      ...(isError ? { isError: true } : {}),
    };
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    if (method === 'notifications/initialized') return;
    try {
      if (method === 'initialize') {
        return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'notes-hosted', version: '0.1.0' } } });
      }
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
      if (method === 'tools/call') return send({ jsonrpc: '2.0', id, result: await callTool(params?.name, params?.arguments || {}) });
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method_not_found' } });
    } catch (err) {
      return send({ jsonrpc: '2.0', id, result: textResult({ error: err.message || String(err) }, true) });
    }
  }

  async function callTool(name, args) {
    if (name === 'notes_whoami') return textResult(await client.whoami());
    if (name === 'notes_notes_list') return textResult(await client.listNotes(args));
    if (name === 'notes_notes_get') return textResult(await client.getNote(args.id));
    if (name === 'notes_notes_create') return textResult(await client.createNote(args));
    if (name === 'notes_sync') return textResult(await client.sync({ items: args.items || [] }, args.idempotencyKey || undefined));
    if (name === 'notes_export') return textResult(await client.exportNotes());
    throw new Error('unknown_tool');
  }
}
