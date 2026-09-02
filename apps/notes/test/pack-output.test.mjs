import { describe, expect, test } from 'bun:test';
import { packedFilename } from '../scripts/pack-output.mjs';

describe('exact npm artifact selection', () => {
  test('selects the single npm archive without reconstructing a Bun payload', () => {
    expect(packedFilename(JSON.stringify([{ filename: 'hasna-notes-0.5.0.tgz', files: [] }]))).toBe('hasna-notes-0.5.0.tgz');
  });

  test('rejects malformed, empty, ambiguous, or missing pack metadata', () => {
    for (const output of ['not json', '{}', '[]', '[{}]', '[{"filename":1}]', '[{"filename":"one.tgz"},{"filename":"two.tgz"}]']) {
      expect(() => packedFilename(output)).toThrow();
    }
  });

  test('rejects directories, traversal, absolute paths and non-archives', () => {
    for (const filename of ['', '.', '..', '../outside.tgz', 'nested/file.tgz', '/tmp/outside.tgz', 'C:\\outside.tgz', 'nested\\file.tgz', 'file.json']) {
      expect(() => packedFilename(JSON.stringify([{ filename }]))).toThrow(/artifact filename/);
    }
  });
});
