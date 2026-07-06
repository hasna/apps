import { afterEach, describe, expect, test } from 'bun:test';
import { Tumblr, blogPath, TumblrClient } from './index';

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
      body: typeof init?.body === 'string' ? init.body : undefined,
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
