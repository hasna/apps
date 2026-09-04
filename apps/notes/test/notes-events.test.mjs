import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNotes, loadNotesStrict, saveNote, serializeNote } from '../tools/notes-lib.mjs';
import {
  beginNoteCreatedIntent,
  noteCreatedEvent,
  notesCreatedFallbackIntentsDir,
  notesCreatedStateDir,
  notesCreatedWebhookChannel,
  notesEventsDataDir,
  notesEventsStatus,
  reconcileNoteCreatedEvents,
} from '../tools/notes-events.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'bin', 'notes.mjs');

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'notes-events-'));
  t.after(async () => { await chmod(join(root, 'notes'), 0o700).catch(() => {}); await rm(root, { recursive: true, force: true }); });
  return root;
}

function note(overrides = {}) {
  return {
    id: randomUUID(),
    title: 'Private title must stay local',
    body: 'Private body must stay local',
    createdAt: '2026-08-06T08:00:00.000Z',
    updatedAt: '2026-08-06T08:00:00.000Z',
    machine: 'fixture-machine',
    ...overrides,
  };
}

async function spoolFiles(root) {
  const inbox = join(notesEventsDataDir(root), 'spool', 'inbox');
  return (await readdir(inbox).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error)))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
}

async function spoolEvents(root) {
  const inbox = join(notesEventsDataDir(root), 'spool', 'inbox');
  return Promise.all((await spoolFiles(root)).map(async (name) => JSON.parse(await readFile(join(inbox, name), 'utf8'))));
}

async function writeExternalNote(fixture, root) {
  const dir = join(root, 'notes');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${fixture.id}.md`), serializeNote(fixture));
  return fixture;
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
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('Node can import the durable-spool Notes boundary without Bun globals', async () => {
  const result = await runNode('--input-type=module', ['-e', "await import('./tools/notes-events.mjs')"]);
  assert.equal(result.code, 0, result.stderr);
});

test('note.created envelope and webhook channel are exact, minimal, and disabled by default', () => {
  const fixture = note();
  const event = noteCreatedEvent(fixture);
  assert.deepEqual(event, {
    id: `notes:note:${fixture.id}:created`,
    source: 'notes',
    type: 'note.created',
    time: fixture.createdAt,
    subject: `note:${fixture.id}`,
    severity: 'info',
    data: { noteId: fixture.id, createdAt: fixture.createdAt, originMachine: fixture.machine },
    dedupeKey: `notes:note:${fixture.id}:created`,
    schemaVersion: 'notes.v1',
    metadata: {},
  });
  assert.doesNotThrow(() => JSON.stringify(event));
  assert.equal(JSON.stringify(event).includes(fixture.title), false);
  assert.equal(JSON.stringify(event).includes(fixture.body), false);
  assert.throws(() => noteCreatedEvent({ ...fixture, id: '../escape' }), /invalid_note_id/);

  const channel = notesCreatedWebhookChannel({
    url: 'https://receiver.example.test/note-created',
    secretRef: 'env:HASNA_NOTES_WEBHOOK_SIGNING',
  });
  assert.equal(channel.enabled, false);
  assert.deepEqual(channel.filters, [{ source: 'notes', type: 'note.created' }]);
  assert.equal(channel.webhook.secret, undefined);
  assert.equal(channel.webhook.secretRef, 'env:HASNA_NOTES_WEBHOOK_SIGNING');
  const attemptedInlineHeader = notesCreatedWebhookChannel({
    url: 'https://receiver.example.test/note-created',
    secretRef: 'env:HASNA_NOTES_WEBHOOK_SIGNING',
    headers: { authorization: 'credential-canary-do-not-store' },
  });
  assert.equal(JSON.stringify(attemptedInlineHeader).includes('credential-canary-do-not-store'), false);
  assert.equal(attemptedInlineHeader.webhook.headers, undefined);
  assert.throws(() => notesCreatedWebhookChannel({ url: 'file:///tmp/hook', secretRef: 'env:SAFE' }), /invalid_webhook_url/);
  assert.throws(() => notesCreatedWebhookChannel({ url: 'http://receiver.example.test/hook', secretRef: 'env:SAFE' }), /insecure_webhook_url/);
  assert.throws(() => notesCreatedWebhookChannel({ url: 'https://user:pass@receiver.example.test/hook', secretRef: 'env:SAFE' }), /invalid_webhook_url/);
  assert.throws(() => notesCreatedWebhookChannel({ url: 'https://receiver.example.test/hook?api_key=inline', secretRef: 'env:SAFE' }), /invalid_webhook_url/);
  assert.doesNotThrow(() => notesCreatedWebhookChannel({ url: 'http://127.0.0.1:43123/hook', secretRef: 'env:SAFE' }));
  assert.doesNotThrow(() => notesCreatedWebhookChannel({ url: 'http://[::1]:43123/hook', secretRef: 'env:SAFE' }));
  assert.throws(() => notesCreatedWebhookChannel({ url: 'https://example.test', secretRef: 'literal-value' }), /invalid_webhook_secret_ref/);
});

test('clean baseline suppresses history; direct public save creates exactly one durable event', async (t) => {
  const root = await tempRoot(t);
  const historical = await writeExternalNote(note(), root);
  const baseline = await reconcileNoteCreatedEvents(root);
  assert.equal(baseline.baseline, true);
  assert.deepEqual(await spoolFiles(root), []);

  const created = await saveNote(note(), root);
  const events = await spoolEvents(root);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    noteId: created.id,
    createdAt: created.createdAt,
    originMachine: created.machine,
  });
  const stored = JSON.stringify(events[0]);
  assert.equal(stored.includes(created.title), false);
  assert.equal(stored.includes(created.body), false);
  assert.equal(stored.includes(historical.title), false);

  await saveNote({ ...created, title: 'Updated private title', body: 'Updated private body' }, root, {
    eventContext: { kind: 'created', writer: 'incorrect-update-context' },
  });
  assert.equal((await spoolFiles(root)).length, 1, 'existing file cannot be falsely emitted as created');
});

test('save-before-spool crash intent and unseen post-baseline file both reconcile once', async (t) => {
  const root = await tempRoot(t);
  await reconcileNoteCreatedEvents(root);

  const crashed = note();
  await beginNoteCreatedIntent(crashed, root);
  await writeExternalNote(crashed, root);
  let result = await reconcileNoteCreatedEvents(root);
  assert.equal(result.enqueued, 1);

  const unseen = await writeExternalNote(note(), root);
  result = await reconcileNoteCreatedEvents(root);
  assert.equal(result.enqueued, 1);
  result = await reconcileNoteCreatedEvents(root);
  assert.equal(result.enqueued, 0);

  const identities = new Set((await spoolEvents(root)).map((event) => event.id));
  assert.deepEqual(identities, new Set([
    `notes:note:${crashed.id}:created`,
    `notes:note:${unseen.id}:created`,
  ]));
});

test('concurrent create writers converge to one immutable event identity', async (t) => {
  const root = await tempRoot(t);
  await reconcileNoteCreatedEvents(root);
  const fixture = note();
  await Promise.all(Array.from({ length: 12 }, () => saveNote(fixture, root, {
    eventContext: { kind: 'created', writer: 'concurrency-test' },
  })));
  await reconcileNoteCreatedEvents(root);
  const events = await spoolEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].dedupeKey, `notes:note:${fixture.id}:created`);
});

test('concurrent distinct create writers lose no events', async (t) => {
  const root = await tempRoot(t);
  await reconcileNoteCreatedEvents(root);
  const fixtures = Array.from({ length: 24 }, (_, index) => note({
    id: randomUUID(),
    title: `Private concurrent title ${index}`,
    body: `Private concurrent body ${index}`,
  }));
  await Promise.all(fixtures.map((fixture) => saveNote(fixture, root, {
    eventContext: { kind: 'created', writer: 'distinct-concurrency-test' },
  })));
  const events = await spoolEvents(root);
  assert.equal(events.length, fixtures.length);
  assert.deepEqual(
    new Set(events.map((event) => event.data.noteId)),
    new Set(fixtures.map((fixture) => fixture.id)),
  );
});

test('intent, status, and spool state never persist note content or credential canaries', async (t) => {
  const root = await tempRoot(t);
  const credentialCanary = 'credential-canary-do-not-store';
  const fixture = note({
    title: `private title ${credentialCanary}`,
    body: `private body ${credentialCanary}`,
    labels: [credentialCanary],
  });
  await beginNoteCreatedIntent(fixture, root);
  const intent = await readFile(join(notesCreatedStateDir(root), 'intents', `${fixture.id}.json`), 'utf8');
  assert.equal(intent.includes(credentialCanary), false);
  assert.equal(intent.includes(fixture.title), false);
  assert.equal(intent.includes(fixture.body), false);

  await writeFile(join(notesCreatedStateDir(root), 'status.json'), JSON.stringify({
    version: 1,
    status: 'ok',
    checkedAt: credentialCanary,
    injected: credentialCanary,
  }));
  assert.equal(JSON.stringify(await notesEventsStatus(root)).includes(credentialCanary), false);

  await saveNote(fixture, root, { eventContext: { kind: 'created', writer: 'privacy-test' } });
  await reconcileNoteCreatedEvents(root);
  const serializedEvents = JSON.stringify(await spoolEvents(root));
  const serializedStatus = JSON.stringify(await notesEventsStatus(root));
  for (const serialized of [serializedEvents, serializedStatus]) {
    assert.equal(serialized.includes(credentialCanary), false);
    assert.equal(serialized.includes(fixture.title), false);
    assert.equal(serialized.includes(fixture.body), false);
  }
});

test('failed note save cancels its intent and unreadable existing targets never emit', async (t) => {
  const root = await tempRoot(t);
  await reconcileNoteCreatedEvents(root);
  const notesPath = join(root, 'notes');
  await mkdir(notesPath, { recursive: true });

  const failed = note();
  await chmod(notesPath, 0o500);
  await assert.rejects(saveNote(failed, root, { eventContext: { kind: 'created', writer: 'failure-test' } }));
  await chmod(notesPath, 0o700);
  let status = await notesEventsStatus(root);
  assert.equal(status.pendingIntents, 0);
  assert.equal(status.spooledEvents, 0);

  const unreadable = note();
  await mkdir(join(notesPath, `${unreadable.id}.md`));
  await assert.rejects(saveNote(unreadable, root, { eventContext: { kind: 'created', writer: 'failure-test' } }));
  status = await notesEventsStatus(root);
  assert.equal(status.pendingIntents, 0);
  assert.equal(status.spooledEvents, 0);
});

test('corrupt baseline degrades visibly and never silently re-baselines unseen notes', async (t) => {
  const root = await tempRoot(t);
  const state = notesCreatedStateDir(root);
  await mkdir(state, { recursive: true });
  await writeFile(join(state, 'baseline-v1.json'), '{broken\n');
  await writeExternalNote(note(), root);
  await assert.rejects(reconcileNoteCreatedEvents(root));
  const status = await notesEventsStatus(root);
  assert.equal(status.status, 'error');
  assert.equal(status.errorCode, 'invalid_note_events_baseline');
  assert.equal(status.baselineState, 'invalid');
  assert.equal(status.seenNotes, 0);
});

// Heavy by design: 327 note writes plus three reconcile passes with injected
// failures exceed bun's 5000ms default (measured 5005-5138ms on station01).
// Declare the real cost so the strict assertions always run.
// node:test options form (second argument); a bare numeric third argument is ignored.
test('strict first-run snapshot never baselines a partial 327-note store', { timeout: 30_000 }, async (t) => {
  const root = await tempRoot(t);
  const historical = Array.from({ length: 327 }, (_, index) => note({
    id: randomUUID(),
    title: `Historical private title ${index}`,
    body: `Historical private body ${index}`,
  }));
  await Promise.all(historical.map((fixture) => writeExternalNote(fixture, root)));

  const injectedFailure = Object.assign(new Error('injected_note_enumeration_failure'), { code: 'EIO' });
  await assert.rejects(reconcileNoteCreatedEvents(root, {
    strictLoadOptions: { readdir: async () => { throw injectedFailure; } },
  }), /injected_note_enumeration_failure/);

  let reads = 0;
  await assert.rejects(reconcileNoteCreatedEvents(root, {
    strictLoadOptions: {
      readFile: async (...args) => {
        reads += 1;
        if (reads === 164) throw injectedFailure;
        return readFile(...args);
      },
    },
  }), /injected_note_enumeration_failure/);
  await assert.rejects(reconcileNoteCreatedEvents(root, {
    strictLoadOptions: { parseNote: async () => null },
  }), /invalid_note_document/);

  let status = await notesEventsStatus(root);
  assert.equal(status.baseline, false);
  assert.equal(status.seenNotes, 0);
  assert.equal(status.spooledEvents, 0);

  const recovered = await reconcileNoteCreatedEvents(root);
  assert.equal(recovered.baseline, true);
  assert.equal(recovered.enqueued, 0);
  status = await notesEventsStatus(root);
  assert.equal(status.seenNotes, 327);
  assert.equal(status.spooledEvents, 0);
  assert.equal((await loadNotesStrict(root)).length, 327);

  const created = await saveNote(note(), root);
  const events = await spoolEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.noteId, created.id);
});

test('events-as-file obstruction retains a private fallback intent and recovers exactly once', async (t) => {
  const root = await tempRoot(t);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'events'), 'obstruction');
  const fixture = note();

  const created = await saveNote(fixture, root);
  assert.equal(created.id, fixture.id);
  const fallbackDir = notesCreatedFallbackIntentsDir(root);
  const fallbackPath = join(fallbackDir, `${fixture.id}.json`);
  const fallback = await readFile(fallbackPath, 'utf8');
  assert.equal(fallback.includes(fixture.title), false);
  assert.equal(fallback.includes(fixture.body), false);
  assert.equal((await stat(fallbackDir)).mode & 0o777, 0o700);
  assert.equal((await stat(fallbackPath)).mode & 0o777, 0o600);
  let status = await notesEventsStatus(root);
  assert.equal(status.baseline, false);
  assert.equal(status.pendingIntents, 1);
  assert.equal(status.spooledEvents, 0);

  await rm(join(root, 'events'));
  const recovered = await reconcileNoteCreatedEvents(root);
  assert.equal(recovered.baseline, true);
  assert.equal(recovered.enqueued, 1);
  assert.equal((await spoolFiles(root)).length, 1);
  status = await notesEventsStatus(root);
  assert.equal(status.pendingIntents, 0);
  assert.equal((await reconcileNoteCreatedEvents(root)).enqueued, 0);
});

test.skip('legacy local CLI event writer was removed from the canonical HTTPS client', async (t) => {
  const root = await tempRoot(t);
  const env = { HASNA_NOTES_ROOT: root };
  const created = await runNode(cliPath, ['create', '--title', 'CLI private title', '--body', 'CLI private body', '--json'], env);
  assert.equal(created.code, 0, created.stderr);
  assert.equal((await spoolFiles(root)).length, 1);

  const statusResult = await runNode(cliPath, ['events', 'status', '--json'], env);
  assert.equal(statusResult.code, 0, statusResult.stderr);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.spooledEvents, 1);
  assert.equal(statusResult.stdout.includes('CLI private title'), false);
  assert.equal(statusResult.stdout.includes('CLI private body'), false);
});
