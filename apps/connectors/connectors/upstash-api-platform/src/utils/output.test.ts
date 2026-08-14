import { describe, expect, test } from 'bun:test';
import { formatOutput } from './output';

describe('output redaction', () => {
  test('redacts secret-like response fields by default', () => {
    const output = formatOutput(
      {
        id: 'idx_123',
        token: 'vector-write-token',
        read_only_token: 'vector-read-token',
        nested: { apiKey: 'management-key' },
      },
      'json',
    );

    expect(output).toContain('"token": "[redacted]"');
    expect(output).toContain('"read_only_token": "[redacted]"');
    expect(output).toContain('"apiKey": "[redacted]"');
    expect(output).not.toContain('vector-write-token');
    expect(output).not.toContain('management-key');
  });

  test('can explicitly include secret fields', () => {
    const output = formatOutput({ token: 'vector-write-token' }, 'json', { redactSecrets: false });

    expect(output).toContain('vector-write-token');
  });
});
