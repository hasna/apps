import { describe, expect, test } from 'bun:test';
import { createPromptsClient } from './canonical-client.js';

const configured = { HASNA_PROMPTS_API_URL: 'https://prompts.example.test', HASNA_PROMPTS_API_KEY: 'fixture-key' };
describe('canonical prompts HTTPS boundary', () => {
  test('missing, partial, blank, malformed and conflicting configuration fails closed', () => {
    for (const env of [ {}, { HASNA_PROMPTS_API_URL: configured.HASNA_PROMPTS_API_URL },
      { HASNA_PROMPTS_API_KEY: 'fixture-key' }, { ...configured, HASNA_PROMPTS_API_KEY: ' ' },
      { ...configured, HASNA_PROMPTS_API_KEY: 'short' },
      { ...configured, HASNA_PROMPTS_API_URL: 'http://localhost' },
      { ...configured, HASNA_PROMPTS_API_URL: 'https://user:secret@example.test' },
      { ...configured, HASNA_PROMPTS_API_URL: 'https://example.test/?credential=hidden' },
      { ...configured, PROMPTS_API_URL: 'https://other.example.test' },
      { ...configured, PROMPTS_API_KEY: 'legacy-should-reject' },
      { ...configured, HASNA_PROMPTS_STORAGE_MODE: '' },
      { ...configured, HASNA_PROMPTS_API_KEY: 'fixture\nkey' },
    ]) expect(() => createPromptsClient({ env })).toThrow();
  });
  test('accessor-backed configuration is rejected without invoking getters', () => {
    let invoked = 0;
    const env = { ...configured };
    Object.defineProperty(env, 'HASNA_PROMPTS_API_KEY', { get() { invoked++; return 'fixture-key'; }, enumerable: true, configurable: true });
    expect(() => createPromptsClient({ env })).toThrow(/accessor-backed/);
    expect(invoked).toBe(0);
  });
  test('snapshots URL and credential, disallows redirects, and does not reveal remote errors', async () => {
    const env = { ...configured };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createPromptsClient({ env, fetch: (async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ items: [], total: 0 });
    }) as typeof fetch });
    env.HASNA_PROMPTS_API_URL = 'https://changed.example.test';
    env.HASNA_PROMPTS_API_KEY = 'rotated-fixture';
    await client.list();
    expect(calls[0]?.url).toBe('https://prompts.example.test/v1/prompts?limit=20&offset=0');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer fixture-key');
    expect(calls[0]?.init?.redirect).toBe('error');
    expect(JSON.stringify(client)).not.toContain('fixture-key');
    const failure = createPromptsClient({ env: configured, fetch: (async () => Response.json({ error: 'secret body' }, { status: 500 })) as typeof fetch });
    await expect(failure.list()).rejects.toThrow('prompts service request failed (HTTP 500)');
  });
  test('authority normalization strips trailing slash and /v1, keeps explicit HTTPS origin', async () => {
    for (const [input, base] of [
      ['https://prompts.example.test/', 'https://prompts.example.test'],
      ['https://prompts.example.test/v1', 'https://prompts.example.test'],
      ['https://prompts.example.test/v1/', 'https://prompts.example.test'],
    ] as Array<[string, string]>) {
      const calls: string[] = [];
      const client = createPromptsClient({ env: { ...configured, HASNA_PROMPTS_API_URL: input }, fetch: (async (url) => {
        calls.push(String(url));
        return Response.json({ items: [], total: 0 });
      }) as typeof fetch });
      expect(client.baseUrl).toBe(base);
      await client.list();
      expect(calls[0]).toBe(`${base}/v1/prompts?limit=20&offset=0`);
    }
  });
  test('get/create/update/delete error paths fail closed without revealing bodies', async () => {
    const failing = (status: number) => (async () => Response.json({ error: 'secret body' }, { status })) as typeof fetch;
    const notFound = createPromptsClient({ env: configured, fetch: failing(404) });
    await expect(notFound.get('abc')).rejects.toThrow('prompts service request failed (HTTP 404)');
    await expect(notFound.update('abc', { title: 'x' })).rejects.toThrow('prompts service request failed (HTTP 404)');
    await expect(notFound.delete('abc')).rejects.toThrow('prompts service request failed (HTTP 404)');
    const serverError = createPromptsClient({ env: configured, fetch: failing(500) });
    await expect(serverError.create({ title: 't', body: 'b' })).rejects.toThrow('prompts service request failed (HTTP 500)');
    // Remote bodies are never echoed into the thrown error.
    await expect(serverError.create({ title: 't', body: 'b' })).rejects.not.toThrow('secret body');
    // Empty identifiers are rejected before any fetch.
    let fetched = 0;
    const guarded = createPromptsClient({ env: configured, fetch: (async () => { fetched++; return Response.json({}); }) as typeof fetch });
    for (const id of ['', '.', '..']) expect(() => guarded.get(id)).toThrow(/identifier/);
    expect(fetched).toBe(0);
  });
  test('pagination bounds are enforced before fetch and invalid JSON is surfaced', async () => {
    let fetched = 0;
    const client = createPromptsClient({ env: configured, fetch: (async () => { fetched++; return Response.json({ items: [], total: 0 }); }) as typeof fetch });
    for (const options of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { offset: -1 }, { offset: 10001 }, { offset: 0.5 }]) {
      expect(() => client.list(options)).toThrow(/limit must be/);
    }
    expect(fetched).toBe(0);
    const badJson = createPromptsClient({ env: configured, fetch: (async () => new Response('not-json{', { headers: { 'content-type': 'application/json' } })) as typeof fetch });
    await expect(badJson.list()).rejects.toThrow('prompts service returned invalid JSON');
  });
});
