/**
 * Diff engine unit suite.
 *
 * The assertion that carries the most weight here is the field-only one: an
 * edit that moves the tags, the title, the url, the metadata, or the archived
 * flag without touching the body is a version-worthy change, and a body-only
 * differ would render it as "no changes" — a confident wrong answer of exactly
 * the kind entry versioning exists to prevent.
 */
import { describe, expect, test } from 'bun:test';
import { diffEntries, diffLines, formatEntryDiff } from '../src/entry-diff';

describe('diffLines', () => {
  test('reports added, removed, and context lines with both line numbers', () => {
    const diff = diffLines('a\nb\nc', 'a\nB\nc');
    expect(diff.map((l) => [l.op, l.text])).toEqual([
      ['context', 'a'],
      ['remove', 'b'],
      ['add', 'B'],
      ['context', 'c'],
    ]);
    expect(diff[0]).toMatchObject({ from_line: 1, to_line: 1 });
    expect(diff[1]).toMatchObject({ from_line: 2, to_line: null });
    expect(diff[2]).toMatchObject({ from_line: null, to_line: 2 });
  });

  test('an unchanged body produces only context lines', () => {
    expect(diffLines('same\nlines', 'same\nlines').every((l) => l.op === 'context')).toBe(true);
  });

  test('empty and null bodies are handled without inventing a blank line', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines(null, undefined)).toEqual([]);
    expect(diffLines('', 'one')).toEqual([{ op: 'add', from_line: null, to_line: 1, text: 'one' }]);
  });

  test('a trailing newline is a terminator, not an extra empty line', () => {
    expect(diffLines('one\n', 'one')).toEqual([{ op: 'context', from_line: 1, to_line: 1, text: 'one' }]);
  });

  test('an insertion in the middle keeps the surrounding lines as context', () => {
    const diff = diffLines('one\nthree', 'one\ntwo\nthree');
    expect(diff.map((l) => l.op)).toEqual(['context', 'add', 'context']);
    expect(diff.filter((l) => l.op === 'add').map((l) => l.text)).toEqual(['two']);
  });

  test('refuses a body far past the intended size rather than grinding on it', () => {
    const huge = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
    expect(() => diffLines(huge, 'x')).toThrow(/Refusing to line-diff/);
  });
});

describe('diffEntries', () => {
  test('a tags-only change is NOT reported as "no changes"', () => {
    const diff = diffEntries(
      { title: 'T', content: 'body', tags: ['a'] },
      { title: 'T', content: 'body', tags: ['a', 'b'] },
    );
    expect(diff.identical).toBe(false);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.fields).toEqual([{ field: 'tags', from: ['a'], to: ['a', 'b'] }]);
    expect(formatEntryDiff(diff, 'v1', 'v2')).toContain('~ tags:');
    expect(formatEntryDiff(diff, 'v1', 'v2')).toContain('(content unchanged)');
  });

  test('archiving shows up as a field change', () => {
    const diff = diffEntries({ content: 'x', archived: false }, { content: 'x', archived: true });
    expect(diff.identical).toBe(false);
    expect(diff.fields.map((f) => f.field)).toEqual(['archived']);
  });

  test('two identical states are identical, and say so', () => {
    const state = { title: 'T', content: 'body', url: null, tags: ['a'], metadata: { k: 1 }, archived: false };
    const diff = diffEntries(state, { ...state, tags: ['a'], metadata: { k: 1 } });
    expect(diff.identical).toBe(true);
    expect(formatEntryDiff(diff, 'v1', 'v2')).toContain('(no changes)');
  });

  test('a body change reports counts and renders unified markers', () => {
    const diff = diffEntries({ content: 'one\ntwo' }, { content: 'one\ntwo\nthree' });
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
    const rendered = formatEntryDiff(diff, 'k_1 v1', 'k_1 current');
    expect(rendered).toContain('--- k_1 v1');
    expect(rendered).toContain('+++ k_1 current');
    expect(rendered).toContain('@@ content +1 -0 @@');
    expect(rendered).toContain('+three');
  });

  test('metadata is compared by value, not identity', () => {
    expect(diffEntries({ metadata: { a: 1 } }, { metadata: { a: 1 } }).identical).toBe(true);
    expect(diffEntries({ metadata: { a: 1 } }, { metadata: { a: 2 } }).identical).toBe(false);
  });
});
