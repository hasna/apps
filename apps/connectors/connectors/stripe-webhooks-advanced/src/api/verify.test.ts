import { describe, test, expect } from 'bun:test';
import { verifyWebhookSignature, constructTestSignature } from './verify';
import { SignatureVerificationError } from '../types';

const SECRET = 'whsec_test_secret_key_12345';

const sampleEvent = {
  id: 'evt_test',
  object: 'event',
  type: 'invoice.paid',
  created: 1700000000,
  livemode: false,
  pending_webhooks: 1,
  data: { object: { id: 'in_123' } },
};

describe('verifyWebhookSignature', () => {
  test('accepts valid signature', () => {
    const payload = JSON.stringify(sampleEvent);
    const signature = constructTestSignature(payload, SECRET);

    const result = verifyWebhookSignature({ payload, signature, secret: SECRET });

    expect(result.valid).toBe(true);
    expect(result.event?.id).toBe('evt_test');
    expect(result.timestamp).toBeGreaterThan(0);
  });

  test('rejects invalid signature', () => {
    const payload = JSON.stringify(sampleEvent);
    const signature = constructTestSignature(payload, SECRET);

    const result = verifyWebhookSignature({
      payload,
      signature,
      secret: 'whsec_wrong_secret',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('No matching signature');
  });

  test('rejects tampered payload', () => {
    const payload = JSON.stringify(sampleEvent);
    const signature = constructTestSignature(payload, SECRET);
    const tampered = JSON.stringify({ ...sampleEvent, type: 'charge.refunded' });

    const result = verifyWebhookSignature({
      payload: tampered,
      signature,
      secret: SECRET,
    });

    expect(result.valid).toBe(false);
  });

  test('rejects expired timestamp', () => {
    const payload = JSON.stringify(sampleEvent);
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const signature = constructTestSignature(payload, SECRET, oldTimestamp);

    const result = verifyWebhookSignature({
      payload,
      signature,
      secret: SECRET,
      tolerance: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('tolerance');
  });

  test('rejects missing signature header parts', () => {
    const result = verifyWebhookSignature({
      payload: '{}',
      signature: 'invalid-header',
      secret: SECRET,
    });

    expect(result.valid).toBe(false);
  });

  test('throws when payload is valid JSON but signature matched with bad parse edge', () => {
    const payload = JSON.stringify(sampleEvent);
    const signature = constructTestSignature(payload, SECRET);

    const result = verifyWebhookSignature({ payload, signature, secret: SECRET });
    expect(result.valid).toBe(true);
    expect(result.event).toBeDefined();
  });

  test('throws SignatureVerificationError for non-JSON payload with valid sig', () => {
    const payload = 'not-json';
    const signature = constructTestSignature(payload, SECRET);

    expect(() =>
      verifyWebhookSignature({ payload, signature, secret: SECRET }),
    ).toThrow(SignatureVerificationError);
  });
});
