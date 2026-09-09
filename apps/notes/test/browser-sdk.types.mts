import { NotesClient, NotesApiError, type Note, type ChangesPage } from '../sdk/browser.mjs';

const sdk = new NotesClient({ apiBase: 'https://notes.example.com/api/v1/', credential: async () => 'fictional-session' });
const page = await sdk.list({ limit: 200, includeDeleted: true });
const note: Note = await sdk.create({ title: 'Ideas', frontmatterJson: { nested: [true, null, 2] } }, { idempotencyKey: 'fixture-create' });
await sdk.update(note.id, { bodyMarkdown: 'Text', baseRevision: note.revision });
await sdk.delete(note.id, { baseRevision: note.revision });
await sdk.restore(note.id, { baseRevision: note.revision });
const changes: ChangesPage = await sdk.changes({ cursor: 'opaque' });
const sequence: string | undefined = changes.changes[0]?.sequence;
const next: string | null = page.nextCursor;
const error = new NotesApiError('revision_conflict', 'Changed', { status: 409, details: { current: note } });
void [sequence, next, error];
// @ts-expect-error An explicit provider is required, not a copied credential string.
new NotesClient({ apiBase: 'https://notes.example.com/v1/', credential: 'fictional-session' });
// @ts-expect-error Revisions must remain numeric.
sdk.update(note.id, { baseRevision: '7' });
