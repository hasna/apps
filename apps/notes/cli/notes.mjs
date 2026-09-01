#!/usr/bin/env bun
// @bun
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { resolveNotesClientStore, resolveNotesClientTransport } from '../sdk/index.mjs';
import {
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  markdownPlainText,
  normalizeLabels,
  renderMarkdownSafe,
} from '../tools/notes-lib.mjs';
import { applyNotesDataMigration, planNotesDataMigration } from '../tools/data-migration.mjs';

const DEFAULT_LIMIT = 10;

function usage() {
  return `Hasna Notes CLI — authenticated HTTPS client

Usage:
  notes list [--json] [--limit 10] [--cursor value] [--include-deleted]
  notes get <id> [--json]
  notes create [--title text] [--body text | --body-file path] [--label name ...] [--json]
  notes update <id> [--title text] [--body text | --body-file path] [--label name ...] [--json]
  notes delete <id> [--yes|--force] [--json]
  notes archive <id> [--json]
  notes restore <id> [--json]
  notes labels list [--json]
  notes labels assign <note-id> <name> [--json]
  notes labels unassign <note-id> <name> [--json]
  notes markdown commands [--json]
  notes markdown render <id> [--json]
  notes markdown plain-text <id> [--json]
  notes markdown apply-command <command-id> --text markdown [--selection-start n] [--selection-end n] [--url href] [--json]
  notes storage status [--json]
  notes storage migrate-legacy-path --source legacy|nested|server-nested (--dry-run|--yes) [--json]

Client configuration:
  HASNA_NOTES_API_URL   absolute HTTPS service URL
  HASNA_NOTES_API_KEY   application API key

Both values are required. The CLI never opens a local SQLite/markdown store
and never accepts a database DSN. Legacy path migration is an explicit,
copy-only maintenance action; source data is preserved.`;
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq > 0 ? eq : undefined);
    const takesValue = !['json', 'force', 'help', 'yes', 'dry-run', 'include-deleted'].includes(key);
    const value = eq > 0 ? arg.slice(eq + 1) : (takesValue ? argv[++i] : true);
    if (key === 'label') opts.label = [...(opts.label || []), value];
    else opts[key] = value;
  }
  return opts;
}

function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function lineOut(value) {
  process.stdout.write(`${String(value)}\n`);
}

function requireArg(value, name) {
  if (value == null || value === '') throw new Error(`${name}_required`);
  return value;
}

function noteSummary(note) {
  const labels = note.labels?.length ? ` [${note.labels.join(', ')}]` : '';
  return `${note.updatedAt || ''}  ${note.id}  ${note.title || 'Untitled Note'}${labels}`.trim();
}

function shouldAvoidPrompt(opts) {
  return !!opts.json || !!process.env.CI || !process.stdin.isTTY || !process.stdout.isTTY;
}

async function confirm(message, opts, preview) {
  if (opts.yes || opts.force) return true;
  if (opts.json) {
    jsonOut({ ok: false, dryRun: true, requiresConfirmation: true, preview });
    return false;
  }
  if (shouldAvoidPrompt(opts)) {
    lineOut(`${message} Re-run with --yes or --force to confirm.`);
    process.exitCode = 2;
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(y|yes)$/i.test((await rl.question(`${message} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

async function bodyFromOpts(opts) {
  if (opts['body-file']) return readFile(String(opts['body-file']), 'utf8');
  return opts.body === undefined ? undefined : String(opts.body);
}

async function collectNotes(http, { includeDeleted = false, maxPages = 100 } = {}) {
  const items = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await http.listNotes({ limit: 200, includeDeleted, cursor });
    items.push(...(result?.data || []));
    if (!result?.nextCursor) return items;
    cursor = result.nextCursor;
  }
  throw new Error('notes: remote pagination exceeded the bounded client limit.');
}

async function commandList(http, opts) {
  for (const unsupported of ['offset', 'query', 'machine', 'status']) {
    if (opts[unsupported] !== undefined) throw new Error(`notes list does not support --${unsupported} on the canonical API.`);
  }
  const result = await http.listNotes({
    limit: Number(opts.limit || DEFAULT_LIMIT),
    includeDeleted: !!opts['include-deleted'],
    cursor: opts.cursor,
  });
  const page = { items: result?.data || [], nextCursor: result?.nextCursor || null };
  if (opts.json) return jsonOut(page);
  page.items.forEach((note) => lineOut(noteSummary(note)));
  if (page.nextCursor) lineOut(`View more: --cursor ${page.nextCursor}`);
}

async function commandGet(http, id, opts) {
  const note = await http.getNote(requireArg(id, 'id'));
  if (opts.json) return jsonOut(note);
  lineOut(`# ${note.title || 'Untitled Note'}`);
  lineOut(`id: ${note.id}`);
  lineOut(`labels: ${(note.labels || []).join(', ') || '(none)'}`);
  lineOut(`updatedAt: ${note.updatedAt || ''}`);
  lineOut('');
  lineOut(note.bodyMarkdown || '');
}

async function commandCreate(http, opts) {
  const note = await http.createNote({
    title: String(opts.title || '').trim() || 'Untitled Note',
    bodyMarkdown: (await bodyFromOpts(opts)) || '',
    labels: normalizeLabels(opts.label || []),
  });
  if (opts.json) return jsonOut(note);
  lineOut(noteSummary(note));
}

async function commandUpdate(http, id, opts) {
  const input = {};
  if (opts.title !== undefined) input.title = String(opts.title).trim();
  const body = await bodyFromOpts(opts);
  if (body !== undefined) input.bodyMarkdown = body;
  if (opts.label) input.labels = normalizeLabels(opts.label);
  if (!Object.keys(input).length) throw new Error('notes: update requires --title, --body/--body-file, or --label.');
  const note = await http.updateNote(requireArg(id, 'id'), input);
  if (opts.json) return jsonOut(note);
  lineOut(noteSummary(note));
}

async function commandDelete(http, id, opts) {
  const note = await http.getNote(requireArg(id, 'id'));
  const preview = { id: note.id, title: note.title, permanent: false, operation: 'soft-delete' };
  if (!(await confirm(`Delete "${note.title || 'Untitled Note'}"?`, opts, preview))) return;
  const result = await http.deleteNote(note.id);
  if (opts.json) return jsonOut(result);
  lineOut('Deleted');
}

async function commandLabels(http, action, args, opts) {
  if (action === 'list') {
    const labels = normalizeLabels((await collectNotes(http)).flatMap((note) => note.labels || []))
      .sort((a, b) => a.localeCompare(b));
    if (opts.json) return jsonOut({ labels });
    labels.forEach(lineOut);
    return;
  }
  if (action === 'assign' || action === 'unassign') {
    const id = requireArg(args[0], 'id');
    const label = requireArg(args[1], 'label');
    const note = await http.getNote(id);
    const key = String(label).toLowerCase();
    const labels = action === 'assign'
      ? normalizeLabels([...(note.labels || []), label])
      : (note.labels || []).filter((item) => String(item).toLowerCase() !== key);
    const updated = await http.updateNote(id, { labels });
    if (opts.json) return jsonOut(updated);
    lineOut(noteSummary(updated));
    return;
  }
  throw new Error('notes: the canonical API supports labels list, assign, and unassign only.');
}

async function commandMarkdown(http, action, args, opts) {
  if (action === 'commands') {
    if (opts.json) return jsonOut({ commands: MARKDOWN_COMMANDS });
    MARKDOWN_COMMANDS.forEach((command) => lineOut(`${command.id}\t${command.label}`));
    return;
  }
  if (action === 'apply-command') {
    const result = applyMarkdownCommand(String(opts.text || ''), {
      commandId: requireArg(args[0], 'command'),
      selectionStart: opts['selection-start'],
      selectionEnd: opts['selection-end'],
      url: opts.url,
      href: opts.href,
      language: opts.language,
    });
    if (opts.json) return jsonOut(result);
    lineOut(result.markdown);
    return;
  }
  const note = await http.getNote(requireArg(args[0], 'id'));
  const markdown = note.bodyMarkdown || '';
  if (action === 'render') {
    const html = renderMarkdownSafe(markdown);
    if (opts.json) return jsonOut({ html });
    lineOut(html);
    return;
  }
  if (action === 'plain-text' || action === 'plain') {
    const text = markdownPlainText(markdown);
    if (opts.json) return jsonOut({ text });
    lineOut(text);
    return;
  }
  throw new Error('unknown_markdown_command');
}

function migrationSummary(plan) {
  return {
    source: plan.source,
    sourcePresent: plan.sourcePresent,
    files: plan.files,
    copyFiles: plan.copyFiles,
    identicalFiles: plan.identicalFiles,
    conflictFiles: plan.conflictFiles,
    skippedVolatileFiles: plan.skippedVolatileFiles,
    bytesToCopy: plan.bytesToCopy,
    sourcePreserved: true,
  };
}

function commandLocalMigration(opts) {
  if (!opts['dry-run'] && !opts.yes) throw new Error('notes: migration requires --dry-run or --yes.');
  const plan = planNotesDataMigration({ source: opts.source || 'legacy' });
  if (plan.conflictFiles) throw new Error(`notes: migration has ${plan.conflictFiles} destination conflict(s); no files were copied.`);
  if (opts['dry-run']) {
    const out = { ok: true, dryRun: true, ...migrationSummary(plan) };
    if (opts.json) return jsonOut(out);
    lineOut(JSON.stringify(out));
    return;
  }
  const result = applyNotesDataMigration(plan);
  const out = {
    ok: result.ok,
    source: plan.source,
    copiedFiles: result.copiedFiles,
    identicalFiles: result.identicalFiles,
    bytesCopied: result.bytesCopied,
    sourcePreserved: result.sourcePreserved,
    receiptWritten: true,
  };
  if (opts.json) return jsonOut(out);
  lineOut(`Migrated ${result.copiedFiles} file(s) to the XDG data root; source preserved.`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  if (!cmd || cmd === 'help' || cmd === '--help' || opts.help) return lineOut(usage());
  if (cmd === '--version' || cmd === '-v') {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return lineOut(pkg.version);
  }

  if (cmd === 'storage' && opts._[0] === 'migrate-legacy-path') return commandLocalMigration(opts);
  if (cmd === 'storage' && opts._[0] !== 'status') throw new Error('unknown_storage_action');
  if (!new Set(['list', 'get', 'create', 'update', 'delete', 'archive', 'restore', 'labels', 'markdown', 'storage']).has(cmd)) {
    throw new Error(`unknown_command: ${cmd}`);
  }

  const client = resolveNotesClientTransport(process.env);
  if (cmd === 'storage') {
    const report = {
      client: {
        transport: client.transport,
        source: client.source,
        scheme: client.scheme,
        apiUrlPresent: client.api_url_present,
        apiKeyPresent: client.api_key_present,
      },
      localFallback: false,
      clientDatabaseDsn: false,
    };
    if (opts.json) return jsonOut(report);
    lineOut('client transport : authenticated https');
    lineOut('local fallback   : disabled');
    return;
  }

  const { httpStore: http } = resolveNotesClientStore(process.env);
  if (cmd === 'list') return commandList(http, opts);
  if (cmd === 'get') return commandGet(http, opts._[0], opts);
  if (cmd === 'create') return commandCreate(http, opts);
  if (cmd === 'update') return commandUpdate(http, opts._[0], opts);
  if (cmd === 'delete') return commandDelete(http, opts._[0], opts);
  if (cmd === 'archive') {
    const note = await http.updateNote(requireArg(opts._[0], 'id'), { archived: true });
    return opts.json ? jsonOut(note) : lineOut(noteSummary(note));
  }
  if (cmd === 'restore') {
    const note = await http.updateNote(requireArg(opts._[0], 'id'), { archived: false });
    return opts.json ? jsonOut(note) : lineOut(noteSummary(note));
  }
  if (cmd === 'labels') return commandLabels(http, opts._[0], opts._.slice(1), opts);
  if (cmd === 'markdown') return commandMarkdown(http, opts._[0], opts._.slice(1), opts);
  throw new Error(`notes: ${cmd} is not available on the canonical HTTPS client.`);
}

main().catch((error) => {
  process.stderr.write(`notes: ${error.message || error}\n`);
  process.exitCode = 1;
});
