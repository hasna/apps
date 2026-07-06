import { describe, test, expect } from 'bun:test';
import { formatOutput } from './output';

describe('output utilities', () => {
  describe('json format', () => {
    test('formats an object as JSON', () => {
      const data = { id: 'u1', name: 'Ada' };
      expect(formatOutput(data, 'json')).toBe(JSON.stringify(data, null, 2));
    });

    test('formats null as JSON', () => {
      expect(formatOutput(null, 'json')).toBe('null');
    });
  });

  describe('table format', () => {
    test('renders an array of objects as a table', () => {
      const result = formatOutput([{ id: 1, name: 'Ada' }, { id: 2, name: 'Bob' }], 'table');
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toContain('Ada');
      expect(result).toContain('|');
    });

    test('returns "No data" for an empty array', () => {
      expect(formatOutput([], 'table')).toBe('No data');
    });

    test('truncates long values', () => {
      expect(formatOutput([{ v: 'a'.repeat(50) }], 'table')).toContain('...');
    });
  });

  describe('pretty format', () => {
    test('renders array indices', () => {
      const result = formatOutput([{ id: 1 }, { id: 2 }], 'pretty');
      expect(result).toContain('[1]');
      expect(result).toContain('[2]');
    });

    test('renders nested objects', () => {
      const result = formatOutput({ user: { name: 'Ada' } }, 'pretty');
      expect(result).toContain('user');
      expect(result).toContain('Ada');
    });

    test('defaults to pretty format', () => {
      const data = { id: 1 };
      expect(formatOutput(data)).toBe(formatOutput(data, 'pretty'));
    });
  });
});
