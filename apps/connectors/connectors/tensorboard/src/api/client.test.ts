import { afterEach, describe, expect, test } from 'bun:test';
import { TensorBoard } from './index';
import { TensorBoardClient } from './client';
import { TensorBoardApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
}

function installFetch(
  handler: (url: string) => { ok?: boolean; status?: number; statusText?: string; json?: unknown },
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({ url, method: init?.method ?? 'GET' });
    const res = handler(url);
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      statusText: res.statusText ?? 'OK',
      async json() {
        return res.json ?? {};
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TensorBoardClient transport', () => {
  test('strips trailing slashes from the base URL', () => {
    const client = new TensorBoardClient({ baseUrl: 'http://localhost:6006///' });
    expect(client.baseUrl).toBe('http://localhost:6006');
  });

  test('defaults to localhost:6006 when no base URL is given', () => {
    const client = new TensorBoardClient();
    expect(client.baseUrl).toBe('http://localhost:6006');
  });

  test('listRuns hits /data/runs and sorts the result', async () => {
    const recorded = installFetch(() => ({ json: ['train', 'eval'] }));
    const tb = new TensorBoard({ baseUrl: 'http://localhost:6006' });
    const runs = await tb.listRuns();
    expect(recorded[0].url).toBe('http://localhost:6006/data/runs');
    expect(runs).toEqual([{ name: 'eval' }, { name: 'train' }]);
  });

  test('listScalarTags flattens the run→tag object with metadata', async () => {
    installFetch(() => ({
      json: {
        train: { loss: { displayName: 'Loss', description: 'training loss' }, acc: {} },
        eval: { loss: {} },
      },
    }));
    const tb = new TensorBoard({ baseUrl: 'http://localhost:6006' });
    const tags = await tb.listScalarTags();
    expect(tags).toContainEqual({ run: 'train', tag: 'loss', displayName: 'Loss', description: 'training loss' });
    expect(tags).toContainEqual({ run: 'train', tag: 'acc', displayName: undefined, description: undefined });
    expect(tags.length).toBe(3);
  });

  test('listScalarTags filters to a single run and supports array tag lists', async () => {
    installFetch(() => ({ json: { train: ['loss', 'acc'], eval: ['loss'] } }));
    const tb = new TensorBoard({ baseUrl: 'http://localhost:6006' });
    const tags = await tb.listScalarTags('train');
    expect(tags).toEqual([
      { run: 'train', tag: 'loss' },
      { run: 'train', tag: 'acc' },
    ]);
  });

  test('getScalars builds the run/tag query and normalizes tuples', async () => {
    const recorded = installFetch(() => ({ json: [[1700000000, 0, 2.5], [1700000010, 1, 1.2]] }));
    const tb = new TensorBoard({ baseUrl: 'http://localhost:6006' });
    const points = await tb.getScalars('train', 'loss');
    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/data/plugin/scalars/scalars');
    expect(url.searchParams.get('run')).toBe('train');
    expect(url.searchParams.get('tag')).toBe('loss');
    expect(points).toEqual([
      { wallTime: 1700000000, step: 0, value: 2.5 },
      { wallTime: 1700000010, step: 1, value: 1.2 },
    ]);
  });

  test('preserves a base URL sub-path when joining endpoints', async () => {
    const recorded = installFetch(() => ({ json: [] }));
    const tb = new TensorBoard({ baseUrl: 'http://host/proxy/tb' });
    await tb.listRuns();
    expect(recorded[0].url).toBe('http://host/proxy/tb/data/runs');
  });

  test('throws TensorBoardApiError with status on a non-ok response', async () => {
    installFetch(() => ({ ok: false, status: 404, statusText: 'Not Found' }));
    const tb = new TensorBoard({ baseUrl: 'http://localhost:6006' });
    let caught: unknown;
    try {
      await tb.listRuns();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TensorBoardApiError);
    expect((caught as TensorBoardApiError).statusCode).toBe(404);
  });
});
