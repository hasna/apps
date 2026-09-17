import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveNoteWriteRateLimitMax, NOTE_WRITE_RATE_LIMIT_WINDOW_MS, NoteWriteRateLimitConfigurationError } from './write-rate-config.mjs';

describe('note write configuration', () => {
  test('uses a minute window and accepts finite default and explicit budgets', () => {
    expect(NOTE_WRITE_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    for (const value of [undefined, '', ' ']) expect(resolveNoteWriteRateLimitMax(value)).toBe(12_000);
    for (const [value, expected] of [['1', 1], [' 005 ', 5], ['60000', 60_000], ['1000000', 1_000_000]]) {
      expect(resolveNoteWriteRateLimitMax(value)).toBe(expected);
    }
  });

  test('rejects malformed and unbounded budgets without reflecting configuration', () => {
    for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '1e4', '300junk', '+5', '1000001', '9007199254740993']) {
      let failure;
      try { resolveNoteWriteRateLimitMax(value); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(NoteWriteRateLimitConfigurationError);
      expect(failure.message).toBe('HASNA_NOTES_SERVER_NOTE_WRITE_RATE_LIMIT_MAX must be an integer from 1 to 1000000.');
    }
  });

  test('the ordinary server rejects a bad budget before opening PostgreSQL or listening', async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'index.mjs')], {
      env: { PATH: process.env.PATH, HASNA_NOTES_SERVER_NOTE_WRITE_RATE_LIMIT_MAX: 'NaN' },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(code).toBe(1);
    expect(stdout).not.toContain('listening');
    expect(stderr.trim()).toBe('notes-server: HASNA_NOTES_SERVER_NOTE_WRITE_RATE_LIMIT_MAX must be an integer from 1 to 1000000.');
  }, 20_000);
});
