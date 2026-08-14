import { describe, expect, test } from 'bun:test';
import { parseOptionalIntegerOption } from '../utils/parse';

describe('Zapier API Platform CLI', () => {
  test('parses optional integer options', () => {
    expect(parseOptionalIntegerOption(undefined, '--limit')).toBeUndefined();
    expect(parseOptionalIntegerOption('0', '--limit')).toBe(0);
    expect(parseOptionalIntegerOption('25', '--offset')).toBe(25);
  });

  test('rejects invalid integer options before sending API requests', () => {
    expect(() => parseOptionalIntegerOption('abc', '--limit')).toThrow('--limit must be a non-negative integer');
    expect(() => parseOptionalIntegerOption('1.5', '--limit')).toThrow('--limit must be a non-negative integer');
    expect(() => parseOptionalIntegerOption('-1', '--offset')).toThrow('--offset must be a non-negative integer');
  });
});
