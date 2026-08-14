import { describe, expect, test } from 'bun:test';
import { buildQuery, resolveBaseUrl, ZohoCampaignsClient } from './client';

describe('ZohoCampaignsClient URL resolution', () => {
  test('resolveBaseUrl defaults to US data center', () => {
    expect(resolveBaseUrl({})).toBe('https://campaigns.zoho.com');
  });

  test('resolveBaseUrl maps EU data center', () => {
    expect(resolveBaseUrl({ dataCenter: 'eu' })).toBe('https://campaigns.zoho.eu');
  });

  test('resolveBaseUrl honors custom baseUrl override', () => {
    expect(resolveBaseUrl({ baseUrl: 'https://campaigns.zoho.in/' })).toBe('https://campaigns.zoho.in');
  });

  test('resolveBaseUrl rejects unknown data center', () => {
    expect(() => resolveBaseUrl({ dataCenter: 'invalid' })).toThrow(/data center/i);
  });

  test('buildQuery always includes resfmt=JSON', () => {
    expect(buildQuery({ listkey: 'abc' })).toBe('?listkey=abc&resfmt=JSON');
    expect(buildQuery()).toBe('?resfmt=JSON');
  });

  test('buildQuery skips empty values', () => {
    expect(buildQuery({ listkey: 'abc', status: '' })).toBe('?listkey=abc&resfmt=JSON');
  });

  test('client getBaseUrl includes API version path', () => {
    const client = new ZohoCampaignsClient({ token: 'test-token', dataCenter: 'com' });
    expect(client.getBaseUrl()).toBe('https://campaigns.zoho.com/api/v1.1');
  });
});
