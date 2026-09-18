import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrepublishTestEnv } from "../../scripts/prepublish-local-test.mjs";

// A child process keeps the actual pinned SDK independent of mock.module("resend")
// in other provider suites. Its only transport is this synthetic fetch function.
async function sendWithResponse(input: { status?: number; body?: unknown; networkError?: boolean; rawBody?: string }) {
  const testHome = mkdtempSync(join(tmpdir(), "resend-sdk-"));
  const script = `
    import { homedir } from "node:os";
    import { ResendAdapter } from ${JSON.stringify(new URL("./resend.ts", import.meta.url).href)};
    import { classifyProviderSendError, providerSendLogFields } from ${JSON.stringify(new URL("../server/self-hosted/sender.ts", import.meta.url).href)};
    const fixture = ${JSON.stringify(input)};
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (url !== "https://api.resend.com/emails" || init?.method !== "POST") throw new Error("unexpected fixture request");
      if (fixture.networkError) throw new TypeError("synthetic network failure");
      return new Response(fixture.rawBody ?? JSON.stringify(fixture.body), { status: fixture.status ?? 400 });
    };
    const adapter = new ResendAdapter({ id: "fixture-provider", api_key: "synthetic-provider-key" });
    let result;
    try {
      result = { id: await adapter.sendEmail({ from: "sender@example.test", to: "receiver@example.test", subject: "fixture", text: "synthetic body" }) };
    } catch (error) {
      const outcome = classifyProviderSendError(error);
      result = { outcome, log: providerSendLogFields(outcome), keys: Object.keys(error), cause: error.cause ?? null };
    }
    process.stdout.write(JSON.stringify({ calls, isolatedHome: homedir() === ${JSON.stringify(testHome)}, ...result }));
  `;
  try {
    for (const name of ["config", "data", "cache", "state", "tmp"]) mkdirSync(join(testHome, name), { mode: 0o700 });
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "-e", script], {
      env: { ...buildPrepublishTestEnv({}, testHome), NODE_ENV: "production" },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result.isolatedHome).toBe(true);
    expect(result.calls).toBe(1);
    return result;
  } finally {
    rmSync(testHome, { recursive: true, force: true });
  }
}

describe("Resend send errors through the real SDK", () => {
  it.each([400, 401, 403, 422, 429])("preserves a definitive %i rejection for the send classifier", async (status) => {
    const result = await sendWithResponse({ status, body: { statusCode: status, name: "validation_error", message: "synthetic rejection" } });
    expect(result.outcome).toEqual({ kind: "rejected", httpStatus: status, providerErrorName: "validation_error", detail: "Resend send failed: synthetic rejection" });
    expect(result.log).toEqual({ outcome: "rejected", provider_error: "validation_error", http_status: status });
  });

  it("preserves 503 while leaving the send outcome uncertain", async () => {
    const result = await sendWithResponse({ status: 503, body: { statusCode: 503, name: "application_error", message: "synthetic unavailable" } });
    expect(result.outcome).toMatchObject({ kind: "uncertain", httpStatus: 503, providerErrorName: "application_error" });
  });

  it.each([undefined, null, "400", 400.5, 0, 200, 600])("does not infer rejection from a missing or invalid SDK status (%j)", async (statusCode) => {
    const result = await sendWithResponse({ status: 400, body: { statusCode, name: "validation_error", message: "HTTP 400 MessageRejected" } });
    expect(result.outcome.kind).toBe("uncertain");
    expect(result.outcome.httpStatus).toBeUndefined();
  });

  it("leaves a transport failure uncertain without a provider status", async () => {
    const result = await sendWithResponse({ networkError: true });
    expect(result.outcome).toMatchObject({ kind: "uncertain", providerErrorName: "application_error" });
    expect(result.outcome.httpStatus).toBeUndefined();
  });

  it("preserves the SDK's status for a non-JSON provider rejection", async () => {
    const result = await sendWithResponse({ status: 400, rawBody: "synthetic non-JSON error" });
    expect(result.outcome).toMatchObject({ kind: "rejected", httpStatus: 400, providerErrorName: "application_error" });
  });

  it("copies only bounded diagnostics, without response headers, request data or causes", async () => {
    const result = await sendWithResponse({ body: {
      statusCode: 400, name: "validation_error", message: "x".repeat(5_000),
      headers: { authorization: "synthetic-private-header" }, request: { body: "synthetic-private-body" }, cause: "synthetic-private-cause",
    } });
    expect(result.keys.sort()).toEqual(["name", "statusCode"]);
    expect(result.cause).toBeNull();
    expect(result.outcome.detail).toHaveLength(600);
    expect(result.log).toEqual({ outcome: "rejected", provider_error: "validation_error", http_status: 400 });
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
  });

  it.each(["x".repeat(101), "validation_error\r\nprivate content", { private: "synthetic body" }])("refuses unsafe error names (%j)", async (name) => {
    const result = await sendWithResponse({ body: { statusCode: 400, name, message: { private: "synthetic body" } } });
    expect(result.outcome).toEqual({ kind: "rejected", httpStatus: 400, providerErrorName: "ResendSendError", detail: "Resend send failed" });
  });

  it("keeps successful sends at one provider attempt", async () => {
    const result = await sendWithResponse({ status: 200, body: { id: "synthetic-provider-receipt" } });
    expect(result.id).toBe("synthetic-provider-receipt");
    expect(result.outcome).toBeUndefined();
  });

  it.each([undefined, null, "", " \t\r\n", 123, false, [], {}, "bad\u0000receipt"].map((id) => [id]))("keeps an invalid success receipt uncertain (%j)", async (id) => {
    const result = await sendWithResponse({ status: 200, body: { id, private: "synthetic-private-response" } });
    expect(result.outcome).toEqual({ kind: "uncertain", providerErrorName: "Error", detail: "Resend send outcome is uncertain: provider response did not include a valid message ID" });
    expect(result.keys).toEqual([]);
    expect(result.cause).toBeNull();
    expect(JSON.stringify(result)).not.toContain("synthetic-private-response");
  });

  it.each([200, 400])("does not accept a JSON null response (HTTP%i)", async (status) => {
    const result = await sendWithResponse({ status, body: null });
    expect(result.outcome.kind).toBe("uncertain");
    expect(result.outcome.httpStatus).toBeUndefined();
    expect(result.id).toBeUndefined();
  });
});
