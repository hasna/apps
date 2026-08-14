import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Tumblr, blogPath, TumblrClient } from './index';
import { exchangeCode, refreshAccessToken, TUMBLR_TOKEN_URL } from '../utils/auth';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => {
        headers[k] = v;
      });
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body:
        typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : undefined,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return json ?? { meta: { status: 200, msg: 'OK' }, response: {} };
      },
      async text() {
        return JSON.stringify(json ?? { meta: { status: 200, msg: 'OK' } });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Tumblr client', () => {
  test('blogPath appends .tumblr.com when needed', () => {
    expect(blogPath('staff')).toBe('staff.tumblr.com');
    expect(blogPath('staff.tumblr.com')).toBe('staff.tumblr.com');
    expect(blogPath('t:9b6f4d27-62f5-4e8f-8be8-4b9920f6935e')).toBe(
      't:9b6f4d27-62f5-4e8f-8be8-4b9920f6935e',
    );
  });

  test('blogPath rejects empty blog', () => {
    expect(() => blogPath('')).toThrow(/blog is required/);
  });

  test('requires access token', () => {
    expect(() => new TumblrClient({ accessToken: '' })).toThrow(/access token is required/);
  });

  test('getUserInfo sends Bearer auth to /user/info', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toBe('https://api.tumblr.com/v2/user/info');
      expect(init?.method ?? 'GET').toBe('GET');
      return { meta: { status: 200, msg: 'OK' }, response: { user: { name: 'staff' } } };
    });

    const tumblr = new Tumblr({ accessToken: 'test-token' });
    const result = await tumblr.users.getInfo();

    expect(result.response).toEqual({ user: { name: 'staff' } });
    expect(recorded[0].headers.authorization).toBe('Bearer test-token');
    expect(recorded[0].headers['user-agent']).toBe('@hasna/connect-tumblr/0.1');
  });

  test('OAuth token requests include a stable User-Agent', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toBe(TUMBLR_TOKEN_URL);
      expect(init?.method).toBe('POST');
      return {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
      };
    });

    await exchangeCode('client-id', 'client-secret', 'auth-code', 'https://example.com/callback');
    await refreshAccessToken('client-id', 'client-secret', 'refresh-token');

    expect(recorded).toHaveLength(2);
    expect(recorded[0].headers['user-agent']).toBe('@hasna/connect-tumblr/0.1');
    expect(recorded[1].headers['user-agent']).toBe('@hasna/connect-tumblr/0.1');
    expect(new URLSearchParams(recorded[0].body).get('grant_type')).toBe('authorization_code');
    expect(new URLSearchParams(recorded[1].body).get('grant_type')).toBe('refresh_token');
  });

  test('explicit access token requests do not create or read ~/.hasna config', () => {
    const home = mkdtempSync(join(tmpdir(), 'connect-tumblr-home-'));
    const apiModuleUrl = new URL('./index.ts', import.meta.url).href;
    const script = `
      globalThis.fetch = async (_input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get('authorization') !== 'Bearer explicit-token') {
          throw new Error('missing explicit bearer token');
        }
        if (headers.get('user-agent') !== '@hasna/connect-tumblr/0.1') {
          throw new Error('missing stable user-agent');
        }
        return new Response(
          JSON.stringify({ meta: { status: 200, msg: 'OK' }, response: { user: { name: 'staff' } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };
      const { Tumblr } = await import(${JSON.stringify(apiModuleUrl)});
      const tumblr = new Tumblr({ accessToken: 'explicit-token' });
      await tumblr.users.getInfo();
    `;

    const result = Bun.spawnSync({
      cmd: [process.execPath, '--eval', script],
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `child process failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
      );
    }
    expect(existsSync(join(home, '.hasna'))).toBe(false);
  });

  test('getBlogInfo normalizes blog path', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/blog/staff.tumblr.com/info');
      return { meta: { status: 200, msg: 'OK' }, response: { blog: { name: 'staff' } } };
    });

    const tumblr = new Tumblr({ accessToken: 'tok' });
    await tumblr.blogs.getInfo('staff');

    expect(recorded[0].url).toContain('staff.tumblr.com');
  });

  test('followBlog POSTs url body', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toBe('https://api.tumblr.com/v2/user/follow');
      expect(init?.method).toBe('POST');
      return { meta: { status: 200, msg: 'OK' }, response: {} };
    });

    const tumblr = new Tumblr({ accessToken: 'tok' });
    await tumblr.users.followBlog('https://example.tumblr.com');

    expect(JSON.parse(recorded[0].body!)).toEqual({ url: 'https://example.tumblr.com' });
  });

  test('createPost POSTs NPF content', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toContain('/blog/myblog.tumblr.com/posts');
      expect(init?.method).toBe('POST');
      return { meta: { status: 200, msg: 'OK' }, response: { id: '123' } };
    });

    const tumblr = new Tumblr({ accessToken: 'tok' });
    await tumblr.posts.create('myblog', {
      content: [{ type: 'text', text: 'hello' }],
    });

    const body = JSON.parse(recorded[0].body!);
    expect(body.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  test('searchByTag hits /tagged endpoint', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/tagged?tag=photography');
      return { meta: { status: 200, msg: 'OK' }, response: [] };
    });

    const tumblr = new Tumblr({ accessToken: 'tok' });
    await tumblr.tags.searchByTag('photography');

    expect(recorded[0].url).toContain('tag=photography');
  });

  test('throws TumblrApiError on API error response', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return { meta: { status: 401, msg: 'Not Authorized' } };
      },
      async text() {
        return JSON.stringify({ meta: { status: 401, msg: 'Not Authorized' } });
      },
    })) as unknown as typeof fetch;

    const tumblr = new Tumblr({ accessToken: 'bad' });
    await expect(tumblr.users.getInfo()).rejects.toThrow(/Not Authorized/);
  });
});
