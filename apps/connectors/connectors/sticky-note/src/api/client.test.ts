import { afterEach, describe, expect, test } from 'bun:test';
import { StickyNote } from './index';
import { DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('StickyNote API transport', () => {
  test('listNotes GETs /notes with Bearer auth', async () => {
    const recorded = installFetch();
    const client = new StickyNote({ apiKey: 'sticky-note-key' });
    await client.listNotes();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe(`${DEFAULT_BASE_URL}/notes`);
    expect(recorded[0]!.method).toBe('GET');
    expect(recorded[0]!.headers.get('Authorization')).toBe('Bearer sticky-note-key');
  });

  test('getNote GETs encoded note path with Bearer auth', async () => {
    const recorded = installFetch();
    const client = new StickyNote({ apiKey: 'sticky-note-key' });
    await client.getNote('item-1');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe(`${DEFAULT_BASE_URL}/notes/item-1`);
    expect(recorded[0]!.headers.get('Authorization')).toBe('Bearer sticky-note-key');
  });

  test('createNote POSTs JSON body to /notes', async () => {
    const recorded = installFetch();
    const client = new StickyNote({ apiKey: 'sticky-note-key' });
    await client.createNote({ title: 'Hello', content: 'World' });

    expect(recorded[0]!.url).toBe(`${DEFAULT_BASE_URL}/notes`);
    expect(recorded[0]!.method).toBe('POST');
    expect(recorded[0]!.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(recorded[0]!.body!)).toEqual({ title: 'Hello', content: 'World' });
  });

  test('listEvents GETs /events', async () => {
    const recorded = installFetch();
    const client = new StickyNote({ apiKey: 'sticky-note-key' });
    await client.listEvents();

    expect(recorded[0]!.url).toBe(`${DEFAULT_BASE_URL}/events`);
    expect(recorded[0]!.method).toBe('GET');
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch();
    const client = new StickyNote({ apiKey: 'sticky-note-key' });
    await client.search({ query: 'workflow' });

    expect(recorded[0]!.url).toBe(`${DEFAULT_BASE_URL}/search`);
    expect(recorded[0]!.method).toBe('POST');
    expect(JSON.parse(recorded[0]!.body!)).toEqual({ query: 'workflow' });
  });

  test('rawRequest honors custom path and method', async () => {
    const recorded = installFetch();
    const client = new StickyNote({ apiKey: 'sticky-note-key' });
    await client.rawRequest({ method: 'POST', path: '/custom', body: { x: 1 } });

    expect(recorded[0]!.url).toBe(`${DEFAULT_BASE_URL}/custom`);
    expect(recorded[0]!.method).toBe('POST');
  });

  test('custom baseUrl override', async () => {
    const recorded = installFetch();
    const client = new StickyNote({
      apiKey: 'sticky-note-key',
      baseUrl: 'https://custom.example/v2',
    });
    await client.listNotes();

    expect(recorded[0]!.url).toBe('https://custom.example/v2/notes');
  });

  test('requires api key', () => {
    expect(() => new StickyNote({ apiKey: '' })).toThrow('API key is required');
  });
});
