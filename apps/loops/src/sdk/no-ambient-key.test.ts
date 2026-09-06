/**
 * SDK credential-pinning contract (hasna/apps#1794).
 *
 * An SDK client constructed with an EXPLICIT baseUrl and NO apiKey must not
 * silently attach the ambient fleet key (the machine's Keychain item, the
 * credential file, or HASNA_LOOPS_API_KEY in the environment): the credential
 * is pinned to the authority it resolved with, and a caller that named an
 * authority without a key is asking for an unauthenticated client, not for a
 * key borrowed from the machine. The generated SDK client sends a header only
 * when an apiKey was actually handed to the constructor, so the ambient
 * environment is never consulted.
 *
 * The live process environment is exercised deliberately: HASNA_LOOPS_API_KEY
 * is set around the request so that a client which WRONGLY consulted the
 * environment would attach it.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { LoopsClient } from "./http.js";

const AMBIENT_KEY = "ambient-fleet-key-must-not-leak";

const previousValue: string | undefined = process.env.HASNA_LOOPS_API_KEY;
afterEach(() => {
  if (previousValue === undefined) delete process.env.HASNA_LOOPS_API_KEY;
  else process.env.HASNA_LOOPS_API_KEY = previousValue;
});

describe("SDK explicit authority without a key", () => {
  test("an explicit baseUrl with no apiKey sends NO ambient credential header", async () => {
    process.env.HASNA_LOOPS_API_KEY = AMBIENT_KEY;
    const seen: Record<string, string> = {};
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      for (const key of Object.keys(headers)) seen[key.toLowerCase()] = String(headers[key]);
      return new Response(JSON.stringify({ ok: true, loops: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new LoopsClient({
      baseUrl: "https://loops.example.test",
      fetch: fetchImpl,
    });

    await client.listLoops();
    expect(seen["x-api-key"]).toBeUndefined();
    expect(seen["authorization"]).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain(AMBIENT_KEY);
  });

  test("the same client with an explicit apiKey attaches exactly that key", async () => {
    process.env.HASNA_LOOPS_API_KEY = AMBIENT_KEY;
    const seen: Record<string, string> = {};
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      for (const key of Object.keys(headers)) seen[key.toLowerCase()] = String(headers[key]);
      return new Response(JSON.stringify({ ok: true, loops: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new LoopsClient({
      baseUrl: "https://loops.example.test",
      apiKey: "caller-supplied-key",
      fetch: fetchImpl,
    });

    await client.listLoops();
    expect(seen["x-api-key"]).toBe("caller-supplied-key");
    expect(JSON.stringify(seen)).not.toContain(AMBIENT_KEY);
  });
});