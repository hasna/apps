import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  archiveNote,
  assignLabel,
  contentFingerprint,
  deleteLabelEverywhere,
  deleteNote,
  generateTitle,
  getMachineDetails,
  getNote,
  listMachineDetails,
  listNotes,
  loadLabelList,
  parseMachineManifestJSON,
  loadNotes,
  loadSettings,
  markdownPlainText,
  markdownSafeText,
  moveNoteToMachine,
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

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli', 'hasna-notes.mjs');
const mcpPath = join(repoRoot, 'mcp', 'hasna-notes-mcp.mjs');

function uuidFor(i) {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'hasna-notes-test-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  syncFromClassName(value) {
    this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  syncToClassName() {
    this.element._className = [...this.values].join(' ');
  }

  add(...names) {
    names.filter(Boolean).forEach(name => this.values.add(name));
    this.syncToClassName();
  }

  remove(...names) {
    names.forEach(name => this.values.delete(name));
    this.syncToClassName();
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.values.has(name) : !!force;
    if (shouldAdd) this.values.add(name);
    else this.values.delete(name);
    this.syncToClassName();
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.value = '';
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.textContent = '';
    this.title = '';
    this.type = '';
    this.draggable = false;
    this.parentNode = null;
    this._className = '';
    this.classList = new FakeClassList(this);
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || '');
    this.classList.syncFromClassName(this._className);
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter(item => item !== child);
    child.parentNode = null;
    return child;
  }

  replaceWith(node) {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) {
      node.parentNode = this.parentNode;
      this.parentNode.children.splice(index, 1, node);
      this.parentNode = null;
    }
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn));
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (const fn of this.listeners.get(event.type) || []) fn(event);
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
    });
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  select() {}
  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

function createFakeDocument() {
  const elements = new Map();
  const ensure = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement('div'));
    return elements.get(id);
  };
  const document = {
    // 'complete' so app.js runs init() (bind + first render) exactly like the real app —
    // static controls (sidebar nav, header buttons, editor fields) become clickable.
    readyState: 'complete',
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    elements,
    addEventListener() {},
    removeEventListener() {},
    createElement: tag => new FakeElement(tag),
    getElementById: ensure,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    execCommand() { return true; },
  };
  ensure('window');
  return document;
}

function loadWebAppWithFakeDOM(app, extraWindow = {}, extraContext = {}) {
  const listeners = new Map();
  const windowTarget = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn));
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
    confirm() { return false; },
    prompt() { return ''; },
    ...extraWindow,
  };
  const document = createFakeDocument();
  const context = {
    window: windowTarget,
    document,
    navigator: { clipboard: { writeText: async () => undefined } },
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    TextEncoder,
    TextDecoder,
    fetch: windowTarget.fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    ...extraContext,
  };
  vm.runInNewContext(app, context, { filename: 'web/app.js' });
  return { windowTarget, document };
}

// Fake sidecar /chat response: newline-delimited stream events, one chunk.
function ndjsonResponse(events) {
  const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n');
  let done = false;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read: async () => (done ? { done: true, value: undefined } : (done = true, { done: false, value: bytes })),
        };
      },
    },
  };
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

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startSidecar(t, env = {}) {
  const port = await freePort();
  const token = env.HASNA_NOTES_SIDECAR_TOKEN || 'test-sidecar-token';
  const child = spawn(process.execPath, [join(repoRoot, 'ai-sidecar', 'server.mjs')], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      PORT: String(port),
      OPENAI_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      HASNA_NOTES_SIDECAR_TOKEN: token,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', c => { stdout += c; });
  child.stderr.on('data', c => { stderr += c; });
  t.after(() => {
    if (!child.killed) child.kill('SIGTERM');
  });

  const health = async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    return res.json();
  };

  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode !== null) break;
    try {
      await health();
      return { port, child, health, token };
    } catch {
      await delay(100);
    }
  }
  throw new Error(`sidecar did not start on ${port}\nstdout=${stdout}\nstderr=${stderr}`);
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

test('web markdown bridge preserves literal transcript text and command escaping', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget } = loadWebAppWithFakeDOM(app);
  const literal = windowTarget.HasnaNotes.markdown.render(
    windowTarget.HasnaNotes.markdown.safeText('**urgent** [x](https://evil.example) `code`'),
  );
  assert.equal(literal, '<p>**urgent** [x](https://evil.example) `code`</p>');
  assert.doesNotMatch(literal, /<strong>|<a |<code>/);
  assert.doesNotMatch(windowTarget.HasnaNotes.markdown.render('[bad](//evil.example)'), /href="\/\//);
  assert.equal(
    windowTarget.HasnaNotes.markdown.applyCommand('a](https://evil)', {
      commandId: 'link',
      selectionStart: 0,
      selectionEnd: 16,
      url: '//evil.example',
    }).markdown,
    '[a\\]\\(https://evil\\)](https://)',
  );
});

test('voice transcript is committed verbatim without stray markdown backslashes', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget } = loadWebAppWithFakeDOM(app);
  const rec = windowTarget.HasnaNotes.recording;
  const md = windowTarget.HasnaNotes.markdown;

  // Spoken text full of ordinary punctuation that markdownSafeText would have escaped:
  // periods, hyphens, parens, exclamation, plus a multi-line dictation.
  const spoken = 'Meet at 3.5 p.m. - bring the well-being notes (important)!\nFollow up with finance.';

  const body = rec.transcriptBody(spoken);

  // No backslash is ever introduced into a plain transcript.
  assert.doesNotMatch(body, /\\/);
  // The text — including its newline — survives byte-for-byte (only trimmed/CRLF-normalized).
  assert.equal(body, spoken);

  // And it stays clean once rendered (regression guard: the editor/agent render path
  // must not surface the old "3\\.5 p\\.m\\." escaping artifacts).
  const rendered = md.render(body);
  assert.doesNotMatch(rendered, /\\/);
  assert.match(rendered, /3\.5 p\.m\. - bring the well-being notes \(important\)!/);

  // Document the precise regression: the markdown-escaper (still correct for typed
  // commands/links) WOULD have inserted backslashes — the transcript path must not use it.
  assert.match(md.safeText(spoken), /3\\\.5/);
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
    openedFrom: 'test-agent',
  });
  assert.equal(created.note.createdByActorType, 'agent');
  assert.equal(created.note.createdByName, 'Test Agent');
  assert.equal(created.note.openedFrom, 'test-agent');
  assert.deepEqual(created.note.labels, ['agent']);

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
});

test('agent label move and goal flows use shared safe tools', async (t) => {
  const root = await tempRoot(t);
  const note = await saveNote({
    id: uuidFor(225),
    title: 'Goal Source',
    body: 'Alpha goal source body.',
    labels: ['alpha'],
    machine: 'apple03',
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

  const movePreview = await runNotesAgent(`move ${note.id} to apple04`, { root });
  assert.equal(movePreview.status, 'awaiting_confirmation');
  assert.equal(movePreview.toolCalls[0].name, 'move_note');
  assert.equal((await getNote(note.id, root)).machine, 'apple03');

  const moveConfirmed = await runNotesAgent(`move ${note.id} to apple04`, { root, yes: true, confirmWrites: true });
  assert.equal(moveConfirmed.status, 'complete');
  assert.equal((await getNote(note.id, root)).machine, 'apple04');

  const goal = await runNotesGoal('summarize beta notes', { root, maxSteps: 3 });
  assert.equal(goal.mode, 'goal');
  assert.equal(goal.status, 'done');
  assert.equal(goal.goal.objective, 'summarize beta notes');
  assert.ok(goal.goal.steps.length >= 1);

  const slashGoal = await runNotesAgent('/goal summarize beta notes', { root, maxSteps: 2 });
  assert.equal(slashGoal.mode, 'goal');
  assert.equal(slashGoal.goal.status, 'done');
});

test('web chat streams sidecar events and applies approvals through the sidecar', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const approval = {
    id: 'approval-trash-1',
    toolCallId: 'tool-1',
    toolName: 'trash_note',
    input: { id: 'chat-1' },
    preview: { id: 'chat-1', title: 'Alpha Plan', fromStatus: 'active', toStatus: 'trash' },
  };
  const fetchCalls = [];
  const fetchStub = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).endsWith('/chat')) {
      return ndjsonResponse([
        { type: 'text-delta', text: 'Reviewing the note.' },
        { type: 'tool-call', toolCallId: 'tool-1', toolName: 'trash_note', input: { id: 'chat-1' } },
        { type: 'tool-result', toolCallId: 'tool-1', output: { requiresConfirmation: true, approval } },
        { type: 'confirmation', approval },
        { type: 'finish', text: 'Reviewing the note.', pendingConfirmations: [approval] },
      ]);
    }
    if (String(url).endsWith('/tool')) {
      return { ok: true, json: async () => ({ note: { id: 'chat-1', title: 'Alpha Plan', status: 'trash' } }) };
    }
    throw new Error(`unexpected sidecar url ${url}`);
  };
  const { windowTarget } = loadWebAppWithFakeDOM(app, {
    __AI__: { port: 4222, available: true },
    fetch: fetchStub,
    TextDecoder,
  });
  const events = [];
  for (const name of ['hasna:chat-state', 'hasna:chat-tool-call', 'hasna:chat-tool-result', 'hasna:chat-confirmation', 'hasna:chat-finish']) {
    windowTarget.addEventListener(name, event => events.push({ name, detail: event.detail }));
  }
  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    notes: [
      { id: 'chat-1', title: 'Alpha Plan', body: 'Alpha launch plan and budget.', labels: ['alpha'], status: 'active', machine: 'apple03', updatedAt: '2026-06-23T10:00:00Z', createdAt: '2026-06-23T09:00:00Z' },
    ],
    machines: [{ id: 'apple03' }],
  });

  const result = await windowTarget.HasnaNotes.chat.send('trash the alpha plan note');
  assert.equal(result.text, 'Reviewing the note.');
  assert.equal(result.pendingConfirmations.length, 1);
  assert.equal(windowTarget.HasnaNotes.chat.state().status, 'awaiting_confirmation');
  assert.ok(events.some(event => event.name === 'hasna:chat-tool-call' && event.detail.toolCall.name === 'trash_note'));
  assert.ok(events.some(event => event.name === 'hasna:chat-confirmation' && event.detail.approval.id === approval.id));

  const approved = await windowTarget.HasnaNotes.chat.approve(approval.id, true);
  assert.equal(approved.approved, true);
  assert.equal(approved.note.id, 'chat-1');
  const toolCall = fetchCalls.find(call => call.url.endsWith('/tool'));
  assert.ok(toolCall, 'approval must be applied via the sidecar /tool endpoint');
  assert.equal(JSON.parse(toolCall.init.body).confirm, true);
  assert.equal(windowTarget.HasnaNotes.chat.state().status, 'ready');
  assert.equal(windowTarget.HasnaNotes.chat.state().toolCalls[0].state, 'result');
  assert.equal(windowTarget.HasnaNotes.chat.state().pendingConfirmations.length, 0);
});

test('web chat is honest when the AI sidecar is unavailable — no fake local answers', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /sendLocalChat|sendLocalGoalChat/, 'fake local chat must stay deleted');
  const { windowTarget } = loadWebAppWithFakeDOM(app);
  const errors = [];
  windowTarget.addEventListener('hasna:chat-error', event => errors.push(event.detail));
  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    notes: [
      { id: 'chat-1', title: 'Alpha Plan', body: 'Alpha launch plan and budget.', labels: ['alpha'], status: 'active', machine: 'apple03', updatedAt: '2026-06-23T10:00:00Z', createdAt: '2026-06-23T09:00:00Z' },
    ],
    machines: [{ id: 'apple03' }],
  });

  await assert.rejects(() => windowTarget.HasnaNotes.chat.send('summarize alpha notes'), /AI unavailable/);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /AI unavailable/);
  const chatState = windowTarget.HasnaNotes.chat.state();
  assert.equal(chatState.status, 'error');
  assert.match(chatState.error, /AI unavailable/);
  assert.equal(chatState.messages.length, 0, 'no fabricated messages');
  assert.equal(chatState.toolCalls.length, 0, 'no fabricated tool calls');
});

test('web navigation: chat is a header button, labels manage in Settings, machines dropdown on top', async () => {
  const html = await readFile(join(repoRoot, 'web', 'index.html'), 'utf8');
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  // No app name and no chat/labels entries in the sidebar (vision 05007066).
  assert.doesNotMatch(html, /class="wordmark"|id="nav-chat"|id="nav-labels"/);
  // Machines are a compact dropdown at the TOP of the sidebar.
  assert.ok(html.indexOf('id="machines-dd-btn"') < html.indexOf('id="nav-home"'));
  assert.match(html, /id="machines-list"/);
  // Section order: Notes then Labels (collapsible), then Archive, then Trash.
  assert.ok(html.indexOf('id="sec-notes"') < html.indexOf('id="labels-section"'));
  assert.ok(html.indexOf('id="labels-section"') < html.indexOf('id="nav-archive"'));
  assert.ok(html.indexOf('id="nav-archive"') < html.indexOf('id="nav-trash"'));
  // Copy-note-as-Markdown + Chat relocate to header buttons next to minimize.
  assert.ok(html.indexOf('id="note-copy"') < html.indexOf('id="note-delete"'));
  assert.ok(html.indexOf('id="open-chat"') < html.indexOf('id="win-min"'));
  // The markdown UI is a selection popover + slash menu — explicitly NO toolbar.
  assert.match(html, /id="md-pop"/);
  assert.match(html, /id="slash-menu"/);
  assert.doesNotMatch(html, /id="md-toolbar"|class="toolbar"/);
  assert.match(html, /id="chat-page"/);
  // Labels MANAGEMENT page lives inside Settings; the sidebar keeps filter rows only.
  assert.match(html, /data-tab="labels"[^>]*id="labels-page-main"/);
  // Search is a Cmd+K popover, not a page or sidebar field.
  assert.match(html, /id="search-pop"/);
  assert.doesNotMatch(html, /id="search-input"/);
  assert.match(app, /metaKey \|\| e\.ctrlKey/);
  // Recording has exactly ONE surface per screen: the persistent pill exists and is
  // suppressed on Home, where the composer itself is the recording surface.
  assert.match(html, /id="rec-pill"/);
  assert.match(app, /pill\.hidden = !active \|\| onHomeComposer/);

  const { windowTarget } = loadWebAppWithFakeDOM(app);
  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    labels: ['empty'],
    notes: [
      { id: 'labels-1', title: 'Labelled', body: 'Body', labels: ['work'], status: 'active', machine: 'apple03', updatedAt: '2026-06-23T10:00:00Z', createdAt: '2026-06-23T09:00:00Z' },
    ],
    machines: [{ id: 'apple03' }],
  });

  const labelPairs = JSON.parse(JSON.stringify(windowTarget.HasnaNotes.labels.list().map(item => [item.name, item.count])));
  assert.deepEqual(labelPairs, [['empty', 0], ['work', 1]]);
  windowTarget.HasnaNotes.labels.create('later');
  assert.ok(windowTarget.HasnaNotes.labels.list().some(item => item.name === 'later' && item.count === 0));
  windowTarget.HasnaNotes.labels.rename('work', 'project');
  assert.ok(windowTarget.HasnaNotes.labels.list().some(item => item.name === 'project' && item.count === 1));
  windowTarget.HasnaNotes.labels.delete('project', true);
  assert.equal(windowTarget.HasnaNotes.labels.list().some(item => item.name === 'project'), false);
});

test('web note action bridge confirms trash and permanent purge', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget } = loadWebAppWithFakeDOM(app);
  const prompts = [];
  const events = [];
  let confirmResult = false;
  windowTarget.confirm = message => {
    prompts.push(message);
    return confirmResult;
  };
  windowTarget.addEventListener('hasna:note-trash', event => events.push({ name: 'trash', detail: event.detail }));
  windowTarget.addEventListener('hasna:note-purge', event => events.push({ name: 'purge', detail: event.detail }));

  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    notes: [{
      id: 'bridge-delete',
      title: 'Bridge Delete',
      body: 'Delete confirmation body',
      labels: [],
      status: 'active',
      machine: 'apple03',
      updatedAt: '2026-06-23T10:00:00Z',
      createdAt: '2026-06-23T09:00:00Z',
    }],
    machines: [{ id: 'apple03' }],
  });

  const cancelledTrash = windowTarget.HasnaNotes.notes.trash('bridge-delete');
  assert.equal(cancelledTrash, null);
  assert.match(prompts.at(-1), /^Move note to Trash\?/);
  assert.match(prompts.at(-1), /Bridge Delete/);
  assert.ok(windowTarget.HasnaNotes.view.state().visibleNoteIds.includes('bridge-delete'));
  assert.equal(events.length, 0);

  confirmResult = true;
  const trashed = windowTarget.HasnaNotes.notes.trash('bridge-delete');
  assert.equal(trashed.status, 'trash');
  assert.equal(events.at(-1).name, 'trash');
  windowTarget.HasnaNotes.notes.setStatusFilter('trash');
  assert.ok(windowTarget.HasnaNotes.view.state().visibleNoteIds.includes('bridge-delete'));

  confirmResult = false;
  const cancelledPurge = windowTarget.HasnaNotes.notes.purge('bridge-delete');
  assert.equal(cancelledPurge, null);
  assert.match(prompts.at(-1), /^Delete permanently\?/);
  assert.match(prompts.at(-1), /cannot be undone/);
  assert.ok(windowTarget.HasnaNotes.view.state().visibleNoteIds.includes('bridge-delete'));

  confirmResult = true;
  const purged = windowTarget.HasnaNotes.notes.purge('bridge-delete');
  assert.equal(purged.id, 'bridge-delete');
  assert.equal(purged.permanent, true);
  assert.equal(events.at(-1).name, 'purge');
  assert.equal(windowTarget.HasnaNotes.view.state().visibleNoteIds.includes('bridge-delete'), false);
});

test('web expired Trash cleanup is observable and confirmation-gated', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget } = loadWebAppWithFakeDOM(app);
  const cleanupReady = [];
  const purges = [];
  const prompts = [];
  let confirmResult = false;
  windowTarget.confirm = message => {
    prompts.push(message);
    return confirmResult;
  };
  windowTarget.addEventListener('hasna:trash-cleanup-ready', event => cleanupReady.push(event.detail));
  windowTarget.addEventListener('hasna:note-purge', event => purges.push(event.detail));

  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    notes: [{
      id: 'expired-trash',
      title: 'Expired Trash',
      body: 'Expired body',
      labels: [],
      status: 'trash',
      machine: 'apple03',
      trashedAt: '2025-01-01T00:00:00.000Z',
      trashExpiresAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
    }],
    machines: [{ id: 'apple03' }],
  });

  assert.equal(cleanupReady.length, 1);
  assert.equal(cleanupReady[0].count, 1);
  assert.deepEqual(Array.from(cleanupReady[0].noteIds), ['expired-trash']);
  windowTarget.HasnaNotes.notes.setStatusFilter('trash');
  assert.ok(windowTarget.HasnaNotes.view.state().visibleNoteIds.includes('expired-trash'));

  assert.deepEqual(Array.from(windowTarget.HasnaNotes.notes.cleanupExpiredTrash()), []);
  assert.match(prompts.at(-1), /^Delete expired Trash notes permanently\?/);
  assert.match(prompts.at(-1), /cannot be undone/);
  assert.ok(windowTarget.HasnaNotes.view.state().visibleNoteIds.includes('expired-trash'));
  assert.equal(purges.length, 0);

  confirmResult = true;
  assert.deepEqual(Array.from(windowTarget.HasnaNotes.notes.cleanupExpiredTrash()), ['expired-trash']);
  assert.equal(purges.at(-1).reason, 'retention-cleanup');
  assert.equal(windowTarget.HasnaNotes.view.state().visibleNoteIds.includes('expired-trash'), false);
});

test('web trash and archive views: restore, permanent delete, retention countdown', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget, document } = loadWebAppWithFakeDOM(app);
  const prompts = [];
  windowTarget.confirm = message => { prompts.push(message); return true; };
  const future = new Date(Date.now() + 4.5 * 86400000).toISOString();
  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    notes: [
      { id: 'live-1', title: 'Live', body: 'Live body', labels: [], status: 'active', machine: 'apple03', updatedAt: '2026-06-23T10:00:00Z', createdAt: '2026-06-23T09:00:00Z' },
      { id: 'arch-1', title: 'Archived', body: 'Archived body', labels: [], status: 'archived', machine: 'apple03', archivedAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T10:00:00Z', createdAt: '2026-06-22T09:00:00Z' },
      { id: 'trash-1', title: 'Trashed', body: 'Trashed body', labels: [], status: 'trash', machine: 'apple03', trashedAt: '2026-06-21T10:00:00Z', trashExpiresAt: future, updatedAt: '2026-06-21T10:00:00Z', createdAt: '2026-06-21T09:00:00Z' },
    ],
    machines: [{ id: 'apple03' }],
  });

  // Archive view: sidebar entry filters to archived notes; hover Restore works.
  document.getElementById('nav-archive').click();
  let view = windowTarget.HasnaNotes.view.state();
  assert.equal(view.screen, 'noteslist');
  assert.equal(view.statusFilter, 'archived');
  assert.deepEqual(view.visibleNoteIds, ['arch-1']);
  assert.equal(document.getElementById('np-title').textContent, 'Archived');
  const npList = document.getElementById('np-list');
  const archActions = npList.children[0].children.find(c => c.className.includes('np-row-actions'));
  assert.ok(archActions, 'archived rows expose hover actions');
  assert.ok(archActions.children.some(b => b.title === 'Copy note'), 'hover copy on list rows');
  const restoreBtn = archActions.children.find(b => b.title === 'Restore');
  assert.ok(restoreBtn, 'archived rows expose Restore');
  assert.ok(!archActions.children.some(b => b.title === 'Delete permanently'), 'permanent delete is Trash-only');
  restoreBtn.click();
  assert.deepEqual(windowTarget.HasnaNotes.view.state().visibleNoteIds, [], 'restored note leaves the Archive view');

  // Trash view: retention countdown + Restore + confirmation-gated permanent Delete.
  document.getElementById('nav-trash').click();
  view = windowTarget.HasnaNotes.view.state();
  assert.equal(view.statusFilter, 'trash');
  assert.deepEqual(view.visibleNoteIds, ['trash-1']);
  assert.equal(document.getElementById('np-title').textContent, 'Trash');
  const trashRow = document.getElementById('np-list').children[0];
  const meta = trashRow.children.find(c => c.className.includes('np-row-meta'));
  const expiry = meta.children.find(c => c.className.includes('np-row-expiry'));
  assert.ok(expiry, 'trash rows show the retention countdown');
  assert.match(expiry.textContent, /^Deleted forever in 5 days$/);
  const trashActions = trashRow.children.find(c => c.className.includes('np-row-actions'));
  assert.ok(trashActions.children.some(b => b.title === 'Restore'));
  const deleteBtn = trashActions.children.find(b => b.title === 'Delete permanently');
  assert.ok(deleteBtn, 'trash rows expose permanent delete');
  deleteBtn.click();
  assert.match(prompts.at(-1), /^Delete permanently\?/);
  assert.match(prompts.at(-1), /cannot be undone/);
  assert.deepEqual(windowTarget.HasnaNotes.view.state().visibleNoteIds, []);
  assert.equal(document.getElementById('np-empty').hidden, false);
  assert.equal(document.getElementById('np-empty').textContent, 'Trash is empty');

  // Retention setting: 0 clamps to 1 (never silently disables retention), 90 sticks,
  // and junk input keeps the 30-day default.
  assert.equal(windowTarget.HasnaNotes.notes.setTrashRetentionDays(0).trashRetentionDays, 1);
  assert.equal(windowTarget.HasnaNotes.notes.setTrashRetentionDays(90).trashRetentionDays, 90);
  assert.equal(windowTarget.HasnaNotes.notes.setTrashRetentionDays('junk').trashRetentionDays, 30);
});

test('web enforces trash retention on boot and hydrate, once per session', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const expiredBoot = {
    thisMachine: 'apple03',
    notes: [{
      id: 'expired-1', title: 'Expired', body: 'Old', labels: [], status: 'trash', machine: 'apple03',
      trashedAt: '2025-01-01T00:00:00Z', trashExpiresAt: '2025-02-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
    }],
    machines: [{ id: 'apple03' }],
  };

  // Declining the boot prompt keeps the note and must NOT re-prompt on later hydrates.
  const declinedPrompts = [];
  const declined = loadWebAppWithFakeDOM(app, {
    __BOOT__: expiredBoot,
    confirm(message) { declinedPrompts.push(message); return false; },
  });
  assert.equal(declinedPrompts.length, 1, 'boot cleanup asks exactly once');
  assert.match(declinedPrompts[0], /^Delete expired Trash notes permanently\?/);
  declined.windowTarget.HasnaNotes.notes.setStatusFilter('trash');
  assert.deepEqual(declined.windowTarget.HasnaNotes.view.state().visibleNoteIds, ['expired-1']);
  declined.windowTarget.HasnaNotes.hydrate(expiredBoot);
  declined.windowTarget.HasnaNotes.hydrate(expiredBoot);
  assert.equal(declinedPrompts.length, 1, 'declining must not re-prompt every hydrate');

  // Accepting the boot prompt purges the expired note (confirmation-gated enforcement).
  const acceptedPrompts = [];
  const accepted = loadWebAppWithFakeDOM(app, {
    __BOOT__: expiredBoot,
    confirm(message) { acceptedPrompts.push(message); return true; },
  });
  assert.equal(acceptedPrompts.length, 1);
  accepted.windowTarget.HasnaNotes.notes.setStatusFilter('trash');
  assert.deepEqual(accepted.windowTarget.HasnaNotes.view.state().visibleNoteIds, []);
});

test('web markdown selection popover and slash menu route through editor.command', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const copied = [];
  const { windowTarget, document } = loadWebAppWithFakeDOM(app, {}, {
    navigator: { clipboard: { writeText: async text => { copied.push(text); } } },
  });
  const commands = [];
  windowTarget.addEventListener('hasna:editor-command', event => commands.push(event.detail));
  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    notes: [{ id: 'md-1', title: 'Markdown Note', body: 'hello world', labels: [], status: 'active', machine: 'apple03', updatedAt: '2026-06-23T10:00:00Z', createdAt: '2026-06-23T09:00:00Z' }],
    machines: [{ id: 'apple03' }],
  });
  // Open the note in the editor (sidebar row click), like a user would.
  document.getElementById('notes-list').children[0].click();
  assert.equal(windowTarget.HasnaNotes.view.state().screen, 'notes');
  const body = document.getElementById('editor-body');
  assert.equal(body.value, 'hello world');

  // Copy-note-as-Markdown lives top-right in the content header (editor only): the
  // title becomes an H1 above the Markdown body.
  const copyBtn = document.getElementById('note-copy');
  assert.equal(copyBtn.hidden, false, 'copy control shows with the editor');
  copyBtn.click();
  assert.equal(copied.at(-1), '# Markdown Note\n\nhello world');

  // Selecting text shows the popover; collapsing the selection hides it.
  const pop = document.getElementById('md-pop');
  body.setSelectionRange(0, 5);
  body.dispatchEvent({ type: 'select' });
  assert.equal(pop.hidden, false, 'selection shows the popover');
  windowTarget.HasnaNotes.editor.command('bold');
  assert.equal(body.value, '**hello** world');
  assert.equal(commands.at(-1).commandId, 'bold');
  body.setSelectionRange(3, 3);
  body.dispatchEvent({ type: 'select' });
  assert.equal(pop.hidden, true, 'collapsed selection hides the popover');

  // "/" at the start of a line opens the slash menu filtered by the query.
  const menu = document.getElementById('slash-menu');
  body.value = '/h2';
  body.setSelectionRange(3, 3);
  body.dispatchEvent({ type: 'input' });
  assert.equal(menu.hidden, false, 'slash trigger opens the menu');
  assert.ok(menu.children.length >= 1);
  assert.equal(menu.children[0].dataset.command, 'h2');
  // Enter applies the highlighted command and removes the "/query" trigger text.
  body.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  assert.equal(menu.hidden, true, 'menu closes after applying');
  assert.equal(body.value, '## ');
  assert.equal(commands.at(-1).commandId, 'h2');
  // Escape closes a re-opened menu without applying.
  body.value = '## \n/';
  body.setSelectionRange(5, 5);
  body.dispatchEvent({ type: 'input' });
  assert.equal(menu.hidden, false);
  assert.ok(menu.children.length >= 10, 'bare slash lists the whole command set');
  body.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(menu.hidden, true);

  // Defect fixes: divider inserts AFTER the selection (never replaces it), and the
  // code-block metadata carries real newlines (no literal backslash-n in previews).
  const divided = windowTarget.HasnaNotes.markdown.applyCommand('hello', { commandId: 'divider', selectionStart: 0, selectionEnd: 5 });
  assert.equal(divided.markdown, 'hello\n---');
  const codeBlock = windowTarget.HasnaNotes.markdown.commands().find(cmd => cmd.id === 'code-block');
  assert.equal(codeBlock.markdown, '```\ntext\n```');
  const libDivided = applyMarkdownCommand('hello', { commandId: 'divider', selectionStart: 0, selectionEnd: 5 });
  assert.equal(libDivided.markdown, 'hello\n---');
  assert.equal(MARKDOWN_COMMANDS.find(cmd => cmd.id === 'code-block').markdown, '```\ntext\n```');
});

test('web recording pause excludes paused time from elapsed', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  let now = Date.parse('2026-07-02T10:00:00Z');
  class TestDate extends Date {
    constructor(...args) { args.length ? super(...args) : super(now); }
    static now() { return now; }
  }
  class FakeMediaRecorder {
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    static isTypeSupported() { return true; }
  }
  const { windowTarget } = loadWebAppWithFakeDOM(app, {
    __AI__: { available: true, realtime: false, port: 12345 },
  }, {
    Date: TestDate,
    MediaRecorder: FakeMediaRecorder,
    navigator: {
      clipboard: { writeText: async () => undefined },
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    },
  });

  // Initial provider is a contract value even before any recording starts.
  assert.equal(windowTarget.HasnaNotes.recording.state().provider, 'openai-bounded');

  windowTarget.HasnaNotes.recording.start();
  await delay(20); // getUserMedia microtask
  assert.equal(windowTarget.HasnaNotes.recording.state().status, 'recording');

  now += 5000;
  windowTarget.HasnaNotes.recording.pause();
  now += 60000; // a full minute paused must not count
  const paused = windowTarget.HasnaNotes.recording.state();
  assert.equal(paused.status, 'paused');
  assert.equal(paused.elapsed, '0:05', 'timer holds while paused');

  windowTarget.HasnaNotes.recording.resume();
  now += 2000;
  const resumed = windowTarget.HasnaNotes.recording.state();
  assert.equal(resumed.status, 'recording');
  assert.equal(resumed.elapsed, '0:07', 'timer resumes where it left off');
  windowTarget.HasnaNotes.destroy(); // clear the 500ms tick interval
});

test('web sidebar defaults to the latest 10 notes and keeps pagination across hydrates', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget, document } = loadWebAppWithFakeDOM(app);
  const notes = Array.from({ length: 12 }, (_, i) => ({
    id: `page-${i}`,
    title: `Note ${i}`,
    body: `Body ${i}`,
    labels: [],
    status: 'active',
    machine: 'apple03',
    updatedAt: new Date(Date.parse('2026-06-01T00:00:00Z') + i * 60000).toISOString(),
    createdAt: '2026-06-01T00:00:00Z',
  }));
  // No listDefaults in the payload: the browser default is the contract's latest 10.
  windowTarget.HasnaNotes.hydrate({ thisMachine: 'apple03', notes, machines: [{ id: 'apple03' }] });
  const rows = document.getElementById('notes-list').children;
  const noteRows = rows.filter(r => r.className.includes('note-row'));
  assert.equal(noteRows.length, 10);
  assert.ok(rows.some(r => r.className.includes('view-more')), 'View more renders for the remainder');
  // A later hydrate (the host sends one after EVERY write) keeps the pagination.
  windowTarget.HasnaNotes.hydrate({ thisMachine: 'apple03', notes, machines: [{ id: 'apple03' }], listDefaults: { limit: 6 } });
  const rowsAfter = document.getElementById('notes-list').children.filter(r => r.className.includes('note-row'));
  assert.equal(rowsAfter.length, 10, 'hydrate must not reset the list limit');
});

test('personalnotes bin exposes the non-interactive agent mode with preview gating', async (t) => {
  const root = await tempRoot(t);
  const binPath = join(repoRoot, 'bin', 'personalnotes.mjs');
  const env = { PERSONALNOTES_ROOT: root };

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
    machine: 'apple03',
    createdByActorType: 'agent',
    createdByName: 'Codewith',
    sourceMachine: 'spark02',
    sourceMachineFriendlyName: 'Spark',
    openedFrom: 'mcp',
    sourceContext: 'ticket-123',
  }, root);
  assert.equal(created.createdByActorType, 'agent');
  assert.equal(created.originMachine, 'apple03');

  const moved = await moveNoteToMachine(id, 'apple04', { targetMachineFriendlyName: 'Studio' }, root);
  assert.equal(moved.machine, 'apple04');
  assert.equal(moved.previousMachine, 'apple03');
  assert.equal(moved.originMachine, 'apple03');

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
  assert.equal(trashed.trashMachine, 'apple04');
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

test('machine details combine open-machines fields with notes fallback metadata', async (t) => {
  const root = await tempRoot(t);
  const manifest = join(root, 'machines.json');
  await writeFile(manifest, JSON.stringify({
    machines: [{
      id: 'apple03',
      slug: 'apple-studio',
      friendlyName: 'Apple Studio',
      sshAddress: 'apple03.local',
      platform: 'macos',
      online: true,
      status: 'online',
      source: 'open-machines',
      origin: 'fleet',
      lastSeenAt: '2026-06-20T10:00:00Z',
      syncedAt: '2026-06-20T10:05:00Z',
      capabilities: ['notes-sync', 'menu-bar'],
      metadata: { location: 'desk', nested: { rack: 'A' } },
      provenance: { importedBy: 'test' },
      sync: { notes: 'ok' },
    }],
  }), 'utf8');
  await saveNote({
    id: uuidFor(130),
    title: 'Machine Note',
    machine: 'apple03',
    status: 'active',
    updatedAt: '2026-06-21T10:00:00Z',
    body: 'body',
  }, root);
  await saveNote({
    id: uuidFor(131),
    title: 'Archived Machine Note',
    machine: 'apple03',
    status: 'archived',
    updatedAt: '2026-06-22T10:00:00Z',
    body: 'body',
  }, root);
  await saveNote({
    id: uuidFor(132),
    title: 'Fallback Note',
    machine: 'spark02',
    status: 'active',
    updatedAt: '2026-06-19T10:00:00Z',
    body: 'body',
  }, root);
  await saveNote({
    id: uuidFor(133),
    title: 'Slug Owned Note',
    machine: 'apple-studio',
    status: 'active',
    updatedAt: '2026-06-23T10:00:00Z',
    body: 'body',
  }, root);

  assert.equal(parseMachineManifestJSON(await readFile(manifest, 'utf8'))[0].friendlyName, 'Apple Studio');
  const page = await listMachineDetails({ manifestPath: manifest, runCLI: false, thisMachine: '' }, root);
  const apple = page.items.find(m => m.id === 'apple03');
  assert.equal(apple.displayName, 'Apple Studio');
  assert.equal(apple.online, true);
  assert.deepEqual(apple.capabilities, ['notes-sync', 'menu-bar']);
  assert.deepEqual(apple.metadata.nested, { rack: 'A' });
  assert.deepEqual(apple.provenance, { importedBy: 'test' });
  assert.deepEqual(apple.sync, { notes: 'ok' });
  assert.equal(apple.noteCount, 2);
  assert.equal(apple.archivedNoteCount, 1);
  assert.equal(apple.totalNoteCount, 3);
  assert.equal(apple.latestNoteUpdatedAt, '2026-06-23T10:00:00.000Z');
  assert.equal(page.items.filter(m => m.id === 'apple-studio').length, 0);
  assert.equal((await getMachineDetails('apple-studio', { manifestPath: manifest, runCLI: false }, root)).id, 'apple03');

  const fallback = await getMachineDetails('spark02', { manifestPath: manifest, runCLI: false }, root);
  assert.equal(fallback.source, 'notes');
  assert.equal(fallback.noteCount, 1);
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

test('CLI creates, lists, and assigns labels with JSON output', async (t) => {
  const root = await tempRoot(t);
  const env = { HASNA_NOTES_ROOT: root };
  const created = await runNode(cliPath, [
    'create', '--title', 'CLI Note', '--body', 'body text', '--label', 'cli', '--json',
  ], env);
  assert.equal(created.code, 0, created.stderr);
  const note = JSON.parse(created.stdout);
  assert.equal(note.title, 'CLI Note');
  assert.deepEqual(note.labels, ['cli']);
  assert.equal(note.contentFormat, 'markdown');

  const page = await runNode(cliPath, ['list', '--json', '--limit', '1'], env);
  assert.equal(page.code, 0, page.stderr);
  const parsed = JSON.parse(page.stdout);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.items[0].id, note.id);

  const assigned = await runNode(cliPath, ['labels', 'assign', note.id, 'extra', '--json'], env);
  assert.equal(assigned.code, 0, assigned.stderr);
  assert.deepEqual(JSON.parse(assigned.stdout).labels, ['cli', 'extra']);

  const moved = await runNode(cliPath, ['move', note.id, 'apple04', '--json'], env);
  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(JSON.parse(moved.stdout).machine, 'apple04');

  const machine = await runNode(cliPath, ['machines', 'details', 'apple04', '--json'], env);
  assert.equal(machine.code, 0, machine.stderr);
  assert.equal(JSON.parse(machine.stdout).noteCount, 1);

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

  const nonInteractiveDelete = await runNode(cliPath, ['delete', note.id], env);
  assert.equal(nonInteractiveDelete.code, 0, nonInteractiveDelete.stderr);
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
    machine: 'apple03',
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
  constructor(env) {
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
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
    return new Promise(resolve => { this.waiters.push(resolve); this.drain(); });
  }

  drain() {
    while (this.waiters.length) {
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

test('MCP server exposes notes and labels tools over stdio framing', async (t) => {
  const root = await tempRoot(t);
  const client = new McpClient({ HASNA_NOTES_ROOT: root });
  t.after(() => client.close());

  const init = await client.send(1, 'initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.result.serverInfo.name, 'hasna-notes');

  const listTools = await client.send(2, 'tools/list', {});
  assert.ok(listTools.result.tools.some(tool => tool.name === 'labels_assign'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'notes_move_to_machine'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'machines_details'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'markdown_render'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'markdown_apply_command'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'agent_run'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'agent_goal'));
  assert.ok(listTools.result.tools.some(tool => tool.name === 'agent_tool_call'));

  const created = await client.send(3, 'tools/call', {
    name: 'notes_create',
    arguments: { title: 'MCP Note', body: 'mcp body', labels: ['mcp'], actorType: 'agent', actorName: 'MCP Agent', targetMachine: 'apple03' },
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
    arguments: { id: note.id, machine: 'apple04' },
  });
  assert.equal(parseToolText(moved).machine, 'apple04');

  const machine = await client.send(7, 'tools/call', {
    name: 'machines_details',
    arguments: { id: 'apple04' },
  });
  assert.equal(parseToolText(machine).noteCount, 1);

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
    arguments: { title: 'MCP Trash Target', body: 'trash body', targetMachine: 'apple03' },
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
    machine: 'apple03',
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

test('native destructive bridge actions require confirmed payloads', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const swift = await readFile(join(repoRoot, 'Sources', 'HasnaNotesApp', 'main.swift'), 'utf8');
  assert.match(app, /postNative\('trash', serializeNote\(note\), \{ confirmed:/);
  assert.match(app, /postNative\('purge', serializeNote\(note\), \{ confirmed:/);
  assert.match(swift, /destructiveConfirmed/);
  assert.match(swift, /case "trash":\s+guard allowDestructive\(action\) else \{ return \}/);
  assert.match(swift, /case "purge":\s+guard allowDestructive\(action\) else \{ return \}/);
  assert.match(swift, /case "delete":\s+guard allowDestructive\(action\) else \{ return \}/);
});

test('native window drag strip spans full header band and honors web-reported control rects', async () => {
  const swift = await readFile(join(repoRoot, 'Sources', 'HasnaNotesApp', 'main.swift'), 'utf8');
  const dragClass = swift.match(/final class WindowDragStrip: NSView \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(dragClass, /override var mouseDownCanMoveWindow: Bool \{ true \}/);
  assert.match(dragClass, /override func acceptsFirstMouse\(for event: NSEvent\?\) -> Bool \{ true \}/);
  // The strip drags everywhere inside its bounds EXCEPT over the interactive controls
  // the web layer reports (minimize / compact), which fall through to the WKWebView.
  assert.match(dragClass, /var passthroughRects: \[NSRect\]/);
  assert.match(dragClass, /guard bounds\.contains\(point\) else \{ return nil \}/);
  assert.match(dragClass, /for r in passthroughRects where r\.contains\(point\) \{ return nil \}/);
  // hit testing stays in local coordinates — no re-conversion (the prior double-convert bug).
  assert.doesNotMatch(dragClass, /convert\(point,\s*from:/);
  assert.match(dragClass, /window\?\.performDrag\(with: event\)/);
  // The strip now covers the FULL native header band: 30px traffic-light inset + 30px control row.
  assert.match(swift, /let headerDragHeight: CGFloat = 60/);
  assert.match(swift, /WindowDragStrip\(frame: NSRect\(x: 0, y: frame\.height - headerDragHeight, width: frame\.width, height: headerDragHeight\)\)/);
  assert.match(swift, /dragStrip\.identifier = NSUserInterfaceItemIdentifier\("window-drag-strip"\)/);
  assert.match(swift, /dragStrip\.autoresizingMask = \[\.width, \.minYMargin\]/);
  // Background dragging stays as a fallback.
  assert.match(swift, /window\.isMovableByWindowBackground = true/);
});

test('header drag-exclusion bridge: web reports control rects, native applies them', async () => {
  const swift = await readFile(join(repoRoot, 'Sources', 'HasnaNotesApp', 'main.swift'), 'utf8');
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const html = await readFile(join(repoRoot, 'web', 'index.html'), 'utf8');
  // Web posts the interactive control rects over the `window` channel.
  assert.match(app, /postWindow\('dragExclusions', \{ rects: rects \}\)/);
  assert.match(app, /data-no-drag/);
  assert.match(app, /getBoundingClientRect\(\)/);
  // Native window handler consumes them and converts CSS px -> strip-local coords.
  assert.match(swift, /action == "dragExclusions"/);
  assert.match(swift, /func applyDragExclusions/);
  assert.match(swift, /passthroughRects = /);
  // The minimize + compact controls are explicitly flagged no-drag in the markup.
  const noDragCount = (html.match(/data-no-drag/g) || []).length;
  assert.ok(noDragCount >= 2, `expected >=2 data-no-drag controls, found ${noDragCount}`);
});

test('recording and realtime transcription contracts are exposed to UI/native host', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const swift = await readFile(join(repoRoot, 'Sources', 'HasnaNotesApp', 'main.swift'), 'utf8');
  assert.match(app, /hasna:recording-state/);
  assert.match(app, /hasna:recording-progress/);
  assert.match(app, /hasna:transcript-delta/);
  assert.match(app, /hasna:transcript-complete/);
  assert.match(app, /window\.HasnaNotes = \{/);
  assert.match(app, /recording:\s*\{/);
  assert.match(app, /rec\.status = 'stopping'/);
  assert.match(app, /rec\.status = 'complete'/);
  assert.doesNotMatch(app, /rec\.status = 'starting'/);
  assert.match(app, /startRealtimeRecording/);
  assert.match(app, /pauseRecording/);
  assert.match(app, /resumeRecording/);
  assert.match(app, /machineDetails/);
  assert.match(app, /requestDetails/);
  assert.match(app, /hasna:machine-details/);

  const sidecar = await readFile(join(repoRoot, 'ai-sidecar', 'server.mjs'), 'utf8');
  assert.match(sidecar, /\/realtime-transcribe/);
  assert.match(sidecar, /\/chat/);
  assert.match(sidecar, /\/tool/);
  assert.match(sidecar, /HASNA_NOTES_SIDECAR_TOKEN/);
  assert.match(sidecar, /requireSidecarAuth/);
  assert.match(sidecar, /consumeApproval/);
  assert.match(sidecar, /streamText/);
  assert.match(sidecar, /ToolLoopAgent/);
  assert.match(sidecar, /executeNotesAgentTool/);
  assert.match(sidecar, /stepCountIs/);
  assert.match(sidecar, /openaiPartials/);
  assert.match(sidecar, /transcript\.delta/);
  assert.match(sidecar, /transcript\.completed/);
  assert.match(sidecar, /gpt-realtime-whisper/);
  assert.match(sidecar, /OPENAI_REALTIME_SESSION_MODEL/);
  assert.match(sidecar, /OPENAI_REALTIME_TRANSCRIPTION_MODEL/);
  assert.match(sidecar, /OPENAI_REALTIME_TRANSCRIPTION_WS_URL = 'wss:\/\/api\.openai\.com\/v1\/realtime\?intent=transcription'/);
  assert.match(sidecar, /mode: 'transcription_session'/);
  assert.match(sidecar, /transcription:\s*\{\s*model: OPENAI_REALTIME_TRANSCRIPTION_MODEL/s);
  assert.doesNotMatch(sidecar, /realtime\?model=.*OPENAI_REALTIME_TRANSCRIPTION_MODEL/);
  assert.doesNotMatch(sidecar, /realtime\?model=.*OPENAI_REALTIME_SESSION_MODEL/);
  assert.match(sidecar, /scribe_v2_realtime/);
  assert.match(app, /finalizeTimer/);
  assert.match(app, /startToken/);
  assert.match(app, /hasna:note-archive/);
  assert.match(app, /hasna:note-trash/);
  // Move-to-machine ships in the app too (parity with CLI "move" and MCP
  // notes_move_to_machine — vision MUST c10b7cf2, quick action 4d696e4b).
  assert.match(app, /moveToMachine/);
  assert.match(app, /hasna:note-move/);
  assert.match(app, /setTrashRetentionDays/);
  assert.match(app, /postNative\('settings'/);
  assert.match(app, /open-chat/);
  assert.match(app, /sendSidecarChat/);
  assert.match(app, /X-Hasna-Notes-Token/);
  assert.match(swift, /HASNA_NOTES_SIDECAR_TOKEN/);
  assert.match(swift, /"token": sidecar\.token/);

  const buildScript = await readFile(join(repoRoot, 'scripts', 'build_hasnanotes.sh'), 'utf8');
  assert.match(buildScript, /\$RESOURCES\/tools/);
  assert.match(buildScript, /notes-agent\.mjs/);
});

test('sidecar keeps bounded and realtime transcription models in separate slots', async (t) => {
  const guarded = await startSidecar(t, {
    HASNA_NOTES_TRANSCRIBE_MODEL: 'gpt-realtime-whisper',
    HASNA_NOTES_OPENAI_REALTIME_SESSION_MODEL: 'gpt-realtime-whisper',
    HASNA_NOTES_OPENAI_REALTIME_TRANSCRIPTION_MODEL: 'gpt-realtime-whisper',
  });
  const health = await guarded.health();
  assert.equal(health.transcribeModel, 'gpt-4o-transcribe');
  assert.equal(health.realtimeModels.openaiSession, 'gpt-realtime');
  assert.equal(health.realtimeModels.openaiTranscription, 'gpt-realtime-whisper');
  assert.equal(health.realtimeEndpoints.openai, '/v1/realtime?intent=transcription');
  assert.ok(health.configWarnings.some(w => w.includes('HASNA_NOTES_TRANSCRIBE_MODEL=gpt-realtime-whisper')));
  assert.ok(health.configWarnings.some(w => w.includes('audio.input.transcription.model')));

  for (const invalidSessionModel of ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1']) {
    const invalidSession = await startSidecar(t, {
      HASNA_NOTES_OPENAI_REALTIME_SESSION_MODEL: invalidSessionModel,
    });
    const invalidHealth = await invalidSession.health();
    assert.equal(invalidHealth.realtimeModels.openaiSession, 'gpt-realtime');
    assert.ok(invalidHealth.configWarnings.some(w => w.includes(`Ignoring realtime session model ${invalidSessionModel}`)));
    assert.ok(invalidHealth.configWarnings.some(w => w.includes('HASNA_NOTES_TRANSCRIBE_MODEL')));
  }

  const cheap = await startSidecar(t, {
    HASNA_NOTES_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
    HASNA_NOTES_OPENAI_REALTIME_SESSION_MODEL: 'gpt-realtime',
  });
  const cheapHealth = await cheap.health();
  assert.equal(cheapHealth.transcribeModel, 'gpt-4o-mini-transcribe');
  assert.equal(cheapHealth.realtimeModels.openaiSession, 'gpt-realtime');
});

test('sidecar approval tool endpoint executes shared note tools without model access', async (t) => {
  const root = await tempRoot(t);
  const sidecar = await startSidecar(t, { HASNA_NOTES_ROOT: root });

  const unauthorized = await fetch(`http://127.0.0.1:${sidecar.port}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'create_note',
      input: { title: 'Rejected Sidecar Tool Note', body: 'No token.' },
      confirm: true,
    }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal((await loadNotes(root)).length, 0);

  const created = await fetch(`http://127.0.0.1:${sidecar.port}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hasna-Notes-Token': sidecar.token },
    body: JSON.stringify({
      name: 'create_note',
      input: { title: 'Sidecar Tool Note', body: 'Created without model.', labels: ['sidecar'] },
      confirm: true,
    }),
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.note.title, 'Sidecar Tool Note');
  assert.equal((await loadNotes(root)).length, 1);

  const preview = await fetch(`http://127.0.0.1:${sidecar.port}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hasna-Notes-Token': sidecar.token },
    body: JSON.stringify({
      name: 'trash_note',
      input: { id: createdBody.note.id },
      confirm: false,
    }),
  });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.requiresConfirmation, true);
  assert.equal((await getNote(createdBody.note.id, root)).status, 'active');

  const unboundConfirm = await fetch(`http://127.0.0.1:${sidecar.port}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hasna-Notes-Token': sidecar.token },
    body: JSON.stringify({
      name: 'trash_note',
      input: { id: createdBody.note.id },
      confirm: true,
    }),
  });
  assert.equal(unboundConfirm.status, 409);
  assert.equal((await getNote(createdBody.note.id, root)).status, 'active');

  const confirmed = await fetch(`http://127.0.0.1:${sidecar.port}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hasna-Notes-Token': sidecar.token },
    body: JSON.stringify({
      name: 'trash_note',
      input: { id: createdBody.note.id },
      confirm: true,
      approvalId: previewBody.approval.id,
    }),
  });
  assert.equal(confirmed.status, 200);
  assert.equal((await getNote(createdBody.note.id, root)).status, 'trash');
});

test('Cmd+K search opens the picked note even when sidebar filters hide it', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget, document } = loadWebAppWithFakeDOM(app);
  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'machine001',
    machines: [{ id: 'machine001' }, { id: 'machine002' }],
    notes: [
      {
        id: 'active-1', title: 'Remote plan', body: 'quarterly plan', labels: [],
        status: 'active', machine: 'machine002',
        updatedAt: '2026-06-25T10:00:00Z', createdAt: '2026-06-25T09:00:00Z',
      },
      {
        id: 'trash-1', title: 'Old junk', body: 'junk', labels: [],
        status: 'trash', machine: 'machine001',
        trashedAt: '2026-06-30T10:00:00Z', trashExpiresAt: '2099-01-01T00:00:00Z',
        updatedAt: '2026-06-30T10:00:00Z', createdAt: '2026-06-20T09:00:00Z',
      },
    ],
  });
  const spInput = document.getElementById('search-pop-input');
  const enter = () => spInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });

  // From the Trash view, searching an ACTIVE note and pressing Enter MUST open that
  // note — the stale status filter may not swap in the newest trashed note instead.
  windowTarget.HasnaNotes.notes.setStatusFilter('trash');
  spInput.value = 'Remote plan';
  enter();
  let view = windowTarget.HasnaNotes.view.state();
  assert.equal(view.screen, 'notes');
  assert.equal(view.selectedId, 'active-1');
  assert.equal(view.statusFilter, 'active');
  assert.ok(view.visibleNoteIds.includes('active-1'));

  // Same for a stale machine filter: the filter resets so the picked note shows.
  windowTarget.HasnaNotes.machines.select('machine001');
  assert.equal(windowTarget.HasnaNotes.view.state().selectedId, null);
  spInput.value = 'Remote plan';
  enter();
  view = windowTarget.HasnaNotes.view.state();
  assert.equal(view.selectedId, 'active-1');
  assert.equal(view.machineFilter, '__all__');
  assert.ok(view.visibleNoteIds.includes('active-1'));
});

test('web machines dropdown filters notes and canonicalizes machine aliases', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const { windowTarget, document } = loadWebAppWithFakeDOM(app);
  const machineSelections = [];
  windowTarget.addEventListener('hasna:machine-select', event => machineSelections.push(event.detail));

  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    machines: [
      { id: 'apple03', slug: 'apple-studio', friendlyName: 'Apple Studio' },
      { id: 'machine001', slug: 'machine-one', friendlyName: 'Machine One', status: 'online' },
    ],
    notes: [
      {
        id: 'apple-note',
        title: 'Apple Note',
        body: 'Local body',
        labels: [],
        status: 'active',
        machine: 'apple03',
        updatedAt: '2026-06-23T10:00:00Z',
        createdAt: '2026-06-23T09:00:00Z',
      },
      {
        id: 'machine-latest',
        title: 'Machine Latest',
        body: 'Destination body',
        labels: [],
        status: 'active',
        machine: 'machine001',
        updatedAt: '2026-06-22T10:00:00Z',
        createdAt: '2026-06-22T09:00:00Z',
      },
      {
        id: 'machine-slug',
        title: 'Machine Slug',
        body: 'Slug body',
        labels: [],
        status: 'active',
        machine: 'machine-one',
        updatedAt: '2026-06-21T10:00:00Z',
        createdAt: '2026-06-21T09:00:00Z',
      },
    ],
    listDefaults: { limit: 10 },
  });

  // Dropdown menu rows render into #machines-list (friendly names + counts); clicking a
  // row filters the notes list to that machine and jumps to its newest note.
  const machinesList = document.getElementById('machines-list');
  const machineRow = machinesList.children.find(row => row.dataset.machine === 'machine001');
  assert.ok(machineRow, 'expected machine001 dropdown row to render');
  machineRow.click();

  let view = windowTarget.HasnaNotes.view.state();
  assert.equal(view.screen, 'notes');
  assert.equal(view.machineFilter, 'machine001');
  assert.equal(view.selectedId, 'machine-latest');
  assert.deepEqual(view.visibleNoteIds, ['machine-latest', 'machine-slug']);
  assert.equal(view.selectedMachine.id, 'machine001');
  assert.equal(machineSelections.at(-1).reason, 'sidebar');
  assert.equal(machineSelections.at(-1).view.screen, 'notes');
  assert.equal(document.getElementById('window').getAttribute('data-active-shell'), 'app');
  // The dropdown button label reflects the active filter (friendly name shown).
  assert.equal(document.getElementById('machines-dd-label').textContent, 'Machine One');

  // Move-to-machine parity (CLI/MCP ship the same mutation): re-attributes the note,
  // preserves origin/previous provenance, and follows it to the destination filter.
  const moveEvents = [];
  windowTarget.addEventListener('hasna:note-move', event => moveEvents.push(event.detail));
  const movedNote = windowTarget.HasnaNotes.notes.moveToMachine('apple-note', 'machine-one');
  assert.equal(movedNote.machine, 'machine001');
  assert.equal(movedNote.previousMachine, 'apple03');
  assert.equal(movedNote.originMachine, 'apple03');
  assert.ok(movedNote.movedAt);
  assert.equal(moveEvents.length, 1);
  assert.equal(moveEvents[0].targetMachine, 'machine001');
  assert.equal(machineSelections.at(-1).reason, 'move');
  view = windowTarget.HasnaNotes.view.state();
  assert.equal(view.machineFilter, 'machine001');
  assert.equal(view.selectedId, 'apple-note');

  machineSelections.length = 0;
  windowTarget.HasnaNotes.hydrate({
    thisMachine: 'apple03',
    machines: [],
    notes: [{
      id: 'field-note',
      title: 'Field Note',
      body: 'Field body',
      labels: [],
      status: 'active',
      machine: 'field-slug',
      updatedAt: '2026-06-20T10:00:00Z',
      createdAt: '2026-06-20T09:00:00Z',
    }],
  });
  windowTarget.HasnaNotes.machines.select('field-slug');
  assert.equal(windowTarget.HasnaNotes.view.state().machineFilter, 'field-slug');
  windowTarget.HasnaNotes.machines.receiveDetails({
    requestId: 'manual',
    machine: { id: 'field001', slug: 'field-slug', friendlyName: 'Field One' },
  });
  view = windowTarget.HasnaNotes.view.state();
  assert.equal(view.machineFilter, 'field001');
  assert.equal(view.selectedId, 'field-note');
  assert.equal(view.selectedMachine.id, 'field001');
  assert.equal(machineSelections.at(-1).reason, 'details');
  assert.deepEqual(view.visibleNoteIds, ['field-note']);
  assert.equal(
    document.getElementById('machines-list').children.filter(row => row.dataset.machine === 'field001').length,
    1,
  );
  assert.equal(
    document.getElementById('machines-list').children.filter(row => row.dataset.machine === 'field-slug').length,
    0,
  );
});

test('bounded recording emits error instead of complete when transcription request fails', async () => {
  const app = await readFile(join(repoRoot, 'web', 'app.js'), 'utf8');
  const listeners = new Map();
  const windowTarget = {
    __AI__: { available: true, realtime: false, port: 12345 },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter(x => x !== fn));
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
  };
  const statuses = [];
  windowTarget.addEventListener('hasna:recording-state', ev => statuses.push(ev.detail.status));

  class FakeMediaRecorder {
    static isTypeSupported() { return true; }
    constructor() {
      this.state = 'inactive';
      this.mimeType = 'audio/webm';
    }
    start() {
      this.state = 'recording';
      setTimeout(() => this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) }), 0);
    }
    stop() {
      this.state = 'inactive';
      setTimeout(() => this.onstop?.(), 0);
    }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
  }

  class FakeFileReader {
    readAsDataURL() {
      setTimeout(() => {
        this.result = 'data:audio/webm;base64,YXVkaW8=';
        this.onloadend?.();
      }, 0);
    }
  }

  const context = {
    window: windowTarget,
    document: {
      readyState: 'loading',
      addEventListener() {},
      removeEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    },
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    MediaRecorder: FakeMediaRecorder,
    FileReader: FakeFileReader,
    Blob,
    TextEncoder,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(app, context, { filename: 'web/app.js' });

  windowTarget.HasnaNotes.recording.start();
  await delay(20);
  assert.equal(windowTarget.HasnaNotes.recording.state().status, 'recording');
  windowTarget.HasnaNotes.recording.stop();
  await delay(60);

  assert.deepEqual(statuses.filter(s => ['stopping', 'transcribing', 'error'].includes(s)).slice(-3), [
    'stopping',
    'transcribing',
    'error',
  ]);
  assert.equal(windowTarget.HasnaNotes.recording.state().status, 'error');
  assert.equal(statuses.includes('complete'), false);
});
