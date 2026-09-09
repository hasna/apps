// Real HTTP conformance fixture for Swift and independent archive consumers.
// This executable is test tooling and is not a customer CLI or an SDK runtime.
import fixture from '../sdk/fixtures/wire-v1.json';

export function startNotesFixture() {
  let credentialTrapCount = 0;
  return Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 5, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/credential-trap') { credentialTrapCount++; return Response.json({}); }
    if (url.pathname === '/trap-count') return Response.json({ count: credentialTrapCount });
    if (request.headers.get('authorization') !== 'Bearer fixture-credential') return new Response('reflected fixture-credential', { status: 401 });
    const path = url.pathname.replace(/^\/(api\/)?v1\//, '');
    if (path === 'notes/redirect') return new Response(null, { status: 307, headers: { location: `${url.origin}/credential-trap` } });
    if (path === 'notes/unauthorized' || path === 'notes/forbidden') return new Response('reflected fixture-credential', { status: path.endsWith('unauthorized') ? 401 : 403 });
    if (path === 'notes/invalid-json') return new Response('invalid-json');
    if (path === 'notes/oversized') return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x'.repeat(200))); c.close(); } }));
    if (path === 'notes/slow') { await Bun.sleep(3000); return Response.json(fixture.note); }
    if (path === 'notes' && request.method === 'GET') return Response.json({ data: url.searchParams.has('cursor') ? [] : [fixture.note], nextCursor: url.searchParams.has('cursor') ? null : 'next-page', hasMore: !url.searchParams.has('cursor') });
    if (path === 'changes') return Response.json({ changes: [{ sequence: fixture.largeSequence, noteId: fixture.note.id, action: 'upsert', note: fixture.note }], cursor: fixture.changeCursor, hasMore: false });
    if (path === 'labels') return Response.json({ data: [{ name: 'ideas', count: 1 }] });
    if (path.startsWith('labels/')) return Response.json({ updated: 1 });
    if (path === 'export') return Response.json({ exportId: 'fixture-export', notes: [fixture.note] });
    if (path === 'notes' && request.method === 'POST') {
      const input = await request.json();
      if (request.headers.get('idempotency-key') !== 'create:fixture-1') return Response.json({ error: { code: 'fixture_failure', message: 'Missing idempotency key' } }, { status: 400 });
      return Response.json({ ...fixture.note, ...input }, { status: 201 });
    }
    if (path.startsWith('notes/')) {
      if (request.method === 'PATCH') {
        const input = await request.json();
        if (input.baseRevision !== 7) return Response.json({ error: { code: 'revision_conflict', message: 'Changed fixture-credential', details: { current: fixture.note } } }, { status: 409 });
        return Response.json({ ...fixture.note, ...input });
      }
      if (request.method === 'DELETE') return Response.json({ deleted: true, id: fixture.note.id, revision: 8 });
      return Response.json(fixture.note);
    }
    return new Response(null, { status: 404 });
  } });
}

if (import.meta.main) {
  const server = startNotesFixture();
  console.log(`http://127.0.0.1:${server.port}`);
}
