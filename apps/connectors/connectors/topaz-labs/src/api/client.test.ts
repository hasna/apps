import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TopazLabs, TopazLabsClient } from './index';
import { TopazLabsApiError } from '../types';

const realFetch = globalThis.fetch;
const mockApiKey = 'topaz-key';
const sourceUrl = 'https://assets.example.com/in.jpg';

type CapturedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body?: BodyInit | null;
};

type AsyncCase = {
  method:
    | 'enhance'
    | 'enhanceGenerative'
    | 'sharpen'
    | 'sharpenGenerative'
    | 'denoise'
    | 'restore'
    | 'lighting'
    | 'matting'
    | 'tool';
  path: string;
};

function installFetchMock(response?: Response) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    );
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    if (response) return response.clone();
    return new Response(JSON.stringify({
      process_id: 'process-1',
      source_id: 'source-1',
      eta: 1617220000,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return captured;
}

function formEntries(body: BodyInit | null | undefined): Record<string, FormDataEntryValue> {
  expect(body).toBeInstanceOf(FormData);
  return Object.fromEntries((body as FormData).entries());
}

function expectTopazRequest(request: CapturedRequest, path: string, method = 'GET') {
  expect(request.url.origin).toBe('https://api.topazlabs.com');
  expect(request.url.pathname).toBe(`/image/v1${path}`);
  expect(request.method).toBe(method);
  expect(request.headers.get('Accept')).toBe('application/json');
  expect(request.headers.get('X-API-Key')).toBe(mockApiKey);
}

function client(): TopazLabs {
  return new TopazLabs({ apiKey: mockApiKey });
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TopazLabsClient', () => {
  test('throws when apiKey is missing', () => {
    expect(() => new TopazLabsClient({})).toThrow('Topaz Labs apiKey is required');
  });

  test('getApiKeyPreview masks long keys', () => {
    const c = new TopazLabsClient({ apiKey: 'abcdefghijkl' });
    expect(c.getApiKeyPreview()).toBe('abcdef...ijkl');
  });
});

describe('TopazLabs Image API', () => {
  test('async image operations use schema paths and multipart bodies', async () => {
    const captured = installFetchMock();
    const api = client();
    const cases: AsyncCase[] = [
      { method: 'enhance', path: '/enhance/async' },
      { method: 'enhanceGenerative', path: '/enhance-gen/async' },
      { method: 'sharpen', path: '/sharpen/async' },
      { method: 'sharpenGenerative', path: '/sharpen-gen/async' },
      { method: 'denoise', path: '/denoise/async' },
      { method: 'restore', path: '/restore-gen/async' },
      { method: 'lighting', path: '/lighting/async' },
      { method: 'matting', path: '/matting/async' },
      { method: 'tool', path: '/tool/async' },
    ];

    for (const commandCase of cases) {
      await api[commandCase.method]({
        sourceUrl,
        model: 'Standard V2',
        outputFormat: 'png',
        outputWidth: 1920,
        cropToFill: true,
        webhookUrl: 'https://example.com/topaz-hook',
        modelSettings: { creativity: 10 },
      });
    }

    expect(captured).toHaveLength(cases.length);
    cases.forEach((commandCase, index) => {
      const request = captured[index]!;
      expectTopazRequest(request, commandCase.path, 'POST');
      expect(request.headers.get('Content-Type')).toBeNull();
      const entries = formEntries(request.body);
      expect(entries.source_url).toBe(sourceUrl);
      expect(entries.model).toBe('Standard V2');
      expect(entries.output_format).toBe('png');
      expect(entries.output_width).toBe('1920');
      expect(entries.crop_to_fill).toBe('true');
      expect(entries.webhook_url).toBe('https://example.com/topaz-hook');
      expect(entries.creativity).toBe('10');
    });

    const paths = captured.map(request => request.url.pathname);
    expect(paths).not.toContain('/image/v1/enhance');
    expect(paths).not.toContain('/image/v1/upscale');
    expect(paths).not.toContain('/image/v1/jobs');
    expect(paths).not.toContain('/image/v1/models');
    expect(paths).not.toContain('/image/v1/presets');
    expect(paths).not.toContain('/image/v1/webhooks');
  });

  test('uploads binary image fields without forcing a JSON content type', async () => {
    const captured = installFetchMock();
    const image = new Blob(['image-bytes'], { type: 'image/png' });

    await client().enhance({ image, filename: 'input.png', outputHeight: 1080 });

    const request = captured[0]!;
    expectTopazRequest(request, '/enhance/async', 'POST');
    expect(request.headers.get('Content-Type')).toBeNull();
    const form = request.body as FormData;
    expect(form.get('image')).toBeInstanceOf(Blob);
    expect(form.get('output_height')).toBe('1080');
  });

  test('status, download, and cancel use process_id paths from the schema', async () => {
    const captured = installFetchMock(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const api = client();

    await api.listStatuses({ paginated: true, limit: 25, cursor: 'cursor-1' });
    await api.getStatus('process-1');
    await api.deleteStatus('process-1');
    await api.deleteAllStatuses();
    await api.getDownloadOutput('process-1');
    await api.getDownloadInput('process-1');
    await api.cancel('process-1');

    expect(captured.map(req => [req.method, req.url.pathname])).toEqual([
      ['GET', '/image/v1/status'],
      ['GET', '/image/v1/status/process-1'],
      ['DELETE', '/image/v1/status/process-1'],
      ['DELETE', '/image/v1/status'],
      ['GET', '/image/v1/download/process-1'],
      ['GET', '/image/v1/download/input/process-1'],
      ['DELETE', '/image/v1/cancel/process-1'],
    ]);
    expect(Object.fromEntries(captured[0]!.url.searchParams.entries())).toEqual({
      paginated: 'true',
      limit: '25',
      cursor: 'cursor-1',
    });
  });

  test('estimate uses multipart and estimateBulk uses the JSON schema endpoint', async () => {
    const captured = installFetchMock();
    const api = client();

    await api.estimate({
      category: 'Enhance',
      inputHeight: 720,
      inputWidth: 1280,
      outputFormat: 'jpeg',
    });
    await api.estimateGenerative({
      category: 'Enhance',
      inputHeight: 720,
      inputWidth: 1280,
      model: 'Redefine',
    });
    await api.estimateBulk([
      { category: 'Enhance', inputHeight: 720, inputWidth: 1280, outputWidth: 1920 },
    ]);

    expectTopazRequest(captured[0]!, '/estimate', 'POST');
    expect(captured[0]!.headers.get('Content-Type')).toBeNull();
    expect(formEntries(captured[0]!.body).input_height).toBe('720');
    expectTopazRequest(captured[1]!, '/estimate-gen', 'POST');
    expect(captured[1]!.headers.get('Content-Type')).toBeNull();
    expect(formEntries(captured[1]!.body).model).toBe('Redefine');
    expectTopazRequest(captured[2]!, '/estimate-bulk', 'POST');
    expect(captured[2]!.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(captured[2]!.body as string)).toEqual([
      {
        category: 'Enhance',
        input_height: 720,
        input_width: 1280,
        output_width: 1920,
      },
    ]);
  });

  test('required inputs reject before fetching', async () => {
    const captured = installFetchMock();
    await expect(client().enhance({})).rejects.toThrow('Topaz Labs: image, sourceUrl, or sourceId is required');
    await expect(client().enhance({ sourceUrl: '   ' })).rejects.toThrow('Topaz Labs: sourceUrl is required');
    await expect(client().getStatus('   ')).rejects.toThrow('Topaz Labs: processId is required');
    await expect(client().estimate({ inputHeight: Number.NaN, inputWidth: 100 })).rejects.toThrow('Topaz Labs: inputHeight is required');
    await expect(client().estimateBulk([])).rejects.toThrow('Topaz Labs: items is required');
    expect(captured).toHaveLength(0);
  });

  test('fromEnv requires TOPAZ_LABS_API_KEY', () => {
    const prevTopaz = process.env.TOPAZ_LABS_API_KEY;
    const prevGeneric = process.env.CONNECTOR_API_KEY;
    delete process.env.TOPAZ_LABS_API_KEY;
    delete process.env.CONNECTOR_API_KEY;
    expect(() => TopazLabs.fromEnv()).toThrow('TOPAZ_LABS_API_KEY is required');
    if (prevTopaz) process.env.TOPAZ_LABS_API_KEY = prevTopaz;
    if (prevGeneric) process.env.CONNECTOR_API_KEY = prevGeneric;
  });

  test('non-2xx responses surface error message', async () => {
    installFetchMock(new Response(JSON.stringify({ message: 'bad request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(client().getStatus('process-1')).rejects.toThrow('bad request');
  });

  test('retries on 5xx then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: 'server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ process_id: 'process-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client().getStatus('process-1');
    expect(result).toMatchObject({ process_id: 'process-1' });
    expect(calls).toBeGreaterThan(1);
  });
});

describe('TopazLabsApiError', () => {
  test('identifies rate limit and auth errors', () => {
    const rate = new TopazLabsApiError('rate limited', 429);
    expect(rate.isRateLimited()).toBe(true);
    expect(rate.isAuthError()).toBe(false);
    const auth = new TopazLabsApiError('unauthorized', 401);
    expect(auth.isAuthError()).toBe(true);
  });
});
