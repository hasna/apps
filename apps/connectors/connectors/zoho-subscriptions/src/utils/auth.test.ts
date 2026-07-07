import { describe, expect, test } from 'bun:test';
import { resolveAccountsBaseUrl, resolveAuthUrl, resolveTokenUrl } from './auth';

describe('Zoho Subscriptions OAuth endpoints', () => {
  test('resolves Zoho Accounts endpoints for supported data centers', () => {
    expect(resolveAccountsBaseUrl('com')).toBe('https://accounts.zoho.com');
    expect(resolveAccountsBaseUrl('eu')).toBe('https://accounts.zoho.eu');
    expect(resolveAccountsBaseUrl('ca')).toBe('https://accounts.zohocloud.ca');
    expect(resolveAccountsBaseUrl('uk')).toBe('https://accounts.zoho.uk');
  });

  test('builds OAuth authorize and token URLs', () => {
    expect(resolveAuthUrl('in')).toBe('https://accounts.zoho.in/oauth/v2/auth');
    expect(resolveTokenUrl('com.au')).toBe('https://accounts.zoho.com.au/oauth/v2/token');
  });

  test('rejects unsupported data centers', () => {
    expect(() => resolveAccountsBaseUrl('invalid')).toThrow('data_center must be one of');
  });
});
