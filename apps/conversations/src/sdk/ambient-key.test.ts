// Regression: the SDK client must NOT attach the ambient fleet key.
//
// The generated `ConversationsClient` takes an explicit `baseUrl` and an
// optional `apiKey`. When a caller supplies a `baseUrl` but no `apiKey`, the
// client must send NO `x-api-key` header — a credential is pinned to the
// authority it resolved with, and the ambient fleet environment (Keychain,
// credentials file, or `HASNA_CONVERSATIONS_API_KEY` in the shell) belongs to
// whatever resolved it, never to a client the caller pointed somewhere else
// (hasna/apps#1794, owner directive 2026-09-04).

import { afterEach, describe, expect, test } from "bun:test";
import { ConversationsClient } from "./index.js";

const KEY_VAR = "HASNA_CONVERSATIONS_API_KEY";
const LEGACY_KEY_VAR = "CONVERSATIONS_API_KEY";
const AMBIENT_KEY = "hasna_conversations_ambient_shell_key_00000000";

afterEach(() => {
  delete process.env[KEY_VAR];
  delete process.env[LEGACY_KEY_VAR];
});

describe("ConversationsClient explicit baseUrl with no apiKey", () => {
  test("does not attach the ambient HASNA_CONVERSATIONS_API_KEY", async () => {
    process.env[KEY_VAR] = AMBIENT_KEY;

    const headers: Record<string, string> = {};
    const client = new ConversationsClient({
      baseUrl: "https://api.example.invalid",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        new Headers(init?.headers ?? {}).forEach((value, key) => {
          headers[key] = value;
        });
        return Response.json({ ok: true });
      }) as unknown as typeof fetch,
    });

    await client.getHealth();

    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
    // The control: the harness actually observed the request's headers.
    expect(Object.keys(headers).length).toBeGreaterThan(0);
  });

  test("does not attach the ambient legacy CONVERSATIONS_API_KEY either", async () => {
    process.env[LEGACY_KEY_VAR] = AMBIENT_KEY;

    const headers: Record<string, string> = {};
    const client = new ConversationsClient({
      baseUrl: "https://api.example.invalid",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        new Headers(init?.headers ?? {}).forEach((value, key) => {
          headers[key] = value;
        });
        return Response.json({ ok: true });
      }) as unknown as typeof fetch,
    });

    await client.getHealth();

    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  test("an EXPLICIT apiKey is sent, so the credential is the caller's own", async () => {
    // The other half of the ruling: an explicitly supplied key is used
    // verbatim, and never substituted with the ambient one.
    process.env[KEY_VAR] = AMBIENT_KEY;

    const headers: Record<string, string> = {};
    const client = new ConversationsClient({
      baseUrl: "https://api.example.invalid",
      apiKey: "explicit-caller-key",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        new Headers(init?.headers ?? {}).forEach((value, key) => {
          headers[key] = value;
        });
        return Response.json({ ok: true });
      }) as unknown as typeof fetch,
    });

    await client.getHealth();

    expect(headers["x-api-key"]).toBe("explicit-caller-key");
  });
});
