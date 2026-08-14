import { describe, expect, test } from 'bun:test';
import { getAuthorizationEndpoint, getTokenEndpoint, resolveAccountsBaseUrl } from './auth';

describe('Zoho Projects OAuth endpoints', () => {
  test('uses regional accounts endpoints for supported data centers', () => {
    expect(getAuthorizationEndpoint('com')).toBe('https://accounts.zoho.com/oauth/v2/auth');
    expect(getTokenEndpoint('eu')).toBe('https://accounts.zoho.eu/oauth/v2/token');
    expect(getTokenEndpoint('in')).toBe('https://accounts.zoho.in/oauth/v2/token');
    expect(getTokenEndpoint('com.au')).toBe('https://accounts.zoho.com.au/oauth/v2/token');
    expect(getTokenEndpoint('jp')).toBe('https://accounts.zoho.jp/oauth/v2/token');
    expect(getTokenEndpoint('ca')).toBe('https://accounts.zohocloud.ca/oauth/v2/token');
    expect(getTokenEndpoint('sa')).toBe('https://accounts.zoho.sa/oauth/v2/token');
  });

  test('rejects unsupported data centers', () => {
    expect(() => resolveAccountsBaseUrl('invalid')).toThrow('Invalid data center "invalid"');
  });
});
