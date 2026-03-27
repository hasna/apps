import { describe, expect, test } from "bun:test";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  test("retries on 429 error then succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("429 Too Many Requests");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("retries on 500 error", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("500 Internal Server Error");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("retries on Thinker Labs API error 503", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("Thinker Labs API error 503: service unavailable");
        return "recovered";
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
  });

  test("does NOT retry on 401 error", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("401 Unauthorized");
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow("401 Unauthorized");
    expect(attempts).toBe(1);
  });

  test("does NOT retry on 404 error", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("404 Not Found");
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow("404 Not Found");
    expect(attempts).toBe(1);
  });

  test("throws after max attempts", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("429 Rate limit");
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow("429 Rate limit");
    expect(attempts).toBe(3);
  });

  test("calls onRetry callback", async () => {
    const retries: number[] = [];
    await withRetry(
      async () => {
        if (retries.length < 2) throw new Error("500 error");
        return "done";
      },
      { maxAttempts: 3, baseDelayMs: 1, onRetry: (attempt) => retries.push(attempt) }
    );
    expect(retries).toEqual([1, 2]);
  });

  test("retries on fetch failed (network error)", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("fetch failed: connection refused");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("retries on ECONNRESET", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("ECONNRESET");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("retries on ETIMEDOUT", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("ETIMEDOUT");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("does NOT retry on Thinker Labs 401 error", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Thinker Labs API error 401: unauthorized");
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow("Thinker Labs API error 401");
    expect(attempts).toBe(1);
  });

  test("does NOT retry non-Error throws", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw "string error";
        },
        { maxAttempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow("string error");
    expect(attempts).toBe(1);
  });
});
