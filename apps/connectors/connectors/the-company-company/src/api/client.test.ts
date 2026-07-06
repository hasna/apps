import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
    });
    return {
      ok: true,
      status: 200,
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

describe('The Company Company API client', () => {
  test('listAgents sends Bearer auth to /agents', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'tcc-key' });
    await client.agents.list();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/agents`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer tcc-key');
  });

  test('createTask sends Bearer auth and POST body to /tasks', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'tcc-key' });
    await client.tasks.create({ agentId: 'agent 1', prompt: 'Run payroll' });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/tasks`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization).toBe('Bearer tcc-key');
    const body = JSON.parse(recorded[0].body as string);
    expect(body.agent_id).toBe('agent 1');
    expect(body.prompt).toBe('Run payroll');
  });

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow('API key');
  });
});
