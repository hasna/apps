import { describe, expect, test } from "bun:test";
import { defaultApiBaseUrl, resolveTransport } from "./client.js";

const APP = "recordings";

// Regression for bug 21a3b267: the fallback API base URL hardcoded an
// internal-infra URL pattern (an app-name-derived `https://<name>.<host>`
// under the internal domain) that shipped in the published tarball. The
// default must be the documented local self-hosted endpoint (the app's own
// server on the same machine) and the configured `HASNA_<APP>_API_URL` must
// always win.
describe("api base URL resolution", () => {
  test("the default base URL is the documented localhost endpoint, never an internal-infra URL", () => {
    const url = defaultApiBaseUrl(APP);
    expect(url).toBe("http://localhost:8874");
    expect(url).not.toContain("hasna.xyz");
  });

  test("http store + api key without an API URL resolves to the documented localhost default", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_CLIENT_STORE: "http",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.baseUrl).toBe("http://localhost:8874/v1");
  });

  test("a configured HASNA_<APP>_API_URL always wins over the default", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_CLIENT_STORE: "http",
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.baseUrl).toBe("https://api.example.com/v1");
  });
});
