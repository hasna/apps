import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Wati } from './index';

const originalFetch = globalThis.fetch;
const baseConfig = {
  apiKey: 'wati-tok',
  baseUrl: 'https://example.com',
};

type CapturedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
};

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

function installFetchMock(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    });
    return Response.json({ result: true, info: 'ok' });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Wati API modules', () => {
  test('contacts.getContacts hits /api/v1/getContacts', async () => {
    const captured = installFetchMock();
    const wati = new Wati(baseConfig);
    await wati.contacts.getContacts({ pageSize: 10, pageNumber: 2, name: 'Ada' });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url.pathname).toBe('/api/v1/getContacts');
    expect(captured[0]!.url.searchParams.get('pageSize')).toBe('10');
    expect(captured[0]!.url.searchParams.get('name')).toBe('Ada');
  });

  test('contacts.addContact POSTs to encoded path', async () => {
    const captured = installFetchMock();
    const wati = new Wati(baseConfig);
    await wati.contacts.addContact({ whatsappNumber: '+15551234', name: 'Ada' });

    expect(captured[0]!.url.pathname).toBe('/api/v1/addContact/%2B15551234');
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.body).toEqual({ name: 'Ada' });
  });

  test('messages.sendSessionMessage uses query param for messageText', async () => {
    const captured = installFetchMock();
    const wati = new Wati(baseConfig);
    await wati.messages.sendSessionMessage({ whatsappNumber: '+15551234', messageText: 'Hi there' });

    expect(captured[0]!.url.pathname).toBe('/api/v1/sendSessionMessage/%2B15551234');
    expect(captured[0]!.url.searchParams.get('messageText')).toBe('Hi there');
    expect(captured[0]!.body).toBeUndefined();
  });

  test('messages.sendTemplateMessage uses snake_case body fields', async () => {
    const captured = installFetchMock();
    const wati = new Wati(baseConfig);
    await wati.messages.sendTemplateMessage({
      whatsappNumber: '+15551234',
      templateName: 'welcome',
      parameters: [{ name: 'name', value: 'Ada' }],
    });

    expect(captured[0]!.url.pathname).toBe('/api/v1/sendTemplateMessage');
    expect(captured[0]!.url.searchParams.get('whatsappNumber')).toBe('+15551234');
    expect(captured[0]!.body).toEqual({
      template_name: 'welcome',
      broadcast_name: 'welcome',
      parameters: [{ name: 'name', value: 'Ada' }],
      channel_number: undefined,
    });
  });

  test('operators.assignOperator POSTs email in body and whatsappNumber in query', async () => {
    const captured = installFetchMock();
    const wati = new Wati(baseConfig);
    await wati.operators.assignOperator({ whatsappNumber: '+15551234', email: 'agent@example.com' });

    expect(captured[0]!.url.pathname).toBe('/api/v1/assignOperator');
    expect(captured[0]!.url.searchParams.get('whatsappNumber')).toBe('+15551234');
    expect(captured[0]!.body).toEqual({ email: 'agent@example.com' });
  });

  test('labels.removeLabelsFromContact hits deleteLabels path', async () => {
    const captured = installFetchMock();
    const wati = new Wati(baseConfig);
    await wati.labels.removeLabelsFromContact({ whatsappNumber: '+15551234', labels: ['vip'] });

    expect(captured[0]!.url.pathname).toBe('/api/v1/deleteLabels/%2B15551234');
    expect(captured[0]!.body).toEqual({ labels: ['vip'] });
  });

  test('broadcasts.getBroadcastDetails passes broadcastName query', async () => {
    const captured = installFetchMock();
    const wati = new Wati(baseConfig);
    await wati.broadcasts.getBroadcastDetails({ broadcastName: 'Launch', pageSize: 10 });

    expect(captured[0]!.url.pathname).toBe('/api/v1/getBroadcastDetails');
    expect(captured[0]!.url.searchParams.get('broadcastName')).toBe('Launch');
    expect(captured[0]!.url.searchParams.get('pageSize')).toBe('10');
  });

  test('all 22 API methods are exported on Wati facade', () => {
    const wati = new Wati(baseConfig);
    expect(typeof wati.contacts.getContacts).toBe('function');
    expect(typeof wati.contacts.addContact).toBe('function');
    expect(typeof wati.contacts.updateContactAttributes).toBe('function');
    expect(typeof wati.messages.sendSessionMessage).toBe('function');
    expect(typeof wati.messages.sendSessionFile).toBe('function');
    expect(typeof wati.messages.sendTemplateMessage).toBe('function');
    expect(typeof wati.messages.sendTemplateMessages).toBe('function');
    expect(typeof wati.messages.sendInteractiveButtonsMessage).toBe('function');
    expect(typeof wati.messages.sendInteractiveListMessage).toBe('function');
    expect(typeof wati.messages.getMessages).toBe('function');
    expect(typeof wati.messages.getMediaFile).toBe('function');
    expect(typeof wati.operators.assignOperator).toBe('function');
    expect(typeof wati.operators.unassignOperator).toBe('function');
    expect(typeof wati.operators.updateChatStatus).toBe('function');
    expect(typeof wati.templates.getMessageTemplates).toBe('function');
    expect(typeof wati.operators.getOperators).toBe('function');
    expect(typeof wati.labels.addLabelsToContact).toBe('function');
    expect(typeof wati.labels.removeLabelsFromContact).toBe('function');
    expect(typeof wati.attributes.getCustomAttributes).toBe('function');
    expect(typeof wati.attributes.createCustomAttribute).toBe('function');
    expect(typeof wati.broadcasts.getBroadcasts).toBe('function');
    expect(typeof wati.broadcasts.getBroadcastDetails).toBe('function');
  });
});
