import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  buildTrackBody,
  hashUserData,
  hashCustomerValue,
  getEventSourceId,
  mergeLegacyContext,
  buildEvent,
} from './events';
import { TikTokEventsClient } from './client';
import type { TikTokEventsConfig } from '../types';

const baseConfig: TikTokEventsConfig = {
  accessToken: 'tiktok-token',
  pixelCode: 'PIXEL123',
  appId: 'APP123',
  offlineEventSetId: 'OFF123',
  crmEventSetId: 'CRM123',
  testEventCode: 'TTTEST',
  baseUrl: 'https://business-api.tiktok.com/open_api/v1.3',
};

describe('TikTok Events API helpers', () => {
  test('hashUserData normalizes email, phone, and external_id', () => {
    const hashed = hashUserData({
      email: 'Ada@Example.com',
      phone_number: '+1 (555) 123-4567',
      external_id: 'customer-1',
      fbp: 'fb.1.123',
    });

    expect(hashed.email).toBe(createHash('sha256').update('ada@example.com').digest('hex'));
    expect(hashed.phone).toBe(createHash('sha256').update('+15551234567').digest('hex'));
    expect(hashed.external_id).toBe(createHash('sha256').update('customer-1').digest('hex'));
    expect(hashed.fbp).toBe('fb.1.123');
  });

  test('hashCustomerValue passes through existing sha256 hex', () => {
    const existing = 'a'.repeat(64);
    expect(hashCustomerValue('email', existing)).toBe(existing.toLowerCase());
  });

  test('mergeLegacyContext merges context user, ip, and user_agent', () => {
    const merged = mergeLegacyContext({
      event: 'Lead',
      context: {
        ip: '203.0.113.10',
        user_agent: 'TestAgent/1.0',
        page: { url: 'https://example.com/lead' },
      },
      user: { email: 'ada@example.com' },
    });

    expect(merged.user).toMatchObject({
      email: 'ada@example.com',
      ip: '203.0.113.10',
      user_agent: 'TestAgent/1.0',
    });
    expect(merged.page).toEqual({ url: 'https://example.com/lead' });
  });

  test('buildTrackBody resolves event_source_id from config and includes test code', () => {
    const body = buildTrackBody(baseConfig, {
      eventName: 'Lead',
      user: { email: 'ada@example.com' },
    });

    expect(body.event_source).toBe('web');
    expect(body.event_source_id).toBe('PIXEL123');
    expect(body.test_event_code).toBe('TTTEST');
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[])[0]).toMatchObject({ event: 'Lead' });
  });

  test('getEventSourceId requires explicit source id when config missing', () => {
    expect(() =>
      getEventSourceId({ ...baseConfig, pixelCode: undefined }, {}, 'web'),
    ).toThrow(/event_source_id is required for web events/);
  });

  test('buildEvent requires event or eventName', () => {
    expect(() => buildEvent({ user: { email: 'a@b.com' } })).toThrow(/event or eventName is required/);
  });
});

describe('TikTokEventsClient track request', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      expect(url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Access-Token')).toBe('tiktok-token');
      expect(headers.get('Content-Type')).toBe('application/json');

      const body = JSON.parse(String(init?.body));
      expect(body.event_source).toBe('web');
      expect(body.event_source_id).toBe('PIXEL123');
      expect(body.data[0].event).toBe('Lead');
      expect(body.data[0].user.email).toMatch(/^[a-f0-9]{64}$/);

      return new Response(JSON.stringify({ code: 0, message: 'OK', data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('POST /event/track/ sends Lead event with hashed user data', async () => {
    const client = new TikTokEventsClient(baseConfig);
    const response = await client.post('/event/track/', buildTrackBody(baseConfig, {
      eventName: 'Lead',
      user: { email: 'ada@example.com' },
    }));

    expect(response).toEqual({ code: 0, message: 'OK', data: { ok: true } });
  });

  test('raw request rejects URLs outside configured origin', async () => {
    const client = new TikTokEventsClient(baseConfig);
    await expect(
      client.request({
        path: 'https://evil.example/open_api/v1.3/pixel/list/',
      }),
    ).rejects.toThrow(/configured TikTok Business API origin/);
  });
});

describe('TikTok Events API CLI', () => {
  test('hash-user-data does not require API credentials', async () => {
    const proc = Bun.spawn(
      [
        'bun',
        join(import.meta.dir, '..', 'cli', 'index.ts'),
        '--format',
        'json',
        'hash-user-data',
        '--data',
        JSON.stringify({ user: { email: 'Ada@Example.com' } }),
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          TIKTOK_ACCESS_TOKEN: undefined,
          HOME: join(import.meta.dir, '..', '..', '.test-home'),
          NO_COLOR: '1',
        },
      },
    );

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      email: createHash('sha256').update('ada@example.com').digest('hex'),
    });
  });
});
