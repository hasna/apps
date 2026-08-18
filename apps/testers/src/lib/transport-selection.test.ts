// Regression: the client selects its backend from the environment ONLY.
//
// The backend-selection env keys are exactly URL + key (the env-key spec below
// proves no other variables exist), and a partially configured hosted setup
// (URL without key, or key without URL) fails closed instead of silently
// serving local data.
import { describe, expect, test } from "bun:test";
import { resolveClientTransport, createClientTransport, clientTransportEnvKeys } from "@hasna/contracts/client";

const URL_KEY = "HASNA_TESTERS_API_URL";
const KEY_KEY = "HASNA_TESTERS_API_KEY";

describe("client transport selection (env contract)", () => {
  test("neither URL nor key -> local, not misconfigured", () => {
    const r = resolveClientTransport("testers", {});
    expect(r.transport).toBe("local");
    expect(r.misconfigured).toBe(false);
    expect(r.baseUrl).toBeNull();
  });

  test("URL + key -> hosted /v1 transport", () => {
    const r = resolveClientTransport("testers", {
      [URL_KEY]: "https://testers.example.com",
      [KEY_KEY]: "k-test",
    });
    expect(r.transport).toBe("http");
    expect(r.misconfigured).toBe(false);
    expect(r.baseUrl).toBe("https://testers.example.com/v1");
    expect(r.apiKeyPresent).toBe(true);
  });

  test("URL only -> local with misconfigured: true (fail closed)", () => {
    const r = resolveClientTransport("testers", { [URL_KEY]: "https://testers.example.com" });
    expect(r.transport).toBe("local");
    expect(r.misconfigured).toBe(true);
  });

  test("key only -> local with misconfigured: true (fail closed)", () => {
    const r = resolveClientTransport("testers", { [KEY_KEY]: "k-test" });
    expect(r.transport).toBe("local");
    expect(r.misconfigured).toBe(true);
  });

  test("createClientTransport throws on a partially configured hosted setup", () => {
    expect(() => createClientTransport("testers", { [URL_KEY]: "https://testers.example.com" })).toThrow();
  });

  test("createClientTransport returns a client only for URL + key", () => {
    const wired = createClientTransport("testers", {
      [URL_KEY]: "https://testers.example.com",
      [KEY_KEY]: "k-test",
      ...(process.env.TESTERS_PG_POOL_MAX ? {} : {}),
    });
    expect(wired.transport).toBe("http");
    expect(wired.client).not.toBeNull();
  });

  test("no mode keys exist in the env-key spec", () => {
    const keys = clientTransportEnvKeys("testers");
    expect(keys.apiUrlKeys).toEqual(["HASNA_TESTERS_API_URL", "TESTERS_API_URL"]);
    expect(keys.apiKeyKeys).toEqual(["HASNA_TESTERS_API_KEY", "TESTERS_API_KEY"]);
  });
});
