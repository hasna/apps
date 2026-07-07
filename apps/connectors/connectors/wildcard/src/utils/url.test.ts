import { describe, expect, test } from 'bun:test';
import { validateHttpsUrl } from '../utils/url';
import { apiPath } from '../utils/args';

describe('url validation', () => {
  test('accepts HTTPS URLs', () => {
    expect(validateHttpsUrl('https://api.example.com/v1', 'url')).toBe('https://api.example.com/v1');
  });

  test('rejects non-HTTPS URLs', () => {
    expect(() => validateHttpsUrl('http://api.example.com', 'url')).toThrow('must use HTTPS');
  });

  test('apiPath rejects absolute URLs', () => {
    expect(() => apiPath('https://evil.example.com/path')).toThrow('relative API path');
  });

  test('apiPath normalizes relative paths', () => {
    expect(apiPath('search')).toBe('/search');
    expect(apiPath('/search')).toBe('/search');
  });
});
