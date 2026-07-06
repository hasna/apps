import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TopazLabs, TopazLabsClient } from './index';
import { TopazLabsApiError } from '../types';

const realFetch = globalThis.fetch;
const mockApiKey = 'topaz-key';
const imageUrl = 'https://assets.example.com/in.jpg';

type CapturedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
};

type CommandCase = {
  method: keyof TopazLabs;
  args?: unknown[];
  path: string;
  httpMethod?: string;
  query?: Record<string, string>;
  body?: unknown;
};

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

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
      body: parseBody(init?.body),
    });
    if (response) return response.clone();
    return new Response(JSON.stringify({ id: 'job-1', status: 'queued' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return captured;
}

function expectTopazRequest(request: CapturedRequest, commandCase: CommandCase) {
  expect(request.url.origin).toBe('https://api.topazlabs.com');
  expect(request.url.pathname).toBe(`/image/v1${commandCase.path}`);
  expect(request.method).toBe(commandCase.httpMethod ?? 'GET');
  expect(request.headers.get('Accept')).toBe('application/json');
  expect(request.headers.get('X-API-Key')).toBe(mockApiKey);
  if (commandCase.body !== undefined) {
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.body).toEqual(commandCase.body);
  } else {
    expect(request.body).toBeUndefined();
  }
  expect(Object.fromEntries(request.url.searchParams.entries())).toEqual(commandCase.query ?? {});
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
    const c = new TopazLabsClient({ apiKey: 'abcdefghijklmnop' });
    expect(c.getApiKeyPreview()).toBe('abcdef...mnop');
  });
});

describe('TopazLabs API', () => {
  test('calls every endpoint with expected paths, methods, queries, and bodies', async () => {
    const captured = installFetchMock();
    const api = client();
    const cases: CommandCase[] = [
      {
        method: 'enhance',
        args: [{
          imageUrl,
          outputFormat: 'png',
          outputQuality: 95,
          outputColorSpace: 'srgb',
          outputBitDepth: 16,
          model: 'Standard V2',
          faceDetection: 'auto',
          faceDetectionParent: 'subject',
          subjectDetection: 'product',
          faceCreativity: 0.3,
          faceOption: 'recover',
          sharpen: 30,
          denoise: 20,
          deblur: 10,
          lighting: 5,
          colorEnhancement: 8,
          sceneType: 'product',
          preset: 'preset-1',
          outputWidth: 2000,
          outputHeight: 1200,
          outputResolution: 300,
          ipi: true,
          tags: ['catalog'],
        }],
        path: '/enhance',
        httpMethod: 'POST',
        body: {
          image_url: imageUrl,
          output_format: 'png',
          output_quality: 95,
          output_color_space: 'srgb',
          output_bit_depth: 16,
          model: 'Standard V2',
          face_detection: 'auto',
          face_detection_parent: 'subject',
          subject_detection: 'product',
          face_creativity: 0.3,
          face_option: 'recover',
          sharpen: 30,
          denoise: 20,
          deblur: 10,
          lighting: 5,
          color_enhancement: 8,
          scene_type: 'product',
          preset: 'preset-1',
          output_width: 2000,
          output_height: 1200,
          output_resolution: 300,
          ipi: true,
          tags: ['catalog'],
        },
      },
      { method: 'upscale', args: [{ imageUrl, scale: 4, model: 'standard', outputFormat: 'jpg', outputQuality: 90 }], path: '/upscale', httpMethod: 'POST', body: { image_url: imageUrl, scale: 4, model: 'standard', output_format: 'jpg', output_quality: 90 } },
      { method: 'sharpen', args: [{ imageUrl, model: 'lens-blur', sharpenAmount: 30, outputFormat: 'png' }], path: '/sharpen', httpMethod: 'POST', body: { image_url: imageUrl, model: 'lens-blur', sharpen_amount: 30, output_format: 'png' } },
      { method: 'denoise', args: [{ imageUrl, model: 'low_light', strength: 0.7, outputFormat: 'png' }], path: '/denoise', httpMethod: 'POST', body: { image_url: imageUrl, model: 'low_light', strength: 0.7, output_format: 'png' } },
      { method: 'restore', args: [{ imageUrl, restorationStrength: 0.8, recoverFaces: true, outputFormat: 'png' }], path: '/restore', httpMethod: 'POST', body: { image_url: imageUrl, restoration_strength: 0.8, recover_faces: true, output_format: 'png' } },
      { method: 'generativeUpscale', args: [{ imageUrl, scale: 4, prompt: 'clean product edges', creativity: 0.4, outputFormat: 'png' }], path: '/generative-upscale', httpMethod: 'POST', body: { image_url: imageUrl, scale: 4, prompt: 'clean product edges', creativity: 0.4, output_format: 'png' } },
      { method: 'lighting', args: [{ imageUrl, strength: 0.5, relight: true, outputFormat: 'png' }], path: '/lighting', httpMethod: 'POST', body: { image_url: imageUrl, strength: 0.5, relight: true, output_format: 'png' } },
      { method: 'previewEnhance', args: [{ imageUrl, tile: { x: 1, y: 2, width: 100, height: 80 }, modelOverrides: { sharpen: 20 } }], path: '/enhance/preview', httpMethod: 'POST', body: { image_url: imageUrl, tile: { x: 1, y: 2, width: 100, height: 80 }, model_overrides: { sharpen: 20 } } },
      { method: 'batchSubmit', args: [{ items: [{ image_url: imageUrl, operation: 'enhance' }], preset: 'catalog', webhookUrl: 'https://example.com/hook' }], path: '/batch', httpMethod: 'POST', body: { items: [{ image_url: imageUrl, operation: 'enhance' }], preset: 'catalog', webhook_url: 'https://example.com/hook' } },
      { method: 'getJob', args: ['job-1'], path: '/jobs/job-1' },
      { method: 'listJobs', args: [{ status: 'completed', limit: 25, cursor: 'cursor-1' }], path: '/jobs', query: { status: 'completed', limit: '25', cursor: 'cursor-1' } },
      { method: 'cancelJob', args: ['job-1'], path: '/jobs/job-1/cancel', httpMethod: 'POST', body: {} },
      { method: 'deleteJob', args: ['job-1'], path: '/jobs/job-1', httpMethod: 'DELETE' },
      { method: 'listModels', args: [{ feature: 'enhance' }], path: '/models', query: { feature: 'enhance' } },
      { method: 'getModel', args: ['model-1'], path: '/models/model-1' },
      { method: 'listPresets', args: [{ feature: 'enhance' }], path: '/presets', query: { feature: 'enhance' } },
      { method: 'createPreset', args: [{ name: 'Catalog', feature: 'enhance', settings: { sharpen: 30 }, description: 'catalog defaults' }], path: '/presets', httpMethod: 'POST', body: { name: 'Catalog', feature: 'enhance', settings: { sharpen: 30 }, description: 'catalog defaults' } },
      { method: 'updatePreset', args: ['preset-1', { description: 'new' }], path: '/presets/preset-1', httpMethod: 'PATCH', body: { description: 'new' } },
      { method: 'deletePreset', args: ['preset-1'], path: '/presets/preset-1', httpMethod: 'DELETE' },
      { method: 'listTags', path: '/tags' },
      { method: 'createTag', args: ['catalog'], path: '/tags', httpMethod: 'POST', body: { name: 'catalog' } },
      { method: 'deleteTag', args: ['tag-1'], path: '/tags/tag-1', httpMethod: 'DELETE' },
      { method: 'createUploadUrl', args: [{ filename: 'input.jpg', contentType: 'image/jpeg' }], path: '/uploads', httpMethod: 'POST', body: { filename: 'input.jpg', content_type: 'image/jpeg' } },
      { method: 'getCredits', path: '/credits' },
      { method: 'getUsage', args: [{ from: '2026-01-01', to: '2026-01-31' }], path: '/usage', query: { from: '2026-01-01', to: '2026-01-31' } },
      { method: 'getAccount', path: '/account' },
      { method: 'listWebhooks', path: '/webhooks' },
      { method: 'createWebhook', args: [{ url: 'https://example.com/topaz-hook', events: ['job.completed'], secret: 'hook-secret', active: true }], path: '/webhooks', httpMethod: 'POST', body: { url: 'https://example.com/topaz-hook', events: ['job.completed'], secret: 'hook-secret', active: true } },
      { method: 'deleteWebhook', args: ['webhook-1'], path: '/webhooks/webhook-1', httpMethod: 'DELETE' },
    ];

    expect(cases).toHaveLength(29);
    for (const commandCase of cases) {
      const fn = api[commandCase.method].bind(api) as (...args: unknown[]) => Promise<unknown>;
      if (commandCase.args === undefined) {
        await fn();
      } else {
        await fn(...commandCase.args);
      }
    }

    expect(captured).toHaveLength(cases.length);
    cases.forEach((commandCase, index) => {
      expectTopazRequest(captured[index]!, commandCase);
    });
  });

  test('enhance sends X-API-Key and snake_case body', async () => {
    const captured = installFetchMock();
    await client().enhance({
      imageUrl: 'https://example.com/in.jpg',
      model: 'Standard V2',
      sharpen: 30,
    });
    const req = captured[0]!;
    expect(req.url.pathname).toBe('/image/v1/enhance');
    expect(req.method).toBe('POST');
    expect(req.headers.get('X-API-Key')).toBe(mockApiKey);
    expect(req.body).toEqual({
      image_url: 'https://example.com/in.jpg',
      model: 'Standard V2',
      sharpen: 30,
    });
  });

  test('batchSubmit requires non-empty items', async () => {
    installFetchMock();
    await expect(client().batchSubmit({ items: [] })).rejects.toThrow('Topaz Labs: items is required');
  });

  test('image operations reject blank imageUrl before fetching', async () => {
    const captured = installFetchMock();
    const methods = [
      'enhance',
      'upscale',
      'sharpen',
      'denoise',
      'restore',
      'generativeUpscale',
      'lighting',
      'previewEnhance',
    ] as const;
    for (const method of methods) {
      await expect(
        client()[method]({ imageUrl: '   ' } as never),
      ).rejects.toThrow('Topaz Labs: imageUrl is required');
    }
    expect(captured).toHaveLength(0);
  });

  test('optional query strings reject blanks before fetching', async () => {
    const captured = installFetchMock();
    await expect(client().listJobs({ cursor: '   ' })).rejects.toThrow('Topaz Labs: cursor is required');
    await expect(client().listPresets({ feature: '   ' })).rejects.toThrow('Topaz Labs: feature is required');
    await expect(client().getUsage({ from: '   ' })).rejects.toThrow('Topaz Labs: from is required');
    expect(captured).toHaveLength(0);
  });

  test('createWebhook requires non-empty events', async () => {
    installFetchMock();
    await expect(client().createWebhook({
      url: 'https://example.com/topaz-hook',
      events: [],
    })).rejects.toThrow('Topaz Labs: events is required');
  });

  test('fromEnv requires TOPAZ_LABS_API_KEY', () => {
    const prev = process.env.TOPAZ_LABS_API_KEY;
    delete process.env.TOPAZ_LABS_API_KEY;
    delete process.env.CONNECTOR_API_KEY;
    expect(() => TopazLabs.fromEnv()).toThrow('TOPAZ_LABS_API_KEY is required');
    if (prev) process.env.TOPAZ_LABS_API_KEY = prev;
  });

  test('non-2xx responses surface error message', async () => {
    installFetchMock(new Response(JSON.stringify({ message: 'bad request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(client().getCredits()).rejects.toThrow('bad request');
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
      return new Response(JSON.stringify({ balance: 100 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client().getCredits();
    expect(result).toEqual({ balance: 100 });
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
