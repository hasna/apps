import { describe, expect, test } from 'bun:test';
import { formatOutput } from './output';

describe('formatOutput redaction', () => {
  const webhook = {
    id: 'we_123',
    object: 'webhook_endpoint',
    secret: 'whsec_test_secret_key_12345',
    metadata: {
      public: 'ok',
      apiToken: 'tok_test_secret',
    },
  };

  test('redacts sensitive fields in JSON output', () => {
    const output = formatOutput(webhook, 'json');
    const data = JSON.parse(output);

    expect(data.id).toBe('we_123');
    expect(data.secret).toBe('[REDACTED]');
    expect(data.metadata.public).toBe('ok');
    expect(data.metadata.apiToken).toBe('[REDACTED]');
    expect(output).not.toContain('whsec_test_secret_key_12345');
    expect(output).not.toContain('tok_test_secret');
  });

  test('redacts sensitive fields in pretty output', () => {
    const output = formatOutput(webhook, 'pretty');

    expect(output).toContain('we_123');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('whsec_test_secret_key_12345');
  });

  test('redacts sensitive fields in table output', () => {
    const output = formatOutput([webhook], 'table');

    expect(output).toContain('we_123');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('whsec_test_secret_key_12345');
  });
});
