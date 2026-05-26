import { describe, test, expect } from 'bun:test';
import { formatOutput } from './output';

describe('Output utilities', () => {
  describe('formatOutput', () => {
    describe('json format', () => {
      test('formats object as JSON', () => {
        const data = { id: 1, name: 'Test' };
        const result = formatOutput(data, 'json');
        expect(result).toBe(JSON.stringify(data, null, 2));
      });

      test('formats array as JSON', () => {
        const data = [{ id: 1 }, { id: 2 }];
        const result = formatOutput(data, 'json');
        expect(result).toBe(JSON.stringify(data, null, 2));
      });

      test('formats primitive as JSON', () => {
        const result = formatOutput('hello', 'json');
        expect(result).toBe('"hello"');
      });

      test('formats null as JSON', () => {
        const result = formatOutput(null, 'json');
        expect(result).toBe('null');
      });
    });

    describe('table format', () => {
      test('formats array of objects as table', () => {
        const data = [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ];
        const result = formatOutput(data, 'table');

        expect(result).toContain('id');
        expect(result).toContain('name');
        expect(result).toContain('Alice');
        expect(result).toContain('Bob');
        expect(result).toContain('|');
        expect(result).toContain('-');
      });

      test('wraps single object in array for table', () => {
        const data = { id: 1, name: 'Test' };
        const result = formatOutput(data, 'table');

        expect(result).toContain('id');
        expect(result).toContain('name');
        expect(result).toContain('Test');
      });

      test('returns "No data" for empty array', () => {
        const result = formatOutput([], 'table');
        expect(result).toBe('No data');
      });

      test('truncates long values', () => {
        const data = [{ long: 'a'.repeat(50) }];
        const result = formatOutput(data, 'table');

        expect(result).toContain('...');
      });
    });

    describe('pretty format', () => {
      test('formats object with color codes', () => {
        const data = { id: 1, name: 'Test' };
        const result = formatOutput(data, 'pretty');

        expect(result).toContain('id');
        expect(result).toContain('name');
        expect(result).toContain('Test');
      });

      test('formats array with indices', () => {
        const data = [{ id: 1 }, { id: 2 }];
        const result = formatOutput(data, 'pretty');

        expect(result).toContain('[1]');
        expect(result).toContain('[2]');
      });

      test('handles null values', () => {
        const data = { value: null };
        const result = formatOutput(data, 'pretty');

        expect(result).toContain('null');
      });

      test('handles nested objects', () => {
        const data = {
          user: {
            name: 'Alice',
            email: 'alice@example.com',
          },
        };
        const result = formatOutput(data, 'pretty');

        expect(result).toContain('user');
        expect(result).toContain('name');
        expect(result).toContain('Alice');
      });

      test('handles arrays in objects', () => {
        const data = {
          tags: ['urgent', 'vip', 'new'],
        };
        const result = formatOutput(data, 'pretty');

        expect(result).toContain('tags');
        expect(result).toContain('urgent');
        expect(result).toContain('vip');
      });

      test('handles empty arrays', () => {
        const data = { tags: [] };
        const result = formatOutput(data, 'pretty');

        expect(result).toContain('tags');
        expect(result).toContain('[]');
      });
    });

    describe('default format', () => {
      test('defaults to pretty format', () => {
        const data = { id: 1 };
        const defaultResult = formatOutput(data);
        const prettyResult = formatOutput(data, 'pretty');

        expect(defaultResult).toBe(prettyResult);
      });
    });
  });
});
