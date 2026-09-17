export const DEFAULT_NOTE_WRITE_RATE_LIMIT_MAX = 12_000;
export const MAX_NOTE_WRITE_RATE_LIMIT_MAX = 1_000_000;
export const NOTE_WRITE_RATE_LIMIT_WINDOW_MS = 60_000;

export class NoteWriteRateLimitConfigurationError extends Error {
  constructor() {
    // Do not reflect a configuration value into startup logs.
    super('HASNA_NOTES_SERVER_NOTE_WRITE_RATE_LIMIT_MAX must be an integer from 1 to 1000000.');
    this.name = 'NoteWriteRateLimitConfigurationError';
  }
}

export function resolveNoteWriteRateLimitMax(raw) {
  const value = raw === undefined ? '' : String(raw).trim();
  if (!value) return DEFAULT_NOTE_WRITE_RATE_LIMIT_MAX;
  const maximum = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_NOTE_WRITE_RATE_LIMIT_MAX) {
    throw new NoteWriteRateLimitConfigurationError();
  }
  return maximum;
}
