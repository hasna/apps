#!/usr/bin/env bun
// @bun
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import {
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  archiveNote,
  assignLabel,
  contentFingerprint,
  dataRoot,
  deleteLabelEverywhere,
  deleteNote,
  generateTitle,
  getNote,
  listNotes,
  loadLabelList,
  loadNotes,
  loadSettings,
  markdownPlainText,
  migrateStoreToV2,
  moveNoteToMachine,
  normalizeLabels,
  purgeExpiredTrash,
  renameLabel,
  restoreNote,
  saveLabelList,
  saveNote,
  saveSettings,
  renderMarkdownSafe,
  trashNote,
  unassignLabel,
} from '../tools/notes-lib.mjs';
import {
  CHAT_TOOL_SCHEMAS,
  runNotesAgent,
} from '../tools/notes-agent.mjs';
import { notesEventsStatus, reconcileNoteCreatedEvents } from '../tools/notes-events.mjs';
import { resolveNotesClientStore, resolveNotesClientTransport } from '../sdk/index.mjs';
import {
  MigrationLedger,
  resolveServerDataBackend,
  resolveDatabaseUrl,
} from '../src/generated/storage-kit/index.js';
import { openPgAdapter } from '../server/pg-adapter.mjs';
import { notesPgMigrations } from '../server/pg-migrations.ts';

const DEFAULT_LIMIT = 10;

function usage() {
  return `Hasna Notes CLI

Usage:
  notes list [--json] [--limit 10] [--offset 0] [--label name] [--machine id] [--query text]
  notes get <id> [--json]
  notes create [--title text] [--body text | --body-file path] [--label name ...] [--actor-type agent] [--actor-name name] [--target-machine id] [--machine-name friendly] [--json]
  notes delete <id> [--permanent] [--yes|--force]
  notes archive <id>
  notes trash <id> [--retention-days 30] [--yes|--force]
  notes restore <id>
  notes purge <id> [--yes|--force]
  notes cleanup-trash [--yes|--force]
  notes migrate --to-v2 [--dry-run] [--json]   (alias: migrate-frontmatter)
  notes move <id> <machine>
  notes markdown commands [--json]
  notes markdown render <id> [--json]
  notes markdown plain-text <id> [--json]
  notes markdown apply-command <command-id> --text markdown [--selection-start n] [--selection-end n] [--url href] [--json]
  notes agent "prompt" [--json] [--yes] [--dry-run] [--actor-name name]
  notes chat "/goal organize renewal notes" [--json] [--yes]
  notes agent tools [--json]
  notes settings get [--json]
  notes settings set-trash-retention <days> [--json]
  notes labels list [--json]
  notes labels create <name>
  notes labels rename <old> <new>
  notes labels delete <name>
  notes labels assign <note-id> <name>
  notes labels unassign <note-id> <name>
  notes title <id> [--apply] [--force] [--sidecar http://127.0.0.1:8765] [--sidecar-token token] [--json]
  notes storage status [--json]
  notes storage migrate --dry-run [--json]
  notes events status [--json]

Data root defaults to ${dataRoot()} and can be overridden with HASNA_NOTES_HOME / HASNA_NOTES_ROOT / NOTES_HOME.`;
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq > 0 ? eq : undefined);
    const takesValue = !['json', 'apply', 'force', 'permanent', 'include-trash', 'include-archived', 'help', 'yes', 'dry-run', 'to-v2'].includes(key);
    const value = eq > 0 ? arg.slice(eq + 1) : (takesValue ? argv[++i] : true);
    if (key === 'label') opts.label = [...(opts.label || []), value];
    else opts[key] = value;
  }
  return opts;
}

function jsonOut(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function lineOut(value) {
  process.stdout.write(String(value) + '\n');
}

function requireArg(value, name) {
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function noteSummary(note) {
  const labels = note.labels.length ? ` [${note.labels.join(', ')}]` : '';
  return `${note.updatedAt}  ${note.id}  ${(note.title || 'Untitled Note')}${labels}`;
}

function permanentDeletePreview(note, command) {
  return {
    ok: false,
    dryRun: true,
    requiresConfirmation: true,
    command,
    preview: {
      id: note.id,
      title: note.title || 'Untitled Note',
      status: note.status || 'active',
      permanent: true,
    },
    hint: 'Re-run with --yes or --force to permanently delete.',
  };
}

function moveToTrashPreview(note, command) {
  return {
    ok: false,
    dryRun: true,
    requiresConfirmation: true,
    command,
    preview: {
      id: note.id,
      title: note.title || 'Untitled Note',
      status: note.status || 'active',
      permanent: false,
      toStatus: 'trash',
    },
    hint: 'Re-run with --yes or --force to move this note to Trash.',
  };
}

function cleanupTrashPreview(notes, command) {
  return {
    ok: false,
    dryRun: true,
    requiresConfirmation: true,
    command,
    preview: {
      permanent: true,
      count: notes.length,
      ids: notes.map(note => note.id),
      titles: notes.map(note => note.title || 'Untitled Note'),
    },
    hint: 'Re-run with --yes or --force to purge expired Trash notes.',
  };
}

function hasConfirmationFlag(opts) {
  return !!(opts.yes || opts.force);
}

function shouldAvoidPrompt(opts) {
  return !!opts.json || !!process.env.CI || !process.stdin.isTTY || !process.stdout.isTTY;
}

async function promptYesNo(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^(y|yes)$/i.test(String(answer || '').trim());
  } finally {
    rl.close();
  }
}

async function requireDestructiveConfirmation(preview, opts, message) {
  if (hasConfirmationFlag(opts)) return true;
  if (shouldAvoidPrompt(opts)) {
    // --json is the contracted dry-run PREVIEW (exit 0, requiresConfirmation
    // payload). The plain non-interactive path is a REFUSAL — scripts must be
    // able to detect from the exit code that nothing was written (exit 2).
    if (opts.json) jsonOut(preview);
    else {
      lineOut(`${message} Re-run with --yes or --force to confirm.`);
      process.exitCode = 2;
    }
    return false;
  }
  const ok = await promptYesNo(message);
  if (!ok) lineOut('Cancelled');
  return ok;
}

async function bodyFromOpts(opts) {
  if (opts['body-file']) return readFile(String(opts['body-file']), 'utf8');
  return String(opts.body || '');
}

async function commandList(opts, http) {
  if (http) {
    // The dialect list endpoint supports limit (+ cursor paging) only. Filters
    // that exist on the local store must fail loud over the wire rather than
    // return unfiltered results dressed as filtered ones.
    const unsupported = [
      ['offset', opts.offset],
      ['label', opts.label],
      ['machine', opts.machine],
      ['status', opts.status],
      ['query', opts.query],
    ].filter(([name, value]) => value !== undefined && value !== null && value !== 0);
    if (unsupported.length) {
      throw new Error(
        `notes list over the HTTP API does not support --${unsupported[0][0]}; ` +
          'the personalnotes/v1 list endpoint filters by limit only. Unset HASNA_NOTES_API_URL to use the local store filters.',
      );
    }
    const dialect = await http.listNotes({ limit: opts.limit || DEFAULT_LIMIT });
    const page = {
      items: dialect.data,
      limit: opts.limit || DEFAULT_LIMIT,
      offset: 0,
      total: dialect.nextCursor ? null : dialect.data.length,
      hasMore: !!dialect.nextCursor,
      nextOffset: dialect.data.length,
    };
    if (opts.json) return jsonOut(page);
    for (const note of page.items) lineOut(noteSummary(note));
    if (page.hasMore) lineOut(`View more: --limit ${page.limit}`);
    return;
  }
  const page = await listNotes({
    limit: opts.limit || DEFAULT_LIMIT,
    offset: opts.offset || 0,
    label: Array.isArray(opts.label) ? opts.label[0] : opts.label,
    machine: opts.machine,
    status: opts.status,
    includeTrash: opts['include-trash'],
    includeArchived: opts['include-archived'],
    query: opts.query,
  });
  if (opts.json) return jsonOut(page);
  for (const note of page.items) lineOut(noteSummary(note));
  if (page.hasMore) lineOut(`View more: --offset ${page.nextOffset} --limit ${page.limit}`);
}

async function commandGet(id, opts, http) {
  const noteId = requireArg(id, 'id');
  if (http) {
    const note = await http.getNote(noteId);
    if (!note) throw new Error('note_not_found');
    if (opts.json) return jsonOut(note);
    lineOut(`# ${note.title || 'Untitled Note'}`);
    lineOut(`id: ${note.id}`);
    lineOut(`labels: ${(note.labels || []).join(', ') || '(none)'}`);
    lineOut(`updatedAt: ${note.updatedAt}`);
    lineOut('');
    lineOut(note.bodyMarkdown || '');
    return;
  }
  const note = await getNote(noteId);
  if (!note) throw new Error('note_not_found');
  if (opts.json) return jsonOut(note);
  lineOut(`# ${note.title || 'Untitled Note'}`);
  lineOut(`id: ${note.id}`);
  lineOut(`labels: ${note.labels.join(', ') || '(none)'}`);
  lineOut(`updatedAt: ${note.updatedAt}`);
  lineOut('');
  lineOut(note.body || '');
}

async function commandCreate(opts, http) {
  const title = String(opts.title || '').trim();
  if (http) {
    const note = await http.createNote({
      title: title || 'Untitled Note',
      bodyMarkdown: await bodyFromOpts(opts),
      labels: normalizeLabels(opts.label || []),
    });
    if (opts.json) return jsonOut(note);
    lineOut(noteSummary(note));
    return;
  }
  const now = new Date().toISOString();
  const note = await saveNote({
    title: title || 'Untitled Note',
    body: await bodyFromOpts(opts),
    labels: normalizeLabels(opts.label || []),
    status: 'active',
    machine: opts['target-machine'] || opts.machine,
    machineFriendlyName: opts['machine-name'] || '',
    createdByActorType: opts['actor-type'] || process.env.HASNA_NOTES_ACTOR_TYPE || 'agent',
    createdByName: opts['actor-name'] || process.env.HASNA_NOTES_ACTOR_NAME || process.env.USER || 'agent',
    titleLocked: !!title,
    titleSource: title ? 'manual' : 'default',
    titleContentFingerprint: '',
    createdAt: now,
    updatedAt: now,
  }, dataRoot(), { eventContext: { kind: 'created', writer: 'cli' } });
  if (opts.label?.length) await saveLabelList([...(await loadLabelList()), ...opts.label]);
  if (opts.json) return jsonOut(note);
  lineOut(noteSummary(note));
}

async function commandDelete(id, opts, http) {
  const noteId = requireArg(id, 'id');
  if (http) {
    if (opts.permanent) {
      throw new Error(
        'notes delete --permanent is a local-store operation; the personalnotes/v1 ' +
          'dialect has no permanent delete (DELETE soft-deletes via deletedAt). ' +
          'Unset HASNA_NOTES_API_URL to purge from the local store.',
      );
    }
    if (!opts['yes'] && !opts.force) {
      const note = await http.getNote(noteId);
      if (!note) throw new Error('note_not_found');
      const preview = moveToTrashPreview({ title: note.title, status: note.deletedAt ? 'trash' : 'active' }, 'delete');
      const message = `Delete "${preview.preview.title}"? The dialect deletes softly (deletedAt); there is no REST restore.`;
      if (!(await requireDestructiveConfirmation(preview, opts, message))) return;
    }
    const result = await http.deleteNote(noteId);
    if (opts.json) return jsonOut({ ok: true, deleted: true });
    lineOut('Deleted');
    return;
  }
  const note = await getNote(noteId);
  if (!note) throw new Error('note_not_found');
  const permanent = opts.permanent || note.status === 'trash';
  if (permanent) {
    const preview = permanentDeletePreview(note, 'delete');
    const message = `Delete permanently? "${preview.preview.title}" will be deleted and cannot be undone.`;
    if (!(await requireDestructiveConfirmation(preview, opts, message))) return;
    await deleteNote(note.id);
    if (opts.json) return jsonOut({ ok: true, permanent: true });
    lineOut('Permanently deleted');
    return;
  }
  const preview = moveToTrashPreview(note, 'delete');
  const message = `Move note to Trash? "${preview.preview.title}" can be restored from Trash.`;
  if (!(await requireDestructiveConfirmation(preview, opts, message))) return;
  const trashed = await trashNote(note.id, { retentionDays: opts['retention-days'] });
  if (opts.json) return jsonOut(trashed);
  lineOut('Moved to Trash');
}

async function commandArchive(id, opts) {
  const note = await archiveNote(requireArg(id, 'id'));
  if (opts.json) return jsonOut(note);
  lineOut(noteSummary(note));
}

async function commandTrash(id, opts) {
  const note = await getNote(requireArg(id, 'id'));
  if (!note) throw new Error('note_not_found');
  if (note.status === 'trash') {
    if (opts.json) return jsonOut(note);
    lineOut(noteSummary(note));
    return;
  }
  const preview = moveToTrashPreview(note, 'trash');
  const message = `Move note to Trash? "${preview.preview.title}" can be restored from Trash.`;
  if (!(await requireDestructiveConfirmation(preview, opts, message))) return;
  const trashed = await trashNote(note.id, { retentionDays: opts['retention-days'] });
  if (opts.json) return jsonOut(trashed);
  lineOut(noteSummary(trashed));
}

async function commandRestore(id, opts) {
  const note = await restoreNote(requireArg(id, 'id'));
  if (opts.json) return jsonOut(note);
  lineOut(noteSummary(note));
}

async function commandPurge(id, opts) {
  const note = await getNote(requireArg(id, 'id'));
  if (!note) throw new Error('note_not_found');
  const preview = permanentDeletePreview(note, 'purge');
  const message = `Delete permanently? "${preview.preview.title}" will be deleted and cannot be undone.`;
  if (!(await requireDestructiveConfirmation(preview, opts, message))) return;
  await deleteNote(note.id);
  if (opts.json) return jsonOut({ ok: true, permanent: true });
  lineOut('Purged');
}

async function commandCleanupTrash(opts) {
  const now = Date.now();
  const expired = (await loadNotes()).filter(note => (
    note.status === 'trash' &&
    note.trashExpiresAt &&
    Date.parse(note.trashExpiresAt) <= now
  ));
  if (expired.length) {
    const preview = cleanupTrashPreview(expired, 'cleanup-trash');
    const message = `Purge ${expired.length} expired Trash note(s)? This cannot be undone.`;
    if (!(await requireDestructiveConfirmation(preview, opts, message))) return;
  }
  const result = await purgeExpiredTrash();
  if (opts.json) return jsonOut(result);
  lineOut(`Purged ${result.count} expired note(s)`);
}

// One-shot frontmatter migration to schema v2 (idempotent, backup-first,
// atomic per file, body preserved byte-for-byte). v1 files stay readable
// without it — this exists to retire the v1 keys from disk in one pass.
async function commandMigrate(opts) {
  if (!opts['to-v2']) throw new Error('migrate_target_required (use --to-v2)');
  const result = await migrateStoreToV2(dataRoot(), { dryRun: !!opts['dry-run'] });
  if (opts.json) return jsonOut(result);
  const prefix = result.dryRun ? '[dry-run] ' : '';
  lineOut(`${prefix}scanned ${result.scanned} note file(s): ${result.migrated} migrated, ${result.alreadyV2} already v2, ${result.skipped} skipped`);
  const dropped = Object.keys(result.droppedKeys).sort();
  if (dropped.length) {
    lineOut(`dropped v1 keys: ${dropped.map(key => `${key} (${result.droppedKeys[key]})`).join(', ')}`);
  }
  if (!result.dryRun && result.migrated) lineOut(`originals backed up once to ${result.backupDir}`);
}

async function commandMove(id, machine, opts) {
  const note = await moveNoteToMachine(requireArg(id, 'id'), requireArg(machine, 'machine'), {
    machineFriendlyName: opts['machine-name'],
  });
  if (opts.json) return jsonOut(note);
  lineOut(noteSummary(note));
}

async function markdownInput(idOrText, opts) {
  if (opts.text != null) return String(opts.text);
  if (opts['body-file'] || opts['text-file']) return readFile(String(opts['body-file'] || opts['text-file']), 'utf8');
  const note = await getNote(requireArg(idOrText, 'id'));
  if (!note) throw new Error('note_not_found');
  return note.body || '';
}

async function commandMarkdown(action, args, opts) {
  if (action === 'commands' || action === 'slash-commands') {
    const out = { commands: MARKDOWN_COMMANDS };
    if (opts.json) return jsonOut(out);
    for (const command of MARKDOWN_COMMANDS) lineOut(`${command.id}\t${command.label}`);
    return;
  }
  if (action === 'render') {
    const markdown = await markdownInput(args[0], opts);
    const html = renderMarkdownSafe(markdown);
    if (opts.json) return jsonOut({ html });
    lineOut(html);
    return;
  }
  if (action === 'plain-text' || action === 'plain') {
    const text = markdownPlainText(await markdownInput(args[0], opts));
    if (opts.json) return jsonOut({ text });
    lineOut(text);
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
  throw new Error('unknown_markdown_command');
}

async function commandSettings(action, args, opts) {
  if (action === 'get') {
    const settings = await loadSettings();
    if (opts.json) return jsonOut(settings);
    lineOut(`trashRetentionDays: ${settings.trashRetentionDays}`);
    return;
  }
  if (action === 'set-trash-retention') {
    const days = Number(requireArg(args[0], 'days'));
    const settings = await saveSettings({ trashRetentionDays: days });
    if (opts.json) return jsonOut(settings);
    lineOut(`trashRetentionDays: ${settings.trashRetentionDays}`);
    return;
  }
  throw new Error('unknown_settings_command');
}

async function commandLabels(action, args, opts) {
  if (action === 'list') {
    const labels = await loadLabelList();
    if (opts.json) return jsonOut({ labels });
    labels.forEach(lineOut);
    return;
  }
  if (action === 'create') {
    const name = requireArg(args[0], 'label');
    await saveLabelList([...(await loadLabelList()), name]);
    if (opts.json) return jsonOut({ ok: true, labels: await loadLabelList() });
    lineOut('Created');
    return;
  }
  if (action === 'rename') {
    await renameLabel(requireArg(args[0], 'old_label'), requireArg(args[1], 'new_label'));
    if (opts.json) return jsonOut({ ok: true, labels: await loadLabelList() });
    lineOut('Renamed');
    return;
  }
  if (action === 'delete') {
    await deleteLabelEverywhere(requireArg(args[0], 'label'));
    if (opts.json) return jsonOut({ ok: true, labels: await loadLabelList() });
    lineOut('Deleted');
    return;
  }
  if (action === 'assign') {
    const note = await assignLabel(requireArg(args[0], 'id'), requireArg(args[1], 'label'));
    if (opts.json) return jsonOut(note);
    lineOut(noteSummary(note));
    return;
  }
  if (action === 'unassign') {
    const note = await unassignLabel(requireArg(args[0], 'id'), requireArg(args[1], 'label'));
    if (opts.json) return jsonOut(note);
    lineOut(noteSummary(note));
    return;
  }
  throw new Error('unknown_labels_command');
}

async function commandTitle(id, opts) {
  const note = await getNote(requireArg(id, 'id'));
  if (!note) throw new Error('note_not_found');
  const text = note.body || '';
  const result = await generateTitle(text, { sidecar: opts.sidecar, sidecarToken: opts['sidecar-token'] });
  const fingerprint = contentFingerprint(markdownPlainText(text));
  if (opts.apply) {
    if (note.titleLocked && !opts.force) throw new Error('title_locked');
    note.title = result.title;
    note.titleLocked = false;
    note.titleSource = 'generated';
    note.titleContentFingerprint = fingerprint;
    note.updatedAt = new Date().toISOString();
    await saveNote(note);
  }
  const out = { title: result.title, provider: result.provider, fingerprint, applied: !!opts.apply };
  if (opts.json) return jsonOut(out);
  lineOut(result.title);
}

async function commandAgent(args, opts) {
  if (args[0] === 'tools') {
    const out = { tools: CHAT_TOOL_SCHEMAS };
    if (opts.json) return jsonOut(out);
    for (const tool of CHAT_TOOL_SCHEMAS) {
      const flags = [
        tool.safety.readOnly ? 'read' : '',
        tool.safety.mutates ? 'write' : '',
        tool.safety.requiresConfirmation ? 'confirm' : '',
      ].filter(Boolean).join(',');
      lineOut(`${tool.name}\t${flags}\t${tool.description}`);
    }
    return;
  }
  const prompt = requireArg(args.join(' ').trim(), 'prompt');
  const events = [];
  const result = await runNotesAgent(prompt, {
    yes: !!opts.yes,
    confirmWrites: !!opts.yes,
    dryRun: !!opts['dry-run'],
    actorName: opts['actor-name'] || process.env.HASNA_NOTES_ACTOR_NAME || 'Hasna Notes CLI Agent',
    actorType: opts['actor-type'] || 'agent',
    title: opts.title,
    body: opts.body,
    text: opts.text,
    limit: opts.limit,
    labels: opts.label || [],
    onEvent: event => events.push(event),
  });
  if (opts.json) return jsonOut({ ...result, events });
  lineOut(result.text);
  if (result.sources?.length) {
    lineOut('');
    lineOut('Sources:');
    for (const source of result.sources) lineOut(`- ${source.title} (${source.id})`);
  }
  if (result.pendingConfirmations?.length) {
    lineOut('');
    lineOut('Confirmation required. Re-run with --yes to apply the previewed write.');
  }
}

// --- storage verbs -----------------------------------------------------------

async function commandStorage(action, args, opts) {
  if (action === 'status') return commandStorageStatus(opts);
  if (action === 'migrate') return commandStorageMigrate(opts);
  throw new Error('unknown_storage_action');
}

async function commandStorageStatus(opts) {
  // Client side: one transport resolver. Server side: the backend selection
  // from the environment — never the DSN value.
  const client = resolveNotesClientTransport(process.env);
  const server = resolveServerDataBackend('notes', process.env);
  const report = {
    client: {
      transport: client.transport,
      source: client.source,
      apiUrlPresent: client.api_url_present,
      apiKeyPresent: client.api_key_present,
    },
    server: {
      backend: server.backend,
      source: server.source,
      databaseUrlPresent: server.databaseUrlPresent,
    },
    readiness: 'configured',
  };
  if (opts.json) return jsonOut(report);
  lineOut(`client transport : ${client.transport}${client.source !== 'default' ? ` (${client.source})` : ''}`);
  lineOut(`server backend   : ${server.backend}${server.databaseUrlPresent ? ' (HASNA_NOTES_DATABASE_URL)' : ' (sqlite default)'}`);
}

async function commandStorageMigrate(opts) {
  // The migration runner is the mutation path (scripts/apply-postgres-migrations.mjs,
  // owner DSN). This verb reports the dry-run plan only.
  if (!opts['dry-run']) throw new Error('storage_migrate_dry_run_required');
  const connectionString = resolveDatabaseUrl('notes', process.env);
  if (!connectionString) {
    throw new Error(
      'HASNA_NOTES_DATABASE_URL is not set: the postgresql backend is not configured. ' +
        'Set it to plan migrations, or leave it unset for the sqlite backend (no migrations needed).',
    );
  }
  const db = openPgAdapter({ connectionString, applicationName: '@hasna/notes' });
  try {
    const ledger = new MigrationLedger(db.client, notesPgMigrations());
    const result = await ledger.migrate({ dryRun: true });
    const pending = result.plan.filter((item) => item.state === 'pending').map((item) => item.migration.id);
    const summary = {
      ok: true,
      dryRun: true,
      backend: 'postgresql',
      total: notesPgMigrations().length,
      alreadyApplied: result.plan.length - pending.length,
      pending,
    };
    if (opts.json) return jsonOut(summary);
    lineOut(`storage migrate --dry-run: total=${summary.total} already=${summary.alreadyApplied} pending=${pending.length}`);
    if (pending.length) lineOut(`pending: ${pending.join(', ')}`);
  } finally {
    await db.close();
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  await reconcileNoteCreatedEvents(dataRoot()).catch(() => null);
  if (!cmd || cmd === 'help' || cmd === '--help' || opts.help) {
    lineOut(usage());
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    lineOut(pkg.version);
    return;
  }
  const store = resolveNotesClientStore(process.env);
  const http = store.transport === 'http' ? store.httpStore : null;
  if (cmd === 'list') return commandList(opts, http);
  if (cmd === 'get') return commandGet(opts._[0], opts, http);
  if (cmd === 'create') return commandCreate(opts, http);
  if (cmd === 'delete') return commandDelete(opts._[0], opts, http);
  if (cmd === 'archive') return commandArchive(opts._[0], opts);
  if (cmd === 'trash') return commandTrash(opts._[0], opts);
  if (cmd === 'restore') return commandRestore(opts._[0], opts);
  if (cmd === 'purge') return commandPurge(opts._[0], opts);
  if (cmd === 'cleanup-trash') return commandCleanupTrash(opts);
  if (cmd === 'migrate') return commandMigrate(opts);
  if (cmd === 'migrate-frontmatter') return commandMigrate({ ...opts, 'to-v2': true });
  if (cmd === 'move') return commandMove(opts._[0], opts._[1], opts);
  if (cmd === 'markdown') return commandMarkdown(opts._[0], opts._.slice(1), opts);
  if (cmd === 'settings') return commandSettings(opts._[0], opts._.slice(1), opts);
  if (cmd === 'labels') return commandLabels(opts._[0], opts._.slice(1), opts);
  if (cmd === 'title') return commandTitle(opts._[0], opts);
  if (cmd === 'storage') return commandStorage(opts._[0], opts._.slice(1), opts);
  if (cmd === 'events' && opts._[0] === 'status') {
    const status = await notesEventsStatus(dataRoot());
    if (opts.json) return jsonOut(status);
    for (const [key, value] of Object.entries(status)) lineOut(`${key}: ${value}`);
    return;
  }
  if (cmd === 'agent' || cmd === 'chat') return commandAgent(opts._, opts);
  throw new Error('unknown_command');
}

main().catch((err) => {
  process.stderr.write(`notes: ${err.message || err}\n`);
  process.exitCode = 1;
});
