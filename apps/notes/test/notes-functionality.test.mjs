import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  archiveNote,
  assignLabel,
  contentFingerprint,
  deleteLabelEverywhere,
  generateTitle,
  getNote,
  listNotes,
  loadLabelList,
  machineIdentity,
  loadNotes,
  loadSettings,
  markdownPlainText,
  markdownSafeText,
  normalizeLabels,
  migrateNoteTextToV2,
  migrateStoreToV2,
  moveNoteToMachine,
  parseNote,
  serializeNote,
  purgeExpiredTrash,
  renameLabel,
  restoreNote,
  saveNote,
  saveSettings,
  renderMarkdownSafe,
  trashNote,
} from '../tools/notes-lib.mjs';
import {
  CHAT_TOOL_SCHEMAS,
  executeNotesAgentTool,
  runNotesAgent,
  runNotesGoal,
} from '../tools/notes-agent.mjs';
import { notesEventsDataDir } from '../tools/notes-events.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli', 'notes.mjs');
const mcpPath = join(repoRoot, 'mcp', 'notes-mcp.mjs');

function uuidFor(i) {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'notes-test-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

async function createdEvents(root) {
  const inbox = join(notesEventsDataDir(root), 'spool', 'inbox');
  const names = await readdir(inbox).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error));
  return Promise.all(names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .map(async (name) => JSON.parse(await readFile(join(inbox, name), 'utf8'))));
}

function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function openFakeTitleServer(title, seen = []) {
  const server = createServer((req, res) => {
    if (req.url === '/title') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { seen.push(JSON.parse(body)); } catch { seen.push({}); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ title }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) });
    });
  });
}

test('legacy tags parse as labels and serialize as labels', async (t) => {
  const root = await tempRoot(t);
  const notesDir = join(root, 'notes');
  await mkdir(notesDir, { recursive: true });
  const id = '11111111-1111-4111-8111-111111111111';
  await writeFile(join(notesDir, `${id}.md`), `---
id: ${id}
title: Legacy Tags
tags: [old, "a,b"]
status: active
createdAt: 2026-01-01T00:00:00Z
updatedAt: 2026-01-01T00:00:00Z
author: a
agent: open-notes-app
machine: m
---
body
`, 'utf8');

  const [note] = await loadNotes(root);
  assert.deepEqual(note.labels, ['old', 'a,b']);
  assert.equal(note.titleLocked, true);
  assert.equal(note.titleSource, 'manual');
  await saveNote(note, root);
  const raw = await readFile(join(notesDir, `${id}.md`), 'utf8');
  assert.match(raw, /^labels: \[old, "a,b"\]$/m);
  assert.doesNotMatch(raw, /^tags:/m);
});

test('notes list defaults to latest 10 and paginates', async (t) => {
  const root = await tempRoot(t);
  for (let i = 0; i < 12; i++) {
    await saveNote({
      id: uuidFor(i),
      title: `Note ${i}`,
      labels: i % 2 ? ['odd'] : ['even'],
      createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      updatedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      body: `body ${i}`,
    }, root);
  }

  const page = await listNotes({}, root);
  assert.equal(page.limit, 10);
  assert.equal(page.items.length, 10);
  assert.equal(page.total, 12);
  assert.equal(page.hasMore, true);
  assert.equal(page.items[0].title, 'Note 11');

  const filtered = await listNotes({ label: 'odd', limit: 10 }, root);
  assert.equal(filtered.total, 6);
  assert.ok(filtered.items.every(n => n.labels.includes('odd')));
});

test('shared library enforces UUID note ids for native Swift compatibility', async (t) => {
  const root = await tempRoot(t);
  const note = await saveNote({ id: 'non-native-id', title: 'Native Safe', body: 'body' }, root);
  assert.match(note.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal((await loadNotes(root))[0].id, note.id);
});

test('frontmatter scalars round-trip in lockstep with the Swift parser', async (t) => {
  const root = await tempRoot(t);
  // Backslash-then-n titles: sequential unescaping regexes corrupted
  // "C:\notes" into "C:\" + a real newline (P3 adversarial finding #3); the
  // single-pass decoder must round-trip them byte-exact — exactly like
  // MarkdownStore.unescapeDoubleQuoted does for the same file bytes.
  for (const title of ['C:\\notes', 'back\\nslash', 'tail\\', 'a\\\\nb', 'quote " and \\ mix']) {
    const id = randomUUID();
    await saveNote({ id, title, body: 'b' }, root);
    assert.equal((await getNote(id, root)).title, title, `title survives: ${JSON.stringify(title)}`);
  }
  // A value the user wrapped in single quotes must be double-quoted on write
  // (MarkdownStore.yamlScalar parity), or the parser strips the quotes.
  const quoted = await saveNote({ id: uuidFor(90), title: "'hello'", body: 'b' }, root);
  assert.equal((await getNote(quoted.id, root)).title, "'hello'");
  const rawQuoted = await readFile(join(root, 'notes', `${quoted.id}.md`), 'utf8');
  assert.match(rawQuoted, /^title: "'hello'"$/m);
});

test('UUID-shaped non-RFC-4122 note ids keep a stable identity across reads', async (t) => {
  const root = await tempRoot(t);
  // Not a valid RFC-4122 UUID (version 3--3, variant 4---): a foreign/synthetic id
  // the migrator accepts verbatim. parseNote used to reject it and mint a fresh
  // random fallback id on EVERY read — a different id per list call.
  const foreign = '11111111-2222-3333-4444-555555555555';
  await mkdir(join(root, 'notes'), { recursive: true });
  await writeFile(join(root, 'notes', `${foreign}.md`),
    `---\nid: ${foreign}\ntitle: Foreign Id\nrev: 1\n---\nbody\n`, 'utf8');
  const first = await getNote(foreign, root);
  assert.ok(first, 'note resolvable by its on-disk id');
  assert.equal(first.id, foreign);
  const second = await getNote(foreign, root);
  assert.equal(second.id, foreign, 'identity stable across reads');
  // Truly malformed ids still fall back to a generated UUID (never crash).
  const parsed = parseNote('---\nid: not-a-uuid\ntitle: Bad\n---\nbody\n');
  assert.notEqual(parsed.id, 'not-a-uuid');
  assert.match(parsed.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('non-markdown contentFormat survives load→save and empty actor provenance is preserved', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(91);
  await saveNote({ id, title: 'Legacy Plain', body: 'plain text' }, root);
  // Rewrite the stored file to the legacy format + explicitly empty provenance
  // (what a pre-provenance origin machine serializes).
  const raw = (await readFile(join(root, 'notes', `${id}.md`), 'utf8'))
    .replace(/^contentFormat: markdown$/m, 'contentFormat: plaintext')
    .replace(/^createdByActorType: .*$/m, 'createdByActorType: ""')
    .replace(/^createdByName: .*$/m, 'createdByName: ""');
  await writeFile(join(root, 'notes', `${id}.md`), raw, 'utf8');

  const loaded = await getNote(id, root);
  assert.equal(loaded.contentFormat, 'plaintext', 'parser must not coerce contentFormat (Note.swift parity)');
  assert.equal(loaded.createdByActorType, '', 'explicit empty provenance stays empty (no replica drift)');
  assert.equal(loaded.createdByName, '');

  // ...and a save cycle keeps all three (previously rewritten to markdown/human/user).
  const saved = await saveNote(loaded, root);
  assert.equal(saved.contentFormat, 'plaintext');
  const rewritten = await readFile(join(root, 'notes', `${id}.md`), 'utf8');
  assert.match(rewritten, /^contentFormat: plaintext$/m);
  assert.match(rewritten, /^createdByActorType: ""$/m);
  assert.match(rewritten, /^createdByName: ""$/m);

  // New local notes without provenance still get the defaults.
  const fresh = await saveNote({ id: uuidFor(92), title: 'Fresh', body: 'b' }, root);
  assert.equal(fresh.createdByActorType, 'human');
  assert.ok(fresh.createdByName);
  assert.equal(fresh.contentFormat, 'markdown');
});

test('markdown persists as canonical body with safe rendering and plain text extraction', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(88);
  const markdown = '# Roadmap **Planning**\n\n- [x] Renewal [brief](https://example.com)\n<script>alert(1)</script>\n\n```js\nconst x = "<unsafe>";\n```';
  const note = await saveNote({ id, title: 'Markdown Note', body: markdown }, root);
  assert.equal(note.contentFormat, 'markdown');
  assert.equal((await getNote(id, root)).body, markdown);
  const raw = await readFile(join(root, 'notes', `${id}.md`), 'utf8');
  assert.match(raw, /^contentFormat: markdown$/m);

  const html = renderMarkdownSafe(markdown + '\n[bad](javascript:alert(1))');
  assert.match(html, /<h1>Roadmap <strong>Planning<\/strong><\/h1>/);
  assert.match(html, /<input type="checkbox" disabled checked>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const literal = renderMarkdownSafe(markdownSafeText('**urgent** [x](https://evil.example) `code`'));
  assert.equal(literal, '<p>**urgent** [x](https://evil.example) `code`</p>');
  assert.doesNotMatch(literal, /<strong>|<a |<code>/);

  const urls = renderMarkdownSafe('[blocked](//evil.example)\n[ok](/safe)\n[rel](./safe)');
  assert.doesNotMatch(urls, /href="\/\//);
  assert.match(urls, /href="\/safe"/);
  assert.match(urls, /href="\.\/safe"/);

  assert.equal(
    markdownPlainText(markdown),
    'Roadmap Planning Renewal brief const x = " ";',
  );
  assert.equal(markdownSafeText('* hello [x]'), '\\* hello \\[x\\]');
});

test('markdown command transforms cover inline, blocks, code block, and divider', () => {
  assert.ok(MARKDOWN_COMMANDS.some(command => command.id === 'checklist'));
  assert.equal(
    applyMarkdownCommand('hello', { commandId: 'bold', selectionStart: 0, selectionEnd: 5 }).markdown,
    '**hello**',
  );
  assert.equal(
    applyMarkdownCommand('Title', { commandId: 'h2', selectionStart: 0, selectionEnd: 0 }).markdown,
    '## Title',
  );
  assert.equal(
    applyMarkdownCommand('one\ntwo', { commandId: 'numbered-list', selectionStart: 0, selectionEnd: 7 }).markdown,
    '1. one\n2. two',
  );
  assert.equal(
    applyMarkdownCommand('todo', { commandId: 'checklist', selectionStart: 0, selectionEnd: 4 }).markdown,
    '- [ ] todo',
  );
  assert.equal(
    applyMarkdownCommand('x', { commandId: 'code-block', language: 'js', selectionStart: 0, selectionEnd: 1 }).markdown,
    '```js\nx\n```',
  );
  assert.equal(
    applyMarkdownCommand('a', { commandId: 'divider', selectionStart: 1, selectionEnd: 1 }).markdown,
    'a\n---',
  );
  assert.equal(
    applyMarkdownCommand('a](https://evil) **b**', {
      commandId: 'link',
      selectionStart: 0,
      selectionEnd: 22,
      url: '//evil.example',
    }).markdown,
    '[a\\]\\(https://evil\\) \\*\\*b\\*\\*](https://)',
  );
});

test('agent tool schemas expose read write and confirmation safety boundaries', () => {
  const byName = new Map(CHAT_TOOL_SCHEMAS.map(tool => [tool.name, tool]));
  assert.equal(byName.get('search_notes').safety.readOnly, true);
  assert.equal(byName.get('summarize_notes').safety.readOnly, true);
  assert.equal(byName.get('create_note').safety.mutates, true);
  assert.equal(byName.get('consolidate_notes').safety.requiresConfirmation, true);
  assert.equal(byName.get('trash_note').safety.requiresConfirmation, true);
  assert.equal(byName.get('move_note').safety.requiresConfirmation, true);
  assert.equal(byName.get('list_labels').safety.readOnly, true);
  assert.equal(byName.get('create_label').safety.mutates, true);
  assert.equal(byName.get('update_label').safety.requiresConfirmation, true);
  assert.equal(byName.get('delete_label').safety.requiresConfirmation, true);
});

test('agent read search summarize and related flows cite source notes', async (t) => {
  const root = await tempRoot(t);
  const first = await saveNote({
    id: uuidFor(210),
    title: 'Quarterly Planning',
    body: 'Renewal planning notes with milestone risks and board review.',
    labels: ['planning'],
    updatedAt: '2026-06-21T10:00:00Z',
  }, root);
  await saveNote({
    id: uuidFor(211),
    title: 'Renewal Follow Up',
    body: 'Customer renewal tasks and board packet follow-up.',
    labels: ['renewal'],
    updatedAt: '2026-06-22T10:00:00Z',
  }, root);

  const search = await executeNotesAgentTool('search_notes', { query: 'renewal' }, { root });
  assert.equal(search.sources.length, 2);
  assert.ok(search.sources.every(source => source.id && source.title));

  const info = await executeNotesAgentTool('note_info', { id: first.id }, { root });
  assert.equal(info.info.title, 'Quarterly Planning');
  assert.equal(info.sources[0].id, first.id);

  const events = [];
  const routedInfo = await runNotesAgent(`show info ${first.id}`, { root, onEvent: event => events.push(event) });
  assert.match(routedInfo.text, /Created by/);
  assert.ok(events.some(event => event.type === 'tool-call' && event.detail.name === 'note_info'));

  const routedRead = await runNotesAgent(`read ${first.id}`, { root });
  assert.match(routedRead.text, /Renewal planning notes/);
  assert.equal(routedRead.toolCalls[0].name, 'read_note');

  const summary = await runNotesAgent('summarize renewal notes', { root, onEvent: event => events.push(event) });
  assert.match(summary.text, /Summary of 2 notes/);
  assert.equal(summary.sources.length, 2);
  assert.ok(events.some(event => event.type === 'tool-call' && event.detail.name === 'summarize_notes'));

  const related = await executeNotesAgentTool('find_related_notes', { id: first.id }, { root });
  assert.equal(related.related[0].title, 'Renewal Follow Up');
});

test('agent write tools preview unsafe changes and apply confirmed create append consolidate', async (t) => {
  const root = await tempRoot(t);
  const base = await saveNote({
    id: uuidFor(220),
    title: 'Source One',
    body: 'Alpha project context.',
    labels: ['alpha'],
  }, root);
  await saveNote({
    id: uuidFor(221),
    title: 'Source Two',
    body: 'Alpha follow-up context.',
    labels: ['alpha'],
  }, root);

  const preview = await executeNotesAgentTool('append_note', { id: base.id, text: 'New line' }, { root });
  assert.equal(preview.requiresConfirmation, true);
  assert.equal((await getNote(base.id, root)).body, 'Alpha project context.');

  const createPreview = await executeNotesAgentTool('create_note', { title: 'Dry Create', body: 'Should not persist.' }, { root, dryRun: true });
  assert.equal(createPreview.dryRun, true);
  assert.equal((await loadNotes(root)).some(note => note.title === 'Dry Create'), false);

  const appended = await executeNotesAgentTool('append_note', { id: base.id, text: 'New line', confirm: true }, { root });
  assert.match(appended.note.body, /New line/);

  const labelPreview = await executeNotesAgentTool('label_note', { id: base.id, label: 'preview-label' }, { root, dryRun: true });
  assert.equal(labelPreview.dryRun, true);
  assert.deepEqual((await getNote(base.id, root)).labels, ['alpha']);

  const labeled = await runNotesAgent(`label ${base.id} routed-label`, { root });
  assert.equal(labeled.toolCalls[0].name, 'label_note');
  assert.ok((await getNote(base.id, root)).labels.includes('routed-label'));

  const unlabelPreview = await runNotesAgent(`unlabel ${base.id} routed-label`, { root, dryRun: true });
  assert.equal(unlabelPreview.toolCalls[0].name, 'unlabel_note');
  assert.ok((await getNote(base.id, root)).labels.includes('routed-label'));

  const unlabeled = await runNotesAgent(`unlabel ${base.id} routed-label`, { root });
  assert.equal(unlabeled.toolCalls[0].name, 'unlabel_note');
  assert.equal((await getNote(base.id, root)).labels.includes('routed-label'), false);

  const updatePreview = await runNotesAgent(`update ${base.id} body: Replaced by agent`, { root });
  assert.equal(updatePreview.status, 'awaiting_confirmation');
  assert.equal(updatePreview.toolCalls[0].name, 'update_note');
  assert.doesNotMatch((await getNote(base.id, root)).body, /Replaced by agent/);

  const updateConfirmed = await runNotesAgent(`update ${base.id} body: Replaced by agent`, { root, yes: true, confirmWrites: true });
  assert.equal(updateConfirmed.status, 'complete');
  assert.match((await getNote(base.id, root)).body, /Replaced by agent/);

  const created = await executeNotesAgentTool('create_note', { title: 'Agent Created', body: 'Created from chat.', labels: ['agent'] }, {
    root,
    actorName: 'Test Agent',
  });
  assert.equal(created.note.createdByActorType, 'agent');
  assert.equal(created.note.createdByName, 'Test Agent');
  assert.deepEqual(created.note.labels, ['agent']);
  assert.ok((await createdEvents(root)).some((event) => event.data.noteId === created.note.id));

  const dryEvents = [];
  const dry = await runNotesAgent('consolidate alpha notes', { root, onEvent: event => dryEvents.push(event) });
  assert.equal(dry.status, 'awaiting_confirmation');
  assert.equal(dry.pendingConfirmations.length, 1);
  assert.equal(dryEvents.at(-1).detail.status, 'awaiting_confirmation');
  assert.equal((await loadNotes(root)).filter(note => note.title === 'Consolidated Notes').length, 0);

  const confirmed = await runNotesAgent('consolidate alpha notes', { root, yes: true, confirmWrites: true, actorName: 'Consolidator' });
  assert.equal(confirmed.status, 'complete');
  const consolidated = (await loadNotes(root)).find(note => note.title === 'Consolidated Notes');
  assert.ok(consolidated);
  assert.equal(consolidated.createdByName, 'Consolidator');
  assert.match(consolidated.body, /Source One/);
  const emitted = await createdEvents(root);
  assert.ok(emitted.some((event) => event.data.noteId === consolidated.id));
  assert.equal(JSON.stringify(emitted).includes('Created from chat.'), false);
  assert.equal(JSON.stringify(emitted).includes('Alpha project context.'), false);
});

test('agent label move and goal flows use shared safe tools', async (t) => {
  const root = await tempRoot(t);
  const note = await saveNote({
    id: uuidFor(225),
    title: 'Goal Source',
    body: 'Alpha goal source body.',
    labels: ['alpha'],
    machine: 'studio-mac',
  }, root);

  const createdLabel = await executeNotesAgentTool('create_label', { name: 'empty-label' }, { root });
  assert.ok(createdLabel.labels.includes('empty-label'));

  const labelList = await executeNotesAgentTool('list_labels', {}, { root });
  assert.ok(labelList.items.some(item => item.name === 'empty-label' && item.count === 0));

  const renamePreview = await executeNotesAgentTool('update_label', { oldName: 'ALPHA', newName: 'beta' }, { root });
  assert.equal(renamePreview.requiresConfirmation, true);
  assert.deepEqual((await getNote(note.id, root)).labels, ['alpha']);

  const renameConfirmed = await executeNotesAgentTool('update_label', { oldName: 'ALPHA', newName: 'beta', confirm: true }, { root });
  assert.ok(renameConfirmed.labels.includes('beta'));
  assert.deepEqual((await getNote(note.id, root)).labels, ['beta']);

  const deletePreview = await executeNotesAgentTool('delete_label', { name: 'BETA' }, { root });
  assert.equal(deletePreview.requiresConfirmation, true);
  assert.deepEqual(deletePreview.preview.affectedNoteIds, [note.id]);

  const deleteConfirmed = await executeNotesAgentTool('delete_label', { name: 'BETA', confirm: true }, { root });
  assert.equal(deleteConfirmed.labels.includes('beta'), false);
  assert.deepEqual((await getNote(note.id, root)).labels, []);

  await assignLabel(note.id, 'beta', root);

  const movePreview = await runNotesAgent(`move ${note.id} to laptop`, { root });
  assert.equal(movePreview.status, 'awaiting_confirmation');
  assert.equal(movePreview.toolCalls[0].name, 'move_note');
  assert.equal((await getNote(note.id, root)).machine, 'studio-mac');

  const moveConfirmed = await runNotesAgent(`move ${note.id} to laptop`, { root, yes: true, confirmWrites: true });
  assert.equal(moveConfirmed.status, 'complete');
  assert.equal((await getNote(note.id, root)).machine, 'laptop');

  const goal = await runNotesGoal('summarize beta notes', { root, maxSteps: 3 });
  assert.equal(goal.mode, 'goal');
  assert.equal(goal.status, 'done');
  assert.equal(goal.goal.objective, 'summarize beta notes');
  assert.ok(goal.goal.steps.length >= 1);

  const slashGoal = await runNotesAgent('/goal summarize beta notes', { root, maxSteps: 2 });
  assert.equal(slashGoal.mode, 'goal');
  assert.equal(slashGoal.goal.status, 'done');
});

test.skip('legacy local CLI agent mode was removed from the canonical client', async (t) => {
  const root = await tempRoot(t);
  const binPath = join(repoRoot, 'bin', 'notes.mjs');
  const env = { HASNA_NOTES_ROOT: root };

  const created = await runNode(binPath, ['create', '--title', 'Renewal alpha', '--body', 'Renewal pricing draft', '--label', 'renewal', '--json'], env);
  assert.equal(created.code, 0, created.stderr);

  // Read-only prompts run directly and return the structured JSON result.
  const summary = await runNode(binPath, ['agent', 'summarize renewal notes', '--json'], env);
  assert.equal(summary.code, 0, summary.stderr);
  const summaryOut = JSON.parse(summary.stdout);
  assert.equal(summaryOut.status, 'complete');
  assert.match(summaryOut.text, /Summary of/);
  assert.ok(summaryOut.sources.length >= 1);

  // Broad writes preview first (awaiting_confirmation, nothing written)…
  const preview = await runNode(binPath, ['agent', 'consolidate renewal notes', '--json'], env);
  assert.equal(preview.code, 0, preview.stderr);
  const previewOut = JSON.parse(preview.stdout);
  assert.equal(previewOut.status, 'awaiting_confirmation');
  assert.equal(previewOut.pendingConfirmations.length, 1);
  assert.equal((await loadNotes(root)).length, 1, 'preview must not write');

  // …and --yes applies the previewed write.
  const applied = await runNode(binPath, ['agent', 'consolidate renewal notes', '--yes', '--json'], env);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).status, 'complete');
  assert.ok((await loadNotes(root)).some(note => note.title === 'Consolidated Notes'));

  // agent tools lists the shared registry; a missing prompt is a non-zero exit.
  const tools = await runNode(binPath, ['agent', 'tools', '--json'], env);
  assert.equal(tools.code, 0, tools.stderr);
  assert.ok(JSON.parse(tools.stdout).tools.some(tool => tool.name === 'consolidate_notes'));
  const missingPrompt = await runNode(binPath, ['agent'], env);
  assert.equal(missingPrompt.code, 1);
  assert.match(missingPrompt.stderr, /prompt_required/);
});

test('labels can be assigned, renamed, listed, and deleted', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(99);
  await saveNote({ id, title: 'Label Note', body: 'body' }, root);

  await assignLabel(id, 'Project', root);
  assert.deepEqual((await getNote(id, root)).labels, ['Project']);
  assert.deepEqual(await loadLabelList(root), ['Project']);

  await renameLabel('project', 'Research', root);
  assert.deepEqual((await getNote(id, root)).labels, ['Research']);
  assert.deepEqual(await loadLabelList(root), ['Research']);

  await deleteLabelEverywhere('research', root);
  assert.deepEqual((await getNote(id, root)).labels, []);
  assert.deepEqual(await loadLabelList(root), []);
});

test('archive trash restore purge retention and move-to-machine preserve metadata', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(120);
  await saveSettings({ trashRetentionDays: 7 }, root);
  const created = await saveNote({
    id,
    title: 'Agent Added Note',
    body: 'body',
    machine: 'studio-mac',
    machineFriendlyName: 'Apple Studio',
    createdByActorType: 'agent',
    createdByName: 'Codewith',
  }, root);
  assert.equal(created.createdByActorType, 'agent');
  assert.equal(created.machine, 'studio-mac');
  assert.equal(created.machineFriendlyName, 'Apple Studio');
  assert.equal(created.rev, 1);

  const moved = await moveNoteToMachine(id, 'laptop', { machineFriendlyName: 'Laptop' }, root);
  assert.equal(moved.machine, 'laptop');
  assert.equal(moved.machineFriendlyName, 'Laptop');
  assert.equal(moved.rev, 2, 'move is a local mutation and bumps rev');

  const archived = await archiveNote(id, root);
  assert.equal(archived.status, 'archived');
  assert.ok(archived.archivedAt);
  assert.equal((await listNotes({ status: 'archived' }, root)).total, 1);
  assert.equal((await listNotes({}, root)).total, 0);

  const restoredFromArchive = await restoreNote(id, root);
  assert.equal(restoredFromArchive.status, 'active');
  assert.ok(restoredFromArchive.restoredAt);

  const trashed = await trashNote(id, {}, root);
  assert.equal(trashed.status, 'trash');
  assert.equal(trashed.machine, 'laptop', 'trash stays attributed to the note machine');
  assert.ok(trashed.trashExpiresAt);
  assert.equal((await listNotes({}, root)).total, 0);
  assert.equal((await listNotes({ status: 'trash' }, root)).total, 1);

  await saveNote({ ...trashed, trashExpiresAt: '2026-01-01T00:00:00Z' }, root);
  const purged = await purgeExpiredTrash(root, new Date('2026-02-01T00:00:00Z'));
  assert.deepEqual(purged.purged, [id]);
  assert.equal(await getNote(id, root), null);

  // Legacy trash (stamped before retention existed — no trashExpiresAt) still
  // expires via trashedAt + the retention setting instead of living forever.
  const legacyId = uuidFor(121);
  await saveNote({
    id: legacyId, title: 'Legacy Trash', body: 'old', status: 'trash',
    trashedAt: '2026-01-01T00:00:00Z', trashExpiresAt: '',
  }, root);
  const legacyPurge = await purgeExpiredTrash(root, new Date('2026-02-01T00:00:00Z'));
  assert.deepEqual(legacyPurge.purged, [legacyId]);
  assert.equal(await getNote(legacyId, root), null);

  assert.equal((await loadSettings(root)).trashRetentionDays, 7);
});

test('frontmatter schema v2: monotonic rev, machine friendly name, v1 auto-detect on read', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(130);

  // Create: initial rev is 1 and the serialized file carries only v2 keys.
  const created = await saveNote({
    id, title: 'Rev Note', body: 'body\n',
    machine: 'studio-mac', machineFriendlyName: 'Apple Studio',
  }, root);
  assert.equal(created.rev, 1);
  const raw = await readFile(join(root, 'notes', `${id}.md`), 'utf8');
  assert.match(raw, /\nrev: 1\n/);
  assert.match(raw, /\nmachine: studio-mac\n/);
  assert.match(raw, /\nmachineFriendlyName: Apple Studio\n/);
  for (const dropped of [
    'sourceMachine:', 'originMachine:', 'previousMachine:', 'targetMachineFriendlyName:',
    'openedFrom:', 'sourceContext:', 'trashMachine:', 'movedAt:',
  ]) {
    assert.ok(!raw.includes(dropped), `v2 frontmatter must not carry ${dropped}`);
  }

  // Every local mutation bumps rev past the on-disk value — even from a stale copy.
  const edited = await saveNote({ ...created, body: 'edited\n' }, root);
  assert.equal(edited.rev, 2);
  const staleWrite = await saveNote({ ...created, rev: 1, body: 'stale copy\n' }, root);
  assert.equal(staleWrite.rev, 3, 'stale in-memory rev still moves forward past disk');

  // Sync-applied writes preserve the given rev verbatim.
  const synced = await saveNote({ ...staleWrite, rev: 9 }, root, { preserveRev: true });
  assert.equal(synced.rev, 9);
  assert.equal((await getNote(id, root)).rev, 9);

  // v1 files read WITHOUT migration: no rev -> 1; legacy friendly names map to
  // machineFriendlyName when they described the note's own machine.
  const v1 = [
    '---',
    `id: ${uuidFor(131)}`,
    'title: V1 Note',
    'labels: [sync]',
    'status: active',
    'createdAt: 2026-06-22T09:00:00Z',
    'updatedAt: 2026-06-22T09:00:00Z',
    'author: someone',
    'agent: notes-app',
    'machine: studio-mac',
    'sourceMachine: studio-mac',
    'sourceMachineFriendlyName: Apple Studio',
    'originMachine: linux-box',
    'originMachineFriendlyName: Spark',
    'previousMachine: laptop',
    'openedFrom: mcp',
    'sourceContext: ticket-123',
    'trashMachine: ""',
    'movedAt: ""',
    '---',
    'v1 body',
  ].join('\n');
  const parsed = parseNote(v1, uuidFor(131));
  assert.equal(parsed.rev, 1, 'v1 file auto-detects as rev 1');
  assert.equal(parsed.machine, 'studio-mac');
  assert.equal(parsed.machineFriendlyName, 'Apple Studio');
  assert.equal(parsed.body, 'v1 body');
  assert.equal(parsed.sourceMachine, undefined, 'dropped keys do not survive parsing');
  assert.equal(parsed.openedFrom, undefined);
  // Round-trip through the v2 serializer keeps the body and rewrites the schema.
  const reserialized = serializeNote(parsed);
  assert.ok(reserialized.endsWith('---\nv1 body'));
  assert.ok(!reserialized.includes('previousMachine:'));
});

test('one-shot migrator upgrades v1 stores in place: idempotent, backup-first, body byte-for-byte', async (t) => {
  const root = await tempRoot(t);
  const dir = join(root, 'notes');
  await mkdir(dir, { recursive: true });

  // (a) Full v1 file with a tricky body: a `---` line, trailing spaces, NO final newline.
  const fullId = uuidFor(140);
  const trickyBody = 'line one\n---\nline "two"  \nno trailing newline';
  const fullV1 = [
    '---',
    `id: ${fullId}`,
    'title: "Full: v1 note"',
    'labels: [alpha, beta]',
    'status: active',
    'folder: ""',
    'contentFormat: markdown',
    'titleLocked: true',
    'titleSource: manual',
    'titleContentFingerprint: abc',
    'createdAt: 2026-06-22T09:00:00Z',
    'updatedAt: 2026-06-30T09:00:00Z',
    'author: someone',
    'agent: notes-app',
    'machine: studio-mac',
    'createdByActorType: human',
    'createdByName: someone',
    'sourceMachine: studio-mac',
    'sourceMachineFriendlyName: Apple Studio',
    'originMachine: studio-mac',
    'originMachineFriendlyName: Apple Studio',
    'targetMachineFriendlyName: ""',
    'previousMachine: linux-box',
    'openedFrom: mcp',
    'sourceContext: ticket-123',
    'archivedAt: ""',
    'trashedAt: ""',
    'trashMachine: ""',
    'trashExpiresAt: ""',
    'restoredAt: ""',
    'movedAt: "2026-06-29T09:00:00Z"',
    '---',
    trickyBody,
  ].join('\n');
  await writeFile(join(dir, `${fullId}.md`), fullV1, 'utf8');

  // (b) Old-schema file — the real-store forensics case: dozens of files WITHOUT
  // sourceMachine (and most provenance keys), plus legacy `tags`.
  const oldId = uuidFor(141);
  const oldSchema = [
    '---',
    `id: ${oldId}`,
    'title: Old Schema Note',
    'tags: [voice]',
    'status: active',
    'createdAt: 2026-06-22T09:43:00Z',
    'updatedAt: 2026-06-22T09:43:00Z',
    'author: someone',
    'agent: open-notes-app',
    'machine: studio-mac',
    'customUnknownKey: keep-me-logged',
    '---',
    'old body\n',
  ].join('\n');
  await writeFile(join(dir, `${oldId}.md`), oldSchema, 'utf8');

  // (c) Already-v2 file. (d) Bare markdown without frontmatter.
  const v2Id = uuidFor(142);
  await saveNote({ id: v2Id, title: 'Already V2', body: 'v2 body\n' }, root);
  const bareId = uuidFor(143);
  await writeFile(join(dir, `${bareId}.md`), '# Bare note\n\nno frontmatter\n', 'utf8');

  // Dry run mutates nothing.
  const dry = await migrateStoreToV2(root, { dryRun: true });
  assert.equal(dry.migrated, 2);
  assert.equal(dry.alreadyV2, 1);
  assert.equal(dry.skipped, 1);
  assert.equal(await readFile(join(dir, `${fullId}.md`), 'utf8'), fullV1);

  const run = await migrateStoreToV2(root);
  assert.equal(run.scanned, 4);
  assert.equal(run.migrated, 2);
  assert.equal(run.alreadyV2, 1);
  assert.equal(run.skipped, 1, 'bare files are left untouched (readable as-is)');
  // Dropped v1 keys are logged with counts.
  assert.equal(run.droppedKeys.sourceMachine, 1);
  assert.equal(run.droppedKeys.movedAt, 1);
  assert.equal(run.droppedKeys.customUnknownKey, 1, 'unknown keys are dropped AND logged');

  // Migrated file: v2 keys, rev 1, derived machineFriendlyName, body byte-for-byte.
  const migrated = await readFile(join(dir, `${fullId}.md`), 'utf8');
  assert.match(migrated, /\nrev: 1\n/);
  assert.match(migrated, /\nmachineFriendlyName: Apple Studio\n/);
  assert.ok(migrated.endsWith(`---\n${trickyBody}`), 'body preserved byte-for-byte');
  assert.ok(!migrated.includes('previousMachine:'));
  assert.ok(!migrated.includes('openedFrom:'));
  const reparsed = parseNote(migrated, fullId);
  assert.equal(reparsed.title, 'Full: v1 note');
  assert.deepEqual(reparsed.labels, ['alpha', 'beta']);
  assert.equal(reparsed.updatedAt, '2026-06-30T09:00:00Z', 'migration does not touch updatedAt');

  // Old-schema file: legacy tags fold into labels, unknown keys dropped.
  const migratedOld = await readFile(join(dir, `${oldId}.md`), 'utf8');
  assert.match(migratedOld, /\nlabels: \[voice\]\n/);
  assert.match(migratedOld, /\nrev: 1\n/);
  assert.ok(!migratedOld.includes('customUnknownKey'));
  assert.equal(parseNote(migratedOld, oldId).agent, 'open-notes-app', 'legacy agent value preserved verbatim');
  // Keys absent in the v1 source are emitted with the serializer's own
  // deterministic defaults, so a migrated file carries the same key set a
  // sync replica writes on another machine (missing keys were permanent
  // cosmetic cross-device diffs — P3 integrate finding). Non-deterministic
  // keys are never fabricated.
  for (const line of [
    'folder: ""', 'contentFormat: markdown', 'titleLocked: true',
    'titleSource: manual', 'titleContentFingerprint: ""',
    'machineFriendlyName: ""', 'createdByActorType: ""', 'createdByName: ""',
    'archivedAt: ""', 'trashedAt: ""', 'trashExpiresAt: ""', 'restoredAt: ""',
  ]) {
    assert.ok(migratedOld.includes(`\n${line}\n`), `migrated old-schema file carries default: ${line}`);
  }
  // A replica writing the same note serializes the identical frontmatter:
  // migrated origin file == serializeNote of its parsed form, byte for byte.
  assert.equal(serializeNote(parseNote(migratedOld, oldId)), migratedOld,
    'migrated file is byte-identical to a replica serialization');

  // Backup-first: originals live under <root>/backup-frontmatter-v1, byte-identical.
  assert.equal(await readFile(join(root, 'backup-frontmatter-v1', `${fullId}.md`), 'utf8'), fullV1);
  assert.equal(await readFile(join(root, 'backup-frontmatter-v1', `${oldId}.md`), 'utf8'), oldSchema);

  // Idempotent: a second run changes nothing and keeps the original backups.
  const again = await migrateStoreToV2(root);
  assert.equal(again.migrated, 0);
  assert.equal(again.alreadyV2, 3);
  assert.equal(again.skipped, 1);
  assert.equal(await readFile(join(dir, `${fullId}.md`), 'utf8'), migrated);
  assert.equal(await readFile(join(root, 'backup-frontmatter-v1', `${fullId}.md`), 'utf8'), fullV1);

  // The store still loads every note (backup dir is outside notes/).
  const notes = await loadNotes(root);
  assert.equal(notes.length, 4);

  // Single-document migration API: v2 text is reported as already migrated.
  assert.equal(migrateNoteTextToV2(migrated).version, 'v2');
  assert.equal(migrateNoteTextToV2(migrated).changed, false);
});

test.skip('legacy local frontmatter CLI migration was removed from the canonical client', async (t) => {
  const root = await tempRoot(t);
  const dir = join(root, 'notes');
  await mkdir(dir, { recursive: true });
  const id = uuidFor(150);
  const v1 = [
    '---',
    `id: ${id}`,
    'title: CLI Migrate Note',
    'labels: []',
    'status: active',
    'createdAt: 2026-06-22T09:00:00Z',
    'updatedAt: 2026-06-22T09:00:00Z',
    'author: someone',
    'agent: notes-app',
    'machine: linux-box',
    'sourceMachine: linux-box',
    'sourceMachineFriendlyName: Linux Box',
    '---',
    'cli body\n',
  ].join('\n');
  await writeFile(join(dir, `${id}.md`), v1, 'utf8');
  const env = { HASNA_NOTES_ROOT: root };

  // Without --to-v2 the command refuses (one-shot target must be explicit).
  const missing = await runNode(cliPath, ['migrate'], env);
  assert.notEqual(missing.code, 0);

  const dry = await runNode(cliPath, ['migrate', '--to-v2', '--dry-run', '--json'], env);
  assert.equal(dry.code, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).migrated, 1);
  assert.equal(await readFile(join(dir, `${id}.md`), 'utf8'), v1);

  const run = await runNode(cliPath, ['migrate', '--to-v2', '--json'], env);
  assert.equal(run.code, 0, run.stderr);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.migrated, 1);
  assert.equal(summary.droppedKeys.sourceMachine, 1);
  const migrated = await readFile(join(dir, `${id}.md`), 'utf8');
  assert.match(migrated, /\nrev: 1\n/);
  assert.match(migrated, /\nmachineFriendlyName: Linux Box\n/);

  // Alias + idempotency: migrate-frontmatter reruns cleanly with nothing to do.
  const alias = await runNode(cliPath, ['migrate-frontmatter', '--json'], env);
  assert.equal(alias.code, 0, alias.stderr);
  assert.equal(JSON.parse(alias.stdout).migrated, 0);
  assert.equal(JSON.parse(alias.stdout).alreadyV2, 1);
});

test('title generation is capped to four words for heuristic and sidecar paths', async (t) => {
  assert.equal(contentFingerprint('hello world'), '779a65e7023cd2e7');

  const heuristic = await generateTitle('recording transcript about quarterly planning renewal milestones and board review');
  assert.ok(heuristic.title.split(/\s+/).length <= 4);
  const markdownHeuristic = await generateTitle('## **Quarterly** [renewal](https://example.com) planning milestones');
  assert.equal(markdownHeuristic.title, 'Quarterly Renewal Planning Milestones');

  const seen = [];
  const fake = await openFakeTitleServer('This Is A Much Too Long Generated Title.', seen);
  t.after(fake.close);
  const sidecar = await generateTitle('# Raw **Markdown** [Link](https://example.com)', { sidecar: fake.url });
  assert.equal(sidecar.provider, 'sidecar');
  assert.equal(sidecar.title, 'This Is A Much');
  assert.equal(seen[0].text, 'Raw Markdown Link');
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`authenticated title sidecar rejects ${status} without forwarding token or note body`, async () => {
    for (const destination of [
      'https://other.example.test/title',
      'http://other.example.test/title',
      'https://sidecar.example.test/same-origin-title',
    ]) {
      const sourceRequests = [];
      const destinationRequests = [];
      const token = ['sidecar', 'fixture', 'not-real'].join('-');
      const fetchImpl = async (url, options) => {
        sourceRequests.push({ url, options });
        if (options.redirect === 'error') throw new TypeError(`redirect ${status} blocked`);
        destinationRequests.push({
          url: destination,
          method: [301, 302, 303].includes(status) ? 'GET' : options.method,
          headers: options.headers,
          body: [301, 302, 303].includes(status) ? undefined : options.body,
        });
        return new Response('{"title":"redirected"}', { status: 200 });
      };
      await assert.rejects(generateTitle('private note body', {
        sidecar: 'https://sidecar.example.test', sidecarToken: token, fetchImpl,
      }), /redirect/);
      assert.equal(sourceRequests.length, 1);
      assert.equal(sourceRequests[0].options.redirect, 'error');
      assert.equal(sourceRequests[0].options.headers['X-Hasna-Notes-Token'], token);
      assert.equal(destinationRequests.length, 0);
    }
  });
}

test.skip('legacy local CLI CRUD surface was replaced by the authenticated HTTPS client', async (t) => {
  const root = await tempRoot(t);
  const env = { HASNA_NOTES_ROOT: root, HASNA_NOTES_MACHINE: 'studio-mac' };
  const created = await runNode(cliPath, [
    'create', '--title', 'CLI Note', '--body', 'body text', '--label', 'cli', '--json',
  ], env);
  assert.equal(created.code, 0, created.stderr);
  const note = JSON.parse(created.stdout);
  assert.equal(note.title, 'CLI Note');
  assert.deepEqual(note.labels, ['cli']);
  assert.equal(note.contentFormat, 'markdown');
  // Default attribution = the stable configured machine identity (never a
  // cosmetic display name).
  assert.equal(note.machine, 'studio-mac');

  const page = await runNode(cliPath, ['list', '--json', '--limit', '1'], env);
  assert.equal(page.code, 0, page.stderr);
  const parsed = JSON.parse(page.stdout);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.items[0].id, note.id);

  const assigned = await runNode(cliPath, ['labels', 'assign', note.id, 'extra', '--json'], env);
  assert.equal(assigned.code, 0, assigned.stderr);
  assert.deepEqual(JSON.parse(assigned.stdout).labels, ['cli', 'extra']);

  const moved = await runNode(cliPath, ['move', note.id, 'laptop', '--json'], env);
  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(JSON.parse(moved.stdout).machine, 'laptop');

  // The machine-manifest surface is gone: `notes machines` is an unknown command.
  const machines = await runNode(cliPath, ['machines', 'details', 'laptop', '--json'], env);
  assert.equal(machines.code, 1);
  assert.match(machines.stderr, /unknown_command/);

  const render = await runNode(cliPath, ['markdown', 'render', '--text', '# Hi <script>x</script>', '--json'], env);
  assert.equal(render.code, 0, render.stderr);
  assert.equal(JSON.parse(render.stdout).html, '<h1>Hi &lt;script&gt;x&lt;/script&gt;</h1>');

  const command = await runNode(cliPath, [
    'markdown', 'apply-command', 'bold', '--text', 'hello', '--selection-start', '0', '--selection-end', '5', '--json',
  ], env);
  assert.equal(command.code, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).markdown, '**hello**');

  const agentTools = await runNode(cliPath, ['agent', 'tools', '--json'], env);
  assert.equal(agentTools.code, 0, agentTools.stderr);
  assert.ok(JSON.parse(agentTools.stdout).tools.some(tool => tool.name === 'consolidate_notes'));

  const agentSummary = await runNode(cliPath, ['agent', 'summarize', 'notes', '--json'], env);
  assert.equal(agentSummary.code, 0, agentSummary.stderr);
  assert.match(JSON.parse(agentSummary.stdout).text, /Summary of/);
  assert.equal(JSON.parse(agentSummary.stdout).sources.length, 1);

  const agentInfo = await runNode(cliPath, ['agent', 'info', note.id, '--json'], env);
  assert.equal(agentInfo.code, 0, agentInfo.stderr);
  assert.equal(JSON.parse(agentInfo.stdout).toolCalls[0].name, 'note_info');

  const agentLabel = await runNode(cliPath, ['agent', 'label', note.id, 'agent-label', '--json'], env);
  assert.equal(agentLabel.code, 0, agentLabel.stderr);
  assert.equal(JSON.parse(agentLabel.stdout).toolCalls[0].name, 'label_note');
  assert.ok((await getNote(note.id, root)).labels.includes('agent-label'));

  const agentUnlabelDryRun = await runNode(cliPath, ['agent', 'unlabel', note.id, 'agent-label', '--dry-run', '--json'], env);
  assert.equal(agentUnlabelDryRun.code, 0, agentUnlabelDryRun.stderr);
  assert.equal(JSON.parse(agentUnlabelDryRun.stdout).toolCalls[0].name, 'unlabel_note');
  assert.ok((await getNote(note.id, root)).labels.includes('agent-label'));

  const agentUpdatePreview = await runNode(cliPath, ['agent', 'update', note.id, 'body:', 'Agent replacement body', '--json'], env);
  assert.equal(agentUpdatePreview.code, 0, agentUpdatePreview.stderr);
  assert.equal(JSON.parse(agentUpdatePreview.stdout).status, 'awaiting_confirmation');
  assert.doesNotMatch((await getNote(note.id, root)).body, /Agent replacement body/);

  const agentUpdateConfirmed = await runNode(cliPath, ['agent', 'update', note.id, 'body:', 'Agent replacement body', '--yes', '--json'], env);
  assert.equal(agentUpdateConfirmed.code, 0, agentUpdateConfirmed.stderr);
  assert.equal(JSON.parse(agentUpdateConfirmed.stdout).status, 'complete');
  assert.match((await getNote(note.id, root)).body, /Agent replacement body/);

  const agentPreview = await runNode(cliPath, ['agent', 'consolidate', 'notes', '--json'], env);
  assert.equal(agentPreview.code, 0, agentPreview.stderr);
  assert.equal(JSON.parse(agentPreview.stdout).status, 'awaiting_confirmation');

  const agentConsolidated = await runNode(cliPath, ['agent', 'consolidate', 'notes', '--yes', '--actor-name', 'CLI Agent', '--json'], env);
  assert.equal(agentConsolidated.code, 0, agentConsolidated.stderr);
  const consolidatedResult = JSON.parse(agentConsolidated.stdout);
  assert.equal(consolidatedResult.status, 'complete');
  const consolidatedNote = (await loadNotes(root)).find(item => item.title === 'Consolidated Notes');
  assert.equal(consolidatedNote.createdByName, 'CLI Agent');

  const trashPreview = await runNode(cliPath, ['trash', consolidatedNote.id, '--json'], env);
  assert.equal(trashPreview.code, 0, trashPreview.stderr);
  assert.equal(JSON.parse(trashPreview.stdout).requiresConfirmation, true);
  assert.equal((await getNote(consolidatedNote.id, root)).status, 'active');

  const trashedViaTrash = await runNode(cliPath, ['trash', consolidatedNote.id, '--force', '--json'], env);
  assert.equal(trashedViaTrash.code, 0, trashedViaTrash.stderr);
  assert.equal(JSON.parse(trashedViaTrash.stdout).status, 'trash');
  const beforeRepeatTrash = await getNote(consolidatedNote.id, root);
  const repeatedTrash = await runNode(cliPath, ['trash', consolidatedNote.id, '--json'], env);
  assert.equal(repeatedTrash.code, 0, repeatedTrash.stderr);
  assert.equal(JSON.parse(repeatedTrash.stdout).status, 'trash');
  assert.equal((await getNote(consolidatedNote.id, root)).trashedAt, beforeRepeatTrash.trashedAt);

  const archived = await runNode(cliPath, ['archive', note.id, '--json'], env);
  assert.equal(archived.code, 0, archived.stderr);
  assert.equal(JSON.parse(archived.stdout).status, 'archived');

  // Plain (non-JSON) non-interactive refusal: nothing written AND a detectable
  // nonzero exit, so scripts can tell the destructive op did not happen.
  const nonInteractiveDelete = await runNode(cliPath, ['delete', note.id], env);
  assert.equal(nonInteractiveDelete.code, 2, nonInteractiveDelete.stderr);
  assert.match(nonInteractiveDelete.stdout, /Re-run with --yes or --force/);
  assert.equal((await getNote(note.id, root)).status, 'archived');

  const deletePreview = await runNode(cliPath, ['delete', note.id, '--json'], env);
  assert.equal(deletePreview.code, 0, deletePreview.stderr);
  assert.equal(JSON.parse(deletePreview.stdout).requiresConfirmation, true);
  assert.equal((await getNote(note.id, root)).status, 'archived');

  const deleted = await runNode(cliPath, ['delete', note.id, '--yes', '--json'], env);
  assert.equal(deleted.code, 0, deleted.stderr);
  assert.equal(JSON.parse(deleted.stdout).status, 'trash');

  const deleteAgainPreview = await runNode(cliPath, ['delete', note.id, '--json'], env);
  assert.equal(deleteAgainPreview.code, 0, deleteAgainPreview.stderr);
  assert.equal(JSON.parse(deleteAgainPreview.stdout).requiresConfirmation, true);
  assert.ok(await getNote(note.id, root));

  const purgePreview = await runNode(cliPath, ['purge', note.id, '--json'], env);
  assert.equal(purgePreview.code, 0, purgePreview.stderr);
  assert.equal(JSON.parse(purgePreview.stdout).requiresConfirmation, true);
  assert.ok(await getNote(note.id, root));

  // Plain purge refusal (no --yes, no --json, non-TTY): file kept, exit code 2.
  const purgeRefused = await runNode(cliPath, ['purge', note.id], env);
  assert.equal(purgeRefused.code, 2, purgeRefused.stderr);
  assert.ok(await getNote(note.id, root));

  const purged = await runNode(cliPath, ['purge', note.id, '--force', '--json'], env);
  assert.equal(purged.code, 0, purged.stderr);
  assert.equal(JSON.parse(purged.stdout).permanent, true);
  assert.equal(await getNote(note.id, root), null);

  const expiredId = uuidFor(260);
  await saveNote({
    id: expiredId,
    title: 'Expired CLI Trash',
    body: 'expired',
    status: 'trash',
    machine: 'studio-mac',
    trashedAt: '2025-01-01T00:00:00.000Z',
    trashExpiresAt: '2025-02-01T00:00:00.000Z',
  }, root);
  const cleanupPreview = await runNode(cliPath, ['cleanup-trash', '--json'], env);
  assert.equal(cleanupPreview.code, 0, cleanupPreview.stderr);
  const cleanupPreviewBody = JSON.parse(cleanupPreview.stdout);
  assert.equal(cleanupPreviewBody.requiresConfirmation, true);
  assert.equal(cleanupPreviewBody.preview.count, 1);
  assert.ok(await getNote(expiredId, root));

  const cleanupConfirmed = await runNode(cliPath, ['cleanup-trash', '--yes', '--json'], env);
  assert.equal(cleanupConfirmed.code, 0, cleanupConfirmed.stderr);
  assert.equal(JSON.parse(cleanupConfirmed.stdout).count, 1);
  assert.equal(await getNote(expiredId, root), null);
});

class McpClient {
  // framing: 'headers' (legacy LSP-style Content-Length) or 'ndjson' (the MCP
  // spec's stdio transport — what standard clients actually speak).
  constructor(env, framing = 'headers') {
    this.framing = framing;
    this.child = spawn(process.execPath, [mcpPath], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.child.stdout.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  close() {
    this.child.kill();
  }

  send(id, method, params) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
    if (this.framing === 'ndjson') {
      this.child.stdin.write(body);
      this.child.stdin.write('\n');
    } else {
      this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      this.child.stdin.write(body);
    }
    return new Promise(resolve => { this.waiters.push(resolve); this.drain(); });
  }

  drain() {
    while (this.waiters.length) {
      if (this.framing === 'ndjson') {
        const nl = this.buffer.indexOf('\n');
        if (nl < 0) return;
        const line = this.buffer.subarray(0, nl).toString('utf8').trim();
        this.buffer = this.buffer.subarray(nl + 1);
        if (!line) continue;
        this.waiters.shift()(JSON.parse(line));
        continue;
      }
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const len = Number(/content-length:\s*(\d+)/i.exec(header)?.[1] || 0);
      const bodyStart = headerEnd + 4;
      if (!len || this.buffer.length < bodyStart + len) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + len).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + len);
      this.waiters.shift()(JSON.parse(body));
    }
  }
}

function parseToolText(response) {
  return JSON.parse(response.result.content[0].text);
}

test.skip('legacy local MCP CRUD framing is replaced by remote-only MCP contract tests', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root }, 'ndjson');
  t.after(() => client.close());

  // A standard MCP client's first message is newline-delimited JSON — the server
  // must answer in the same framing (this used to time out with no response).
  const init = await client.send(1, 'initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.result.serverInfo.name, 'notes');

  const listTools = await client.send(2, 'tools/list', {});
  assert.ok(listTools.result.tools.some(tool => tool.name === 'notes_create'));

  const created = await client.send(3, 'tools/call', {
    name: 'notes_create',
    arguments: { title: 'NDJSON Note', body: 'ndjson body', targetMachine: 'studio-mac' },
  });
  assert.equal(parseToolText(created).title, 'NDJSON Note');
  const events = await createdEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.noteId, parseToolText(created).id);
  assert.equal(JSON.stringify(events).includes('NDJSON Note'), false);
  assert.equal(JSON.stringify(events).includes('ndjson body'), false);

  const listed = await client.send(4, 'tools/call', { name: 'notes_list', arguments: {} });
  assert.equal(parseToolText(listed).items.length, 1);
});

test.skip('legacy local MCP tool surface was removed from the canonical client', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root });
  t.after(() => client.close());

  const init = await client.send(1, 'initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.result.serverInfo.name, 'notes');

  const listTools = await client.send(2, 'tools/list', {});
  assert.ok(listTools.result.tools.some(tool => tool.name === 'labels_assign'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'notes_move_to_machine'));
  // The machine-manifest tools are gone with the machine surface (0.2.0).
  assert.equal(listTools.result.tools.some(tool => tool.name === 'machines_list'), false);
  assert.equal(listTools.result.tools.some(tool => tool.name === 'machines_details'), false);
  assert.ok(listTools.result.tools.some(tool => tool.name === 'markdown_render'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'markdown_apply_command'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'agent_run'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'agent_goal'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'agent_tool_call'));

  const created = await client.send(3, 'tools/call', {
    name: 'notes_create',
    arguments: { title: 'MCP Note', body: 'mcp body', labels: ['mcp'], actorType: 'agent', actorName: 'MCP Agent', targetMachine: 'studio-mac' },
  });
  const note = parseToolText(created);
  assert.equal(note.title, 'MCP Note');
  assert.equal(note.createdByActorType, 'agent');
  assert.equal(note.contentFormat, 'markdown');

  const labels = await client.send(4, 'tools/call', { name: 'labels_list', arguments: {} });
  assert.deepEqual(parseToolText(labels).labels, ['mcp']);

  const title = await client.send(5, 'tools/call', {
    name: 'title_generate',
    arguments: { id: note.id, apply: true, force: true },
  });
  const generated = parseToolText(title);
  assert.equal(generated.applied, true);
  assert.ok(generated.title.split(/\s+/).length <= 4);

  const moved = await client.send(6, 'tools/call', {
    name: 'notes_move_to_machine',
    arguments: { id: note.id, machine: 'laptop' },
  });
  assert.equal(parseToolText(moved).machine, 'laptop');

  // machines_details is gone with the machine surface: the tool call must fail.
  const machine = await client.send(7, 'tools/call', {
    name: 'machines_details',
    arguments: { id: 'laptop' },
  });
  assert.equal(machine.error, undefined);
  assert.equal(machine.result.isError, true);

  const rendered = await client.send(8, 'tools/call', {
    name: 'markdown_render',
    arguments: { markdown: '## Safe <img src=x onerror=1>' },
  });
  assert.equal(parseToolText(rendered).html, '<h2>Safe &lt;img src=x onerror=1&gt;</h2>');

  const applied = await client.send(9, 'tools/call', {
    name: 'markdown_apply_command',
    arguments: { markdown: 'todo', commandId: 'checklist', selectionStart: 0, selectionEnd: 4 },
  });
  assert.equal(parseToolText(applied).markdown, '- [ ] todo');

  const plain = await client.send(10, 'tools/call', {
    name: 'markdown_plain_text',
    arguments: { markdown: '# Raw **Markdown**' },
  });
  assert.equal(parseToolText(plain).text, 'Raw Markdown');

  const agentTools = await client.send(11, 'tools/call', {
    name: 'agent_tools',
    arguments: {},
  });
  assert.ok(parseToolText(agentTools).tools.some(tool => tool.name === 'summarize_notes'));

  const agentRun = await client.send(12, 'tools/call', {
    name: 'agent_run',
    arguments: { prompt: 'summarize notes' },
  });
  assert.match(parseToolText(agentRun).text, /Summary of/);
  assert.equal(parseToolText(agentRun).sources.length, 1);

  const agentGoal = await client.send(16, 'tools/call', {
    name: 'agent_goal',
    arguments: { objective: 'summarize notes', maxSteps: 2 },
  });
  assert.equal(parseToolText(agentGoal).mode, 'goal');
  assert.equal(parseToolText(agentGoal).goal.status, 'done');

  const agentAppendPreview = await client.send(13, 'tools/call', {
    name: 'agent_tool_call',
    arguments: { name: 'append_note', input: { id: note.id, text: 'agent append' } },
  });
  assert.equal(parseToolText(agentAppendPreview).requiresConfirmation, true);

  const missingRender = await client.send(14, 'tools/call', {
    name: 'markdown_render',
    arguments: { id: uuidFor(404) },
  });
  assert.equal(missingRender.result.isError, true);
  assert.equal(parseToolText(missingRender).error, 'note_not_found');

  const missingPlain = await client.send(15, 'tools/call', {
    name: 'markdown_plain_text',
    arguments: { id: uuidFor(405) },
  });
  assert.equal(missingPlain.result.isError, true);
  assert.equal(parseToolText(missingPlain).error, 'note_not_found');

  const trashCreated = await client.send(16, 'tools/call', {
    name: 'notes_create',
    arguments: { title: 'MCP Trash Target', body: 'trash body', targetMachine: 'studio-mac' },
  });
  const trashTarget = parseToolText(trashCreated);

  const trashPreview = await client.send(17, 'tools/call', {
    name: 'notes_trash',
    arguments: { id: trashTarget.id },
  });
  assert.equal(parseToolText(trashPreview).requiresConfirmation, true);
  assert.equal((await getNote(trashTarget.id, root)).status, 'active');

  const trashConfirmed = await client.send(18, 'tools/call', {
    name: 'notes_trash',
    arguments: { id: trashTarget.id, confirm: true },
  });
  assert.equal(parseToolText(trashConfirmed).status, 'trash');

  const deletePreview = await client.send(19, 'tools/call', {
    name: 'notes_delete',
    arguments: { id: note.id },
  });
  assert.equal(parseToolText(deletePreview).requiresConfirmation, true);
  assert.equal((await getNote(note.id, root)).status, 'active');

  const trashed = await client.send(20, 'tools/call', {
    name: 'notes_delete',
    arguments: { id: note.id, confirm: true },
  });
  assert.equal(parseToolText(trashed).status, 'trash');

  const deleteAgainPreview = await client.send(21, 'tools/call', {
    name: 'notes_delete',
    arguments: { id: note.id },
  });
  assert.equal(parseToolText(deleteAgainPreview).requiresConfirmation, true);
  assert.ok(await getNote(note.id, root));

  const purgePreview = await client.send(22, 'tools/call', {
    name: 'notes_purge',
    arguments: { id: note.id },
  });
  assert.equal(parseToolText(purgePreview).requiresConfirmation, true);
  assert.ok(await getNote(note.id, root));

  const purged = await client.send(23, 'tools/call', {
    name: 'notes_purge',
    arguments: { id: note.id, confirm: true },
  });
  assert.equal(parseToolText(purged).permanent, true);
  assert.equal(await getNote(note.id, root), null);

  const expiredId = uuidFor(261);
  await saveNote({
    id: expiredId,
    title: 'Expired MCP Trash',
    body: 'expired',
    status: 'trash',
    machine: 'studio-mac',
    trashedAt: '2025-01-01T00:00:00.000Z',
    trashExpiresAt: '2025-02-01T00:00:00.000Z',
  }, root);
  const cleanupPreview = await client.send(24, 'tools/call', {
    name: 'trash_cleanup',
    arguments: {},
  });
  assert.equal(parseToolText(cleanupPreview).requiresConfirmation, true);
  assert.equal(parseToolText(cleanupPreview).preview.count, 1);
  assert.ok(await getNote(expiredId, root));

  const cleanupConfirmed = await client.send(25, 'tools/call', {
    name: 'trash_cleanup',
    arguments: { confirm: true },
  });
  assert.equal(parseToolText(cleanupConfirmed).count, 1);
  assert.equal(await getNote(expiredId, root), null);
});

test('notes-lib sidecar title call carries no retired compat header line', async () => {
  // P2 follow-up from PR 270 review: the retired-name (X-PersonalNotes-Token era)
  // compat surface in the sidecar title call was scheduled for removal "next release".
  // The old name is already gone (PR 273 rename); the leftover duplicate legacy line
  // in tools/notes-lib.mjs must not survive. Source-level guard: the duplicate line is
  // behaviorally inert (same header, same value), so only its absence is assertable.
  const lib = await readFile(join(repoRoot, 'tools', 'notes-lib.mjs'), 'utf8');
  assert.doesNotMatch(lib, /legacy header; removed next release/);
  assert.match(lib, /headers\['X-Hasna-Notes-Token'\] = token;/);
});

test('machineIdentity: env override, configured identity, stable short-hostname fallback', async (t) => {
  const prevMachine = process.env.HASNA_NOTES_MACHINE;
  const prevConfig = process.env.HASNA_NOTES_CONFIG;
  t.after(() => {
    if (prevMachine == null) delete process.env.HASNA_NOTES_MACHINE;
    else process.env.HASNA_NOTES_MACHINE = prevMachine;
    if (prevConfig == null) delete process.env.HASNA_NOTES_CONFIG;
    else process.env.HASNA_NOTES_CONFIG = prevConfig;
  });

  process.env.HASNA_NOTES_MACHINE = '  studio-mac  ';
  assert.equal(machineIdentity(), 'studio-mac');

  delete process.env.HASNA_NOTES_MACHINE;
  const root = await tempRoot(t);
  const configPath = join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({ apiKey: 'pn_test_key', machine: 'linux-box' }) + '\n');
  process.env.HASNA_NOTES_CONFIG = configPath;
  assert.equal(machineIdentity(), 'linux-box');

  // Unconfigured: the stable short hostname (pre-first-dot) — never empty,
  // never a cosmetic display name with dots/domains.
  await writeFile(configPath, JSON.stringify({ apiKey: 'pn_test_key' }) + '\n');
  const fallback = machineIdentity();
  assert.ok(fallback.length > 0);
  assert.ok(!fallback.includes('.'));
});

test('label normalization trims values and deduplicates case-insensitively while preserving first spelling', () => {
  assert.deepEqual(
    normalizeLabels([' Work ', 'work', '', null, 'Research', 'research', 42]),
    ['Work', 'Research', '42'],
  );
  assert.deepEqual(normalizeLabels(undefined), []);
});

test('plain-text markdown removes markup without losing code content', () => {
  const markdown = [
    '# Heading',
    '<script>alert("ignored")</script>',
    'before `inline` after',
    '```js',
    'const value = "kept";',
    '```',
    '[label](https://example.test)',
  ].join('\n');

  assert.equal(
    markdownPlainText(markdown),
    'Heading before inline after const value = "kept"; label',
  );
});

test('markdown-safe text escapes punctuation that could create formatting or links', () => {
  assert.equal(
    markdownSafeText('a [link](https://example.test) + *bold* # heading'),
    'a \\[link\\]\\(https://example\\.test\\) \\+ \\*bold\\* \\# heading',
  );
});
