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
import { diffEntries, diffLines, formatEntryDiff, redactEntryDiff } from '../src/entry-diff';

// The fixture value is SYNTHETIC — 20+ alphanumerics after `sk-`, the
// openai_api_key detector shape — created for the test, never a live key.
const CRED = ['sk-', 'testsecretkeyvalue1234567890'].join(''); // SYNTHETIC fixture assembled from fragments so the file text itself cannot match the detector

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

describe('redactEntryDiff', () => {
  test('redacts a credential-shaped value in retained body lines but keeps the diff structure', () => {
    // The retained side carries the value (the pre-sweep body), the live side is clean.
    const diff = diffEntries({ content: `key=${CRED} in history` }, { content: 'key=[REDACTED] in history' });
    const redacted = redactEntryDiff(diff);
    const rendered = formatEntryDiff(redacted, 'k_1 v1', 'k_1 current');
    expect(rendered).not.toContain(CRED);
    expect(rendered).toContain('[REDACTED:openai_api_key]');
    // Structure survives: the redaction is a render-time pass, not a re-diff.
    expect(redacted.added).toBe(diff.added);
    expect(redacted.removed).toBe(diff.removed);
    expect(redacted.content.map((l) => l.op)).toEqual(diff.content.map((l) => l.op));
    expect(redacted.content[0]).toMatchObject({ op: 'remove', from_line: 1, to_line: null });
  });

  test('leaves non-matching lines untouched', () => {
    const diff = diffEntries({ content: 'ordinary prose\nmore prose' }, { content: 'ordinary prose\nedited prose' });
    const redacted = redactEntryDiff(diff);
    expect(redacted.content.map((l) => l.text)).toEqual(diff.content.map((l) => l.text));
    expect(formatEntryDiff(redacted, 'v1', 'v2')).toContain('edited prose');
  });

  test('redacts credential-shaped values in field changes (metadata/title/url/tags) too', () => {
    const diff = diffEntries(
      { content: 'same body', metadata: { api_key: CRED }, title: `old ${CRED}` },
      { content: 'same body', metadata: { api_key: 'clean' }, title: 'new title' },
    );
    const redacted = redactEntryDiff(diff);
    // JSON path: the typed structure survives, the string leaves are masked.
    const json = JSON.stringify({ ...redacted });
    expect(json).not.toContain(CRED);
    expect(json).toContain('[REDACTED:openai_api_key]');
    // Text path: the rendered field-change line is masked.
    const rendered = formatEntryDiff(redacted, 'k_1 v1', 'k_1 current');
    expect(rendered).not.toContain(CRED);
    expect(rendered).toContain('[REDACTED:openai_api_key]');
    // The body is untouched by the field pass (still the true body lines).
    expect(redacted.content).toEqual(diff.content);
    expect(redacted.identical).toBe(false);
  });

  test('honours a policy that disables redaction', () => {
    const diff = diffEntries({ content: `key=${CRED}` }, { content: 'clean' });
    const redacted = redactEntryDiff(diff, { redaction: { enabled: false } });
    expect(formatEntryDiff(redacted, 'v1', 'v2')).toContain(CRED);
  });
});
