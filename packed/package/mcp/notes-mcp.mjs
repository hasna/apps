#!/usr/bin/env bun
// @bun
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNotesHttpStore } from '../client/http-store.mjs';
import {
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  markdownPlainText,
  normalizeLabels,
  renderMarkdownSafe,
} from '../tools/notes-lib.mjs';

const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version;
const EARLY_ARGV = process.argv.slice(2);
if (EARLY_ARGV.includes('--version') || EARLY_ARGV.includes('-V')) {
  console.log(VERSION);
  process.exit(0);
}
if (EARLY_ARGV.includes('--help') || EARLY_ARGV.includes('-h')) {
  console.log(`Usage: notes-mcp [options]

Hasna Notes MCP server (stdio, authenticated HTTPS client)

Options:
  -V, --version  output the version number
  -h, --help     display help for command`);
  process.exit(0);
}

let http;
try {
  http = createNotesHttpStore(process.env);
} catch (error) {
  process.stderr.write(`notes-mcp: ${error.message || error}\n`);
  process.exit(1);
}

const tools = [
  {
    name: 'notes_list',
    description: 'List Hasna Notes from the canonical authenticated HTTPS service.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, cursor: { type: 'string' }, includeDeleted: { type: 'boolean' } } },
  },
  {
    name: 'notes_get',
    description: 'Read one Hasna Notes note by id from the canonical service.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'notes_create',
    description: 'Create a Hasna Notes note through the canonical service.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'notes_update',
    description: 'Update a Hasna Notes note through the canonical service.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['id'] },
  },
  {
    name: 'notes_delete',
    description: 'Soft-delete a note after explicit confirmation.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, confirm: { type: 'boolean' }, dryRun: { type: 'boolean' } }, required: ['id'] },
  },
  {
    name: 'notes_archive',
    description: 'Archive a note through the canonical service.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'notes_restore',
    description: 'Restore or unarchive a note through the canonical service.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  { name: 'labels_list', description: 'List labels in the canonical Notes corpus.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'labels_assign',
    description: 'Assign a label through the canonical service.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] },
  },
  {
    name: 'labels_unassign',
    description: 'Unassign a label through the canonical service.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] },
  },
  { name: 'markdown_commands', description: 'List stable Markdown command IDs.', inputSchema: { type: 'object', properties: {} } },
  { name: 'markdown_render', description: 'Render supplied Markdown to sanitized HTML.', inputSchema: { type: 'object', properties: { markdown: { type: 'string' }, id: { type: 'string' } } } },
  { name: 'markdown_plain_text', description: 'Extract readable text from supplied or remote note Markdown.', inputSchema: { type: 'object', properties: { markdown: { type: 'string' }, id: { type: 'string' } } } },
  {
    name: 'markdown_apply_command',
    description: 'Apply a Markdown editor command to supplied text.',
    inputSchema: { type: 'object', properties: { markdown: { type: 'string' }, commandId: { type: 'string' }, selectionStart: { type: 'number' }, selectionEnd: { type: 'number' }, url: { type: 'string' } }, required: ['markdown', 'commandId'] },
  },
];

let buffer = Buffer.alloc(0);
let framing = '';

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  readMessages().catch((error) => {
    send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: error.message || String(error) } });
  });
});

async function readMessages() {
  while (true) {
    let skip = 0;
    while (skip < buffer.length && (buffer[skip] === 0x0d || buffer[skip] === 0x0a)) skip += 1;
    if (skip) buffer = buffer.subarray(skip);
    if (!buffer.length) return;
    if (!framing) framing = buffer[0] === 0x7b ? 'ndjson' : 'headers';
    if (framing === 'ndjson') {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.subarray(0, newline).toString('utf8').trim();
      buffer = buffer.subarray(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch (error) {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message || 'parse_error' } });
        continue;
      }
      await handle(message);
      continue;
    }
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
    try { await handle(JSON.parse(body)); }
    catch (error) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message || 'parse_error' } }); }
  }
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (framing !== 'headers') {
    process.stdout.write(body);
    process.stdout.write('\n');
    return;
  }
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function requireArg(args, key) {
  const value = args?.[key];
  if (value == null || value === '') throw new Error(`${key}_required`);
  return value;
}

async function collectNotes(maxPages = 100) {
  const notes = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await http.listNotes({ limit: 200, cursor });
    notes.push(...(result?.data || []));
    if (!result?.nextCursor) return notes;
    cursor = result.nextCursor;
  }
  throw new Error('notes: remote pagination exceeded the bounded MCP limit.');
}

async function markdownFromArgs(args) {
  if (args.markdown != null) return String(args.markdown);
  const note = await http.getNote(requireArg(args, 'id'));
  return note.bodyMarkdown || '';
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'notifications/initialized') return;
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'notes', version: VERSION } } });
    }
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
    if (method === 'tools/call') return send({ jsonrpc: '2.0', id, result: await callTool(params?.name, params?.arguments || {}) });
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method_not_found' } });
  } catch (error) {
    return send({ jsonrpc: '2.0', id, result: textResult({ error: error.message || String(error) }, true) });
  }
}

async function callTool(name, args) {
  if (name === 'notes_list') return textResult(await http.listNotes({ limit: args.limit || 10, cursor: args.cursor, includeDeleted: !!args.includeDeleted }));
  if (name === 'notes_get') return textResult(await http.getNote(requireArg(args, 'id')));
  if (name === 'notes_create') return textResult(await http.createNote({ title: String(args.title || '').trim() || 'Untitled Note', bodyMarkdown: String(args.body || ''), labels: normalizeLabels(args.labels || []) }));
  if (name === 'notes_update') {
    const input = {};
    if (args.title !== undefined) input.title = String(args.title).trim();
    if (args.body !== undefined) input.bodyMarkdown = String(args.body);
    if (args.labels !== undefined) input.labels = normalizeLabels(args.labels);
    if (!Object.keys(input).length) throw new Error('update_input_required');
    return textResult(await http.updateNote(requireArg(args, 'id'), input));
  }
  if (name === 'notes_delete') {
    const id = requireArg(args, 'id');
    const note = await http.getNote(id);
    const preview = { id: note.id, title: note.title, permanent: false, operation: 'soft-delete' };
    if (args.dryRun || !args.confirm) return textResult({ ok: false, dryRun: true, requiresConfirmation: true, preview });
    return textResult(await http.deleteNote(id));
  }
  if (name === 'notes_archive') return textResult(await http.updateNote(requireArg(args, 'id'), { archived: true }));
  if (name === 'notes_restore') return textResult(await http.updateNote(requireArg(args, 'id'), { archived: false }));
  if (name === 'labels_list') {
    const labels = normalizeLabels((await collectNotes()).flatMap((note) => note.labels || [])).sort((a, b) => a.localeCompare(b));
    return textResult({ labels });
  }
  if (name === 'labels_assign' || name === 'labels_unassign') {
    const id = requireArg(args, 'id');
    const label = requireArg(args, 'label');
    const note = await http.getNote(id);
    const key = String(label).toLowerCase();
    const labels = name === 'labels_assign'
      ? normalizeLabels([...(note.labels || []), label])
      : (note.labels || []).filter((item) => String(item).toLowerCase() !== key);
    return textResult(await http.updateNote(id, { labels }));
  }
  if (name === 'markdown_commands') return textResult({ commands: MARKDOWN_COMMANDS });
  if (name === 'markdown_render') return textResult({ html: renderMarkdownSafe(await markdownFromArgs(args)) });
  if (name === 'markdown_plain_text') return textResult({ text: markdownPlainText(await markdownFromArgs(args)) });
  if (name === 'markdown_apply_command') return textResult(applyMarkdownCommand(String(args.markdown || ''), args));
  throw new Error('unknown_tool');
}
