// Retry with exponential backoff for transient API errors

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Network errors (no status code)
    if (err.message.includes("fetch failed") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT")) {
      return true;
    }
    // HTTP status codes embedded in error messages (OpenAI SDK style: "429 Too Many Requests")
    const match = err.message.match(/^(\d{3})\s/);
    if (match) {
      const status = parseInt(match[1]!, 10);
      return RETRYABLE_STATUS_CODES.has(status);
    }
    // Thinker Labs errors: "Thinker Labs API error 429: ..."
    const tlMatch = err.message.match(/API error (\d{3})/);
    if (tlMatch) {
      const status = parseInt(tlMatch[1]!, 10);
      return RETRYABLE_STATUS_CODES.has(status);
    }
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, onRetry } = options;

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts || !isRetryableError(lastError)) {
        throw lastError;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      onRetry?.(attempt, delayMs, lastError);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
