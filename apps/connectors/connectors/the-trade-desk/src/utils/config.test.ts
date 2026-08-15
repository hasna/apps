import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { formatCredentialStatus, writePrivateFile } from './config';

describe('config security helpers', () => {
  test('writePrivateFile creates owner-only files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ttd-config-'));
    try {
      const path = join(dir, 'profile.json');
      writePrivateFile(path, JSON.stringify({ apiKey: 'secret-token' }));

      expect(readFileSync(path, 'utf-8')).toContain('secret-token');
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('formatCredentialStatus never exposes credential prefixes', () => {
    expect(formatCredentialStatus(undefined)).toBe('not set');
    expect(formatCredentialStatus('secret-token-value')).toBe('set (hidden)');
  });
});
