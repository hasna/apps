import { describe, expect, test } from "bun:test";
import { AccessClient } from "../src/client/index.js";
import { toErrorEnvelope } from "../src/types/index.js";

const marker = ["malicious", "diagnostic", "credential"].join("-");
const configuration = { HASNA_ACCESS_API_URL: "https://access.example.test", HASNA_ACCESS_API_KEY: marker };
const statuses = {
  INTERNAL_ERROR: 500, VALIDATION_ERROR: 400, NOT_FOUND: 404,
  IDENTITY_NOT_FOUND: 404, CREDENTIAL_NOT_FOUND: 404, SCOPE_NOT_FOUND: 404,
  ELEVATION_NOT_FOUND: 404, REVIEW_NOT_FOUND: 404, TOKEN_NOT_FOUND: 404,
  ACCESS_REQUEST_NOT_FOUND: 404, INVALID_TRANSITION: 409, VERSION_CONFLICT: 409,
  PERMISSION_DENIED: 403, TOKEN_INVALID: 401, UNAUTHORIZED: 401, RATE_LIMITED: 429,
};

async function failure(response: Response) {
  const client = new AccessClient(configuration, (async () => response) as typeof fetch);
  try { await client.runOperation("identity.list"); } catch (error) { return toErrorEnvelope(error); }
  throw new Error("Expected failure");
}

describe("validated remote error envelopes", () => {
  for (const [code, status] of Object.entries(statuses)) {
    test(`preserves ${code}, not server-controlled diagnostics`, async () => {
      const result = await failure(Response.json({ code, message: marker, suggestion: marker }, { status }));
      expect(result.code).toBe(code);
      expect(typeof result.message).toBe("string");
      expect(result.message).toContain(`HTTP ${status}`);
      expect(typeof result.suggestion).toBe("string");
      expect(JSON.stringify(result)).not.toContain(marker);
    });
  }
  // core-app.ts emits these gate errors without a suggestion field.
  for (const code of ["UNAUTHORIZED", "PERMISSION_DENIED", "VALIDATION_ERROR", "RATE_LIMITED", "INTERNAL_ERROR"] as const) {
    test(`preserves the canonical core's short ${code} envelope`, async () => {
      const result = await failure(Response.json({ code, message: marker }, { status: statuses[code] }));
      expect(result.code).toBe(code);
      expect(JSON.stringify(result)).not.toContain(marker);
    });
  }
  for (const body of [
    marker, "{", "null", "[]", JSON.stringify({ code: marker, message: marker, suggestion: marker }),
    JSON.stringify({ code: "VERSION_CONFLICT", message: marker, suggestion: marker }),
    JSON.stringify({ code: "PERMISSION_DENIED", message: {}, suggestion: marker }),
    JSON.stringify({ code: "PERMISSION_DENIED", suggestion: marker }),
    JSON.stringify({ code: "PERMISSION_DENIED", message: marker, suggestion: {} }),
    JSON.stringify({ code: "__proto__", message: marker, suggestion: marker }),
    JSON.stringify({ code: "PERMISSION_DENIED", message: marker.repeat(10_000), suggestion: marker }),
  ]) {
    test(`rejects malformed, oversized, unknown or status-mismatched envelopes (${body.length} bytes)`, async () => {
      const result = await failure(new Response(body, { status: 403 }));
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.message).toBe("Access HTTPS request failed (HTTP 403).");
      expect(JSON.stringify(result)).not.toContain(marker);
    });
  }
  test("does not leak response-body read failures", async () => {
    const body = new ReadableStream({ pull() { throw new Error(marker); } });
    expect(await failure(new Response(body, { status: 403 }))).toEqual({
      code: "INTERNAL_ERROR", message: "Access HTTPS request failed (HTTP 403).", suggestion: "",
    });
  });
  for (const slow of [false, true]) {
    test(`bounds ${slow ? "slow" : "never-ending"} error bodies and cancels the reader`, async () => {
      let cancelled = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (slow) timer = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), 50);
        },
        cancel() { cancelled = true; if (timer) clearInterval(timer); },
      });
      const started = performance.now();
      try {
        const result = await Promise.race([
          failure(new Response(body, { status: 403 })),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Error parsing exceeded 2 seconds")), 2000); }),
        ]);
        expect(result).toEqual({ code: "INTERNAL_ERROR", message: "Access HTTPS request failed (HTTP 403).", suggestion: "" });
        expect(performance.now() - started).toBeLessThan(2000);
        expect(cancelled).toBe(true);
      } finally {
        if (timer) clearInterval(timer);
        if (timeout) clearTimeout(timeout);
      }
    });
  }
});
