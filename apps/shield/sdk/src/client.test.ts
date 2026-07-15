import { afterEach, describe, expect, test } from "bun:test";
import { OpenSecurityClient } from "./client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenSecurityClient scan source boundary", () => {
  test("omits sensitive-source opt-ins by default and forwards explicit choices", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "scan", scanner_types: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new OpenSecurityClient("http://127.0.0.1:1");
    await client.triggerScan("/synthetic/repo");
    await client.triggerScan("/synthetic/repo", {
      include_git_history: true,
      include_system: true,
    });

    expect(bodies[0]).toEqual({ path: "/synthetic/repo" });
    expect(bodies[1]).toEqual({
      path: "/synthetic/repo",
      include_git_history: true,
      include_system: true,
    });
  });
});
