import { describe, expect, test } from "bun:test";
import { resolveTransport } from "./client.js";

const APP = "recordings";

// Regression for bug 21a3b267: the fallback API base URL hardcoded an
// internal-infra URL pattern (an app-name-derived `https://<name>.<host>`
// under the internal domain) that shipped in the published tarball. The
// configured `HASNA_<APP>_API_URL` must always be the base; the client never
// invents a hostname.
describe("api base URL resolution", () => {
  test("the hosted store is selected only by API_URL + API_KEY presence, and uses the configured URL", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.baseUrl).toBe("https://api.example.com/v1");
    expect(r.baseUrl).not.toContain("hasna.xyz");
  });

  test("an API key without an API URL is a partial configuration, not a default host", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("sqlite");
    expect(r.misconfigured).toBe(true);
    expect(r.baseUrl).toBeNull();
  });

  test("a configured HASNA_<APP>_API_URL always wins as the base", () => {
    const r = resolveTransport(APP, {
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.baseUrl).toBe("https://api.example.com/v1");
  });
});
