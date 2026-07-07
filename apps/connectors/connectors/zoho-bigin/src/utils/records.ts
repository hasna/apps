export function normalizeRecordPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    if (payload.every(isPlainRecord)) {
      return payload;
    }
    throw new Error('Expected a JSON object or an array of JSON objects');
  }

  if (isPlainRecord(payload)) {
    return [payload];
  }

  throw new Error('Expected a JSON object or an array of JSON objects');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
