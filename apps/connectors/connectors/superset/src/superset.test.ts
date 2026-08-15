import { describe, test, expect } from 'bun:test';
import { risonEncode, buildListQuery } from './utils/rison';
import { normalizeBaseUrl } from './utils/config';
import { SupersetApiError } from './types';
import { Superset } from './api';

describe('risonEncode', () => {
  test('encodes primitives', () => {
    expect(risonEncode(null)).toBe('!n');
    expect(risonEncode(true)).toBe('!t');
    expect(risonEncode(false)).toBe('!f');
    expect(risonEncode(42)).toBe('42');
    expect(risonEncode(-3.5)).toBe('-3.5');
  });

  test('quotes strings', () => {
    expect(risonEncode('hello')).toBe("'hello'");
    expect(risonEncode('')).toBe("''");
  });

  test('escapes rison special characters in strings', () => {
    expect(risonEncode("it's")).toBe("'it!'s'");
    expect(risonEncode('a!b')).toBe("'a!!b'");
  });

  test('encodes arrays', () => {
    expect(risonEncode([1, 2, 3])).toBe('!(1,2,3)');
    expect(risonEncode(['a', 'b'])).toBe("!('a','b')");
  });

  test('encodes objects with quoted keys', () => {
    expect(risonEncode({ page: 0, page_size: 100 })).toBe("('page':0,'page_size':100)");
  });

  test('omits undefined object values', () => {
    expect(risonEncode({ a: 1, b: undefined, c: 2 })).toBe("('a':1,'c':2)");
  });

  test('throws on non-finite numbers', () => {
    expect(() => risonEncode(Infinity)).toThrow();
    expect(() => risonEncode(NaN)).toThrow();
  });
});

describe('buildListQuery', () => {
  test('returns empty rison object for no options', () => {
    expect(buildListQuery()).toBe('()');
    expect(buildListQuery({})).toBe('()');
  });

  test('encodes pagination', () => {
    expect(buildListQuery({ page: 1, pageSize: 25 })).toBe("('page':1,'page_size':25)");
  });

  test('encodes ordering', () => {
    expect(buildListQuery({ orderColumn: 'changed_on', orderDirection: 'desc' })).toBe(
      "('order_column':'changed_on','order_direction':'desc')"
    );
  });

  test('encodes filters', () => {
    expect(
      buildListQuery({ filters: [{ col: 'dashboard_title', opr: 'ct', value: 'Sales' }] })
    ).toBe("('filters':!(('col':'dashboard_title','opr':'ct','value':'Sales')))");
  });

  test('encodes columns', () => {
    expect(buildListQuery({ columns: ['id', 'slice_name'] })).toBe("('columns':!('id','slice_name'))");
  });

  test('combines filters and pagination in stable order', () => {
    expect(
      buildListQuery({
        filters: [{ col: 'id', opr: 'eq', value: 3 }],
        page: 0,
        pageSize: 10,
      })
    ).toBe("('filters':!(('col':'id','opr':'eq','value':3)),'page':0,'page_size':10)");
  });
});

describe('normalizeBaseUrl', () => {
  test('trims trailing slashes and whitespace', () => {
    expect(normalizeBaseUrl('https://superset.example.com/')).toBe('https://superset.example.com');
    expect(normalizeBaseUrl('  https://superset.example.com//  ')).toBe('https://superset.example.com');
  });

  test('leaves a clean url unchanged', () => {
    expect(normalizeBaseUrl('https://superset.example.com')).toBe('https://superset.example.com');
  });
});

describe('SupersetApiError', () => {
  test('carries status code and details', () => {
    const err = new SupersetApiError('boom', 403, [{ message: 'forbidden' }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SupersetApiError');
    expect(err.statusCode).toBe(403);
    expect(err.details?.[0]?.message).toBe('forbidden');
  });
});

describe('Superset constructor', () => {
  test('requires a base URL', () => {
    // @ts-expect-error intentionally missing baseUrl
    expect(() => new Superset({})).toThrow('base URL is required');
  });

  test('exposes resource APIs', () => {
    const superset = new Superset({ baseUrl: 'https://superset.example.com' });
    expect(superset.dashboards).toBeDefined();
    expect(superset.charts).toBeDefined();
    expect(superset.datasets).toBeDefined();
    expect(superset.databases).toBeDefined();
    expect(superset.savedQueries).toBeDefined();
    expect(superset.queries).toBeDefined();
    expect(superset.getClient().getBaseUrl()).toBe('https://superset.example.com');
  });
});
