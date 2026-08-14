import { describe, expect, test } from 'bun:test';
import { resolveAccountsBaseUrl } from './auth';

describe('Zoho Recruit OAuth account host resolution', () => {
  test('defaults to the US/com accounts host', () => {
    expect(resolveAccountsBaseUrl('com')).toBe('https://accounts.zoho.com');
  });

  test('resolves regional account hosts', () => {
    expect(resolveAccountsBaseUrl('eu')).toBe('https://accounts.zoho.eu');
    expect(resolveAccountsBaseUrl('in')).toBe('https://accounts.zoho.in');
    expect(resolveAccountsBaseUrl('ca')).toBe('https://accounts.zohocloud.ca');
  });

  test('rejects unknown data centers', () => {
    expect(() => resolveAccountsBaseUrl('invalid')).toThrow('accounts data_center must be one of');
  });
});
