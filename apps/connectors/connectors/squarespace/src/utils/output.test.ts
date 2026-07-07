import { describe, expect, test } from 'bun:test';
import { formatOutput } from './output';

describe('output redaction', () => {
  test('redacts nested sensitive fields in json output', () => {
    const output = formatOutput(
      {
        apiKey: 'sqsp-secret',
        nested: {
          accessToken: 'token-secret',
          value: 'visible',
        },
      },
      'json',
    );

    expect(output).toContain('[REDACTED]');
    expect(output).toContain('visible');
    expect(output).not.toContain('sqsp-secret');
    expect(output).not.toContain('token-secret');
  });
});
