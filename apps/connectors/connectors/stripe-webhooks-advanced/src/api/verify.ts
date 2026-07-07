import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Event, VerifyOptions, VerifyResult } from '../types';
import { SignatureVerificationError } from '../types';

const DEFAULT_TOLERANCE_SECONDS = 300;

interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

function parseSignatureHeader(header: string): ParsedSignatureHeader {
  const timestamp = 0;
  const signatures: string[] = [];
  let parsedTimestamp = timestamp;

  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (!key || value === undefined) continue;
    if (key.trim() === 't') {
      parsedTimestamp = Number.parseInt(value, 10);
    }
    if (key.trim() === 'v1') {
      signatures.push(value);
    }
  }

  return { timestamp: parsedTimestamp, signatures };
}

function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function computeSignature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verify a Stripe webhook signature locally (no network call).
 * https://docs.stripe.com/webhooks/signatures
 */
export function verifyWebhookSignature(options: VerifyOptions): VerifyResult {
  const { payload, signature, secret, tolerance = DEFAULT_TOLERANCE_SECONDS } = options;

  if (!payload) {
    return { valid: false, error: 'Payload is required' };
  }
  if (!signature) {
    return { valid: false, error: 'Stripe-Signature header is required' };
  }
  if (!secret) {
    return { valid: false, error: 'Webhook signing secret is required' };
  }

  const { timestamp, signatures } = parseSignatureHeader(signature);

  if (!timestamp || Number.isNaN(timestamp)) {
    return { valid: false, error: 'Unable to parse timestamp from signature header' };
  }
  if (signatures.length === 0) {
    return { valid: false, error: 'No v1 signatures found in header' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    return { valid: false, error: 'Timestamp outside the tolerance window', timestamp };
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = computeSignature(secret, signedPayload);
  const valid = signatures.some((sig) => secureCompare(sig, expected));

  if (!valid) {
    return { valid: false, error: 'No matching signature found', timestamp };
  }

  let event: Event;
  try {
    event = JSON.parse(payload) as Event;
  } catch {
    throw new SignatureVerificationError('Signature valid but payload is not valid JSON');
  }

  return { valid: true, event, timestamp };
}

/**
 * Construct a Stripe-Signature header for testing (generates v1 HMAC).
 */
export function constructTestSignature(
  payload: string,
  secret: string,
  timestamp?: number,
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${payload}`;
  const signature = computeSignature(secret, signedPayload);
  return `t=${ts},v1=${signature}`;
}
