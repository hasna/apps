import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Telegram } from './index';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Telegram files API', () => {
  test('resolves a file ID and downloads its bytes from the authenticated file URL', async () => {
    const botToken = '123456:test-token';
    const fetchMock = mock(async (
      input: string | URL | Request,
      _init?: RequestInit
    ) => {
      const url = String(input);
      if (url.endsWith('/getFile')) {
        return Response.json({
          ok: true,
          result: {
            file_id: 'incoming-file-id',
            file_unique_id: 'unique-file-id',
            file_size: 4,
            file_path: 'documents/report 1.pdf',
          },
        });
      }

      return new Response(new Uint8Array([1, 2, 3, 4]));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telegram = new Telegram({ botToken });
    const downloaded = await telegram.bot.downloadFile({
      fileId: 'incoming-file-id',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://api.telegram.org/bot${botToken}/getFile`
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      file_id: 'incoming-file-id',
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `https://api.telegram.org/file/bot${botToken}/documents/report%201.pdf`
    );
    expect(downloaded.file.file_path).toBe('documents/report 1.pdf');
    expect(downloaded.data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  test('fails explicitly when Telegram does not return a file path', async () => {
    const fetchMock = mock(async () =>
      Response.json({
        ok: true,
        result: {
          file_id: 'incoming-file-id',
          file_unique_id: 'unique-file-id',
        },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telegram = new Telegram({ botToken: '123456:test-token' });

    expect(
      telegram.bot.downloadFile({ fileId: 'incoming-file-id' })
    ).rejects.toThrow('Telegram did not return a downloadable file path');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not expose the bot token in download errors', async () => {
    const botToken = '123456:must-not-leak';
    const fetchMock = mock(async (
      input: string | URL | Request,
      _init?: RequestInit
    ) => {
      if (String(input).endsWith('/getFile')) {
        return Response.json({
          ok: true,
          result: {
            file_id: 'incoming-file-id',
            file_unique_id: 'unique-file-id',
            file_path: 'photos/file.jpg',
          },
        });
      }
      return new Response('not found', { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telegram = new Telegram({ botToken });

    try {
      await telegram.bot.downloadFile({ fileId: 'incoming-file-id' });
      throw new Error('Expected download to fail');
    } catch (err) {
      expect(String(err)).toContain('Telegram file download failed');
      expect(String(err)).not.toContain(botToken);
    }
  });
});
