import { describe, expect, mock, test } from 'bun:test';
import { StitchClient } from './client';
import { StreamsApi } from './streams';

describe('StreamsApi', () => {
  test('updates stream metadata with Stitch Connect metadata patch arrays', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[]'),
      } as Response),
    );
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const streams = new StreamsApi(new StitchClient({ accessToken: 'stitch-token-abcdef123456' }));
      await streams.updateMetadata(123, [
        {
          tap_stream_id: 'orders',
          metadata: [
            {
              breadcrumb: [],
              metadata: { selected: true },
            },
          ],
        },
      ]);

      const [, options] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit & { body: string; headers: Record<string, string> },
      ];
      expect(options.method).toBe('PUT');
      expect(JSON.parse(options.body)).toEqual({
        streams: [
          {
            tap_stream_id: 'orders',
            metadata: [
              {
                breadcrumb: [],
                metadata: { selected: true },
              },
            ],
          },
        ],
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
