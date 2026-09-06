import { describe, expect, test } from "bun:test";
import { resolveRecordingsTransport } from "./client.js";

// Regression for bug 21a3b267: the fallback API base URL hardcoded an
// internal-infra URL pattern (an app-name-derived `https://<name>.<host>`
// under the internal domain) that shipped in the published tarball. The
// configured `HASNA_<APP>_API_URL` must always be the base; the client never
// invents a hostname. With the resolver adopted the rule is now the fleet
// gateway default (`https://api.hasna.com/<app>`), which is a public
// hostname, never an internal one.
describe("api base URL resolution", () => {
  test("the hosted store is selected by a resolving credential, and uses the configured URL", () => {
    const r = resolveRecordingsTransport({
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.authority!.baseUrl).toBe("https://api.example.com/v1");
    expect(r.authority!.baseUrl).not.toContain("hasna.xyz");
  });

  test("an API key without an API URL reaches the public fleet gateway, never an internal host", () => {
    const r = resolveRecordingsTransport({
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.authority!.baseUrl).toBe("https://api.hasna.com/recordings/v1");
    expect(r.authority!.baseUrl).not.toContain("hasna.xyz");
  });

  test("a configured HASNA_<APP>_API_URL always wins as the base", () => {
    const r = resolveRecordingsTransport({
      HASNA_RECORDINGS_API_URL: "https://api.example.com",
      HASNA_RECORDINGS_API_KEY: "test-key",
    });
    expect(r.transport).toBe("http");
    expect(r.authority!.baseUrl).toBe("https://api.example.com/v1");
  });
});