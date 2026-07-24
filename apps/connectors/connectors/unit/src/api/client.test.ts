import { describe, expect, test } from 'bun:test';
import { buildQuery, jsonApiBody } from './client';

describe('buildQuery', () => {
  test('returns empty string for empty params', () => {
    expect(buildQuery({})).toBe('');
  });

  test('serializes scalar filters', () => {
    expect(buildQuery({ 'filter[customerId]': 'cust-1', 'page[limit]': 25 })).toBe(
      '?filter%5BcustomerId%5D=cust-1&page%5Blimit%5D=25',
    );
  });

  test('appends array filter values with repeated keys', () => {
    const qs = buildQuery({ 'filter[status][]': ['Open', 'Frozen'] });
    expect(qs).toContain('filter%5Bstatus%5D%5B%5D=Open');
    expect(qs).toContain('filter%5Bstatus%5D%5B%5D=Frozen');
  });

  test('skips undefined and empty string values', () => {
    expect(buildQuery({ a: undefined, b: '', c: 'ok' })).toBe('?c=ok');
  });
});

describe('jsonApiBody', () => {
  test('builds attributes-only envelope', () => {
    expect(jsonApiBody('depositAccount', { depositProduct: 'checking' })).toEqual({
      data: {
        type: 'depositAccount',
        attributes: { depositProduct: 'checking' },
      },
    });
  });

  test('includes relationships when provided', () => {
    const body = jsonApiBody(
      'depositAccount',
      { depositProduct: 'checking' },
      { customer: { data: { type: 'customer', id: '123' } } },
    );
    expect(body.data.relationships).toEqual({
      customer: { data: { type: 'customer', id: '123' } },
    });
  });
});
