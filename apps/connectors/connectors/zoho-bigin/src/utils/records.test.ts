import { describe, expect, test } from 'bun:test';
import { normalizeRecordPayload } from './records';

describe('normalizeRecordPayload', () => {
  test('wraps a single object', () => {
    expect(normalizeRecordPayload({ Last_Name: 'Doe' })).toEqual([{ Last_Name: 'Doe' }]);
  });

  test('keeps an array of objects', () => {
    expect(normalizeRecordPayload([{ Last_Name: 'Doe' }, { Last_Name: 'Smith' }])).toEqual([
      { Last_Name: 'Doe' },
      { Last_Name: 'Smith' },
    ]);
  });

  test('rejects invalid payloads', () => {
    expect(() => normalizeRecordPayload('not-json-records')).toThrow('Expected a JSON object or an array of JSON objects');
    expect(() => normalizeRecordPayload([{ Last_Name: 'Doe' }, null])).toThrow(
      'Expected a JSON object or an array of JSON objects',
    );
  });
});
