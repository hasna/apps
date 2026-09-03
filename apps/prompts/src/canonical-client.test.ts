import { describe, expect, test } from 'bun:test';
import { createPromptsClient } from './canonical-client.js';

const configured = { HASNA_PROMPTS_API_URL: 'https://prompts.example.test', HASNA_PROMPTS_API_KEY: 'fixture-key' };
describe('canonical prompts HTTPS boundary', () => {
  test('missing, partial, blank, malformed and conflicting configuration fails closed', () => {
    for (const env of [ {}, { HASNA_PROMPTS_API_URL: configured.HASNA_PROMPTS_API_URL },
      { HASNA_PROMPTS_API_KEY: 'fixture-key' }, { ...configured, HASNA_PROMPTS_API_KEY: ' ' },
      { ...configured, HASNA_PROMPTS_API_URL: 'http://localhost' },
      { ...configured, HASNA_PROMPTS_API_URL: 'https://user:secret@example.test' },
      { ...configured, HASNA_PROMPTS_API_URL: 'https://example.test/?credential=hidden' },
      { ...configured, PROMPTS_API_URL: 'https://other.example.test' },
      { ...configured, HASNA_PROMPTS_STORAGE_MODE: '' },
      { ...configured, HASNA_PROMPTS_API_KEY: 'fixture\nkey' },
    ]) expect(() => createPromptsClient({ env })).toThrow();
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
});
