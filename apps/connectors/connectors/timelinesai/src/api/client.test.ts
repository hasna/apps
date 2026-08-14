import { afterEach, describe, expect, mock, test } from 'bun:test';
import { TimelinesAIClient } from './client';

const originalFetch = globalThis.fetch;

type FetchCall = [string, RequestInit];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function getLastFetchCall(fetchMock: ReturnType<typeof mock>): FetchCall {
  const calls = fetchMock.mock.calls as unknown as FetchCall[];
  const call = calls[calls.length - 1];
  if (!call) {
    throw new Error('fetch was not called');
  }
  return call;
}

describe('TimelinesAIClient', () => {
  test('sends Bearer authorization header on GET requests', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        status: 'ok',
        data: { has_more_pages: false, chats: [] },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TimelinesAIClient({ apiKey: 'test-api-key-1234' });
    await client.get('/chats');

    const [url, init] = getLastFetchCall(fetchMock);
    expect(url).toContain('/chats');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-api-key-1234',
    });
  });

  test('encodes chat id in path segments', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        status: 'ok',
        data: { id: 1000001, name: 'Test' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TimelinesAIClient({ apiKey: 'test-api-key' });
    await client.get(`/chats/${client.encodePathSegment('1000001')}`);

    const [url] = getLastFetchCall(fetchMock);
    expect(url).toContain('/chats/1000001');
  });

  test('sends JSON body on POST message requests', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        status: 'ok',
        data: { message_uid: 'msg-uid-1' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TimelinesAIClient({ apiKey: 'test-api-key' });
    await client.post('/messages', {
      phone: '+14840000000',
      text: 'Hello from connector',
    });

    const [url, init] = getLastFetchCall(fetchMock);
    expect(url).toContain('/messages');
    expect(JSON.parse(String(init.body))).toMatchObject({
      phone: '+14840000000',
      text: 'Hello from connector',
    });
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    });
  });

  test('uses custom base URL when configured', async () => {
    const fetchMock = mock(async () =>
      Response.json({ status: 'ok', data: { whatsapp_accounts: [] } })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TimelinesAIClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/api',
    });
    await client.get('/whatsapp_accounts');

    const [url] = getLastFetchCall(fetchMock);
    expect(url).toBe('https://custom.example/api/whatsapp_accounts');
  });
});
