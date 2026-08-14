import { afterEach, describe, expect, test } from 'bun:test';
import { StrandAI } from './index';
import { StrandClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
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
      async text() {
        return JSON.stringify(json ?? {});
      },
      async arrayBuffer() {
        return new TextEncoder().encode(JSON.stringify(json ?? {})).buffer;
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('StrandClient', () => {
  test('requires API key', () => {
    expect(() => new StrandClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('sends Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ uploads: [], nextCursor: null }));
    const client = new StrandClient({ apiKey: 'sk-strand-test-key-12345' });
    await client.get('/uploads');
    expect(recorded[0].headers.Authorization).toBe('Bearer sk-strand-test-key-12345');
    expect(recorded[0].url).toContain('/uploads');
    expect(recorded[0].method).toBe('GET');
  });

  test('uses custom base URL', async () => {
    const recorded = installFetch(() => ({ uploads: [] }));
    const client = new StrandClient({
      apiKey: 'sk-strand-test',
      baseUrl: 'https://custom.example.com/api/v1/',
    });
    await client.get('/uploads');
    expect(recorded[0].url).toBe('https://custom.example.com/api/v1/uploads');
  });
});

describe('StrandAI API', () => {
  test('listUploads returns upload list', async () => {
    installFetch((url) => {
      if (url.includes('/uploads') && !url.includes('/complete')) {
        return {
          uploads: [{ id: 'u1', filename: 'slide.svs', fileSize: '1000', status: 'ready', gcsPath: 'gcs://x' }],
          nextCursor: null,
        };
      }
      return {};
    });
    const strand = new StrandAI({ apiKey: 'sk-strand-test' });
    const result = await strand.listUploads();
    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0].filename).toBe('slide.svs');
  });

  test('estimatePrediction posts uploadId and markers', async () => {
    const recorded = installFetch((url) => {
      if (url.endsWith('/predict/estimate')) {
        return { patchCount: 10, markerCount: 2, estimatedCredits: 5, orgBalance: 100, orgPending: 0 };
      }
      return {};
    });
    const strand = new StrandAI({ apiKey: 'sk-strand-test' });
    const result = await strand.estimatePrediction({
      uploadId: '550e8400-e29b-41d4-a716-446655440000',
      markers: ['CD3', 'CD8'],
    });
    expect(result.estimatedCredits).toBe(5);
    const call = recorded.find((r) => r.url.includes('/predict/estimate'))!;
    const body = JSON.parse(call.body!);
    expect(body.markers).toEqual(['CD3', 'CD8']);
    expect(body.uploadId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  test('submitPrediction posts to /predict', async () => {
    const recorded = installFetch((url) => {
      if (url.endsWith('/predict') && !url.includes('estimate')) {
        return { jobId: 'job-1', reservedCredits: 5, status: 'queued' };
      }
      return {};
    });
    const strand = new StrandAI({ apiKey: 'sk-strand-test' });
    const result = await strand.submitPrediction({
      uploadId: '550e8400-e29b-41d4-a716-446655440000',
      markers: ['CD3'],
    });
    expect(result.jobId).toBe('job-1');
    expect(result.status).toBe('queued');
    const call = recorded.find((r) => r.url.endsWith('/predict'))!;
    expect(call.method).toBe('POST');
  });

  test('getJob fetches job by id', async () => {
    installFetch((url) => {
      if (url.includes('/jobs/job-abc')) {
        return { id: 'job-abc', status: 'completed', markers: ['CD3'], resultsAvailable: true };
      }
      return {};
    });
    const strand = new StrandAI({ apiKey: 'sk-strand-test' });
    const job = await strand.getJob('job-abc');
    expect(job.status).toBe('completed');
    expect(job.resultsAvailable).toBe(true);
  });
});
