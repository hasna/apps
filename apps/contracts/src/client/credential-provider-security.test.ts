// Regressions from the adversarial review of 331e550.
//
// Every test here corresponds to a real defect an independent reviewer found in
// the first version of the credential chain. They live together so the review
// round is legible in one place; each one fails against that commit.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialResolutionError,
  credentialDiskSources,
  resolveCredential,
  type ResolvedCredential,
} from "./credentials.js";
import { createHasnaHttpTransport, resolveClientTransport } from "./transport.js";

const SECRET = "hasna_accounts_fresh-on-disk-key";
const homes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "hasna-review-"));
  homes.push(home);
  return home;
}

/** The ruled disk tier: `~/.hasna/<app>/config/credentials`, owner-only. */
function writeCloudEnv(home: string, app: string, body: string): string {
  const dir = join(home, ".hasna", app, "config");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "credentials");
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

function writeConfigEnv(home: string, app: string, body: string): string {
  return writeCloudEnv(home, app, body);
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});


describe("an explicit apiKey STRING gets the same protections as a resolved one", () => {
  const PLAINTEXT = "hasna_todos_SUPERSECRET-VALUE";

  function transportWithKey(apiKey: string, onFetch: () => void) {
    return createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.your-deployment.example/v1",
      apiKey,
      fetchImpl: async (_url, init) => {
        onFetch();
        // Exactly what a real fetch does with these headers, and where the
        // plaintext key used to surface: the runtime throws a TypeError whose
        // message embeds the WHOLE header value — i.e. the key — into logs and
        // stack traces.
        new Headers(init!.headers as Record<string, string>);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    });
  }

  test("a mid-value CR throws, and the message never contains the key", async () => {
    let fetchCalls = 0;
    const client = transportWithKey(`AAAA\r${PLAINTEXT}`, () => {
      fetchCalls += 1;
    });

    let thrown: unknown;
    try {
      await client.get("/items");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CredentialResolutionError);
    expect((thrown as Error).message).not.toContain(PLAINTEXT);
    // The value is rejected BEFORE anything is handed to fetch, so there is no
    // header for a runtime to quote back.
    expect(fetchCalls).toBe(0);
  });

  test("the rejection names the source instead of the value", async () => {
    const client = transportWithKey(`AAAA\r${PLAINTEXT}`, () => {});

    await expect(client.get("/items")).rejects.toThrow(/explicit apiKey option/);
  });

  test("a NUL byte in an explicit key is rejected too, not just CR", async () => {
    const client = transportWithKey(`AAAA\u0000${PLAINTEXT}`, () => {});

    let thrown: unknown;
    try {
      await client.get("/items");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CredentialResolutionError);
    expect((thrown as Error).message).not.toContain(PLAINTEXT);
  });

  test("a clean explicit key still works and is still sent", async () => {
    const seen: string[] = [];
    const client = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.your-deployment.example/v1",
      apiKey: PLAINTEXT,
      fetchImpl: async (_url, init) => {
        seen.push(String((init!.headers as Record<string, string>)["x-api-key"]));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await client.get("/items");
    expect(seen).toEqual([PLAINTEXT]);
  });

  test("the explicit-string credential is sealed, so a 401 report cannot serialize it", async () => {
    const client = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.your-deployment.example/v1",
      apiKey: PLAINTEXT,
      retry: false,
      fetchImpl: async () => new Response("", { status: 401 }),
    });

    let thrown: unknown;
    try {
      await client.get("/items");
    } catch (error) {
      thrown = error;
    }

    expect(JSON.stringify(thrown)).not.toContain(PLAINTEXT);
    expect((thrown as Error).message).not.toContain(PLAINTEXT);
  });
});

// ---------------------------------------------------------------------------
// P2 — a caller-supplied CredentialProvider could return a plain object that
// bypassed both credential protections. A control character then reached
// `fetch`, whose header error includes the plaintext value, and a valid object
// remained enumerable instead of being snapshotted into a sealed credential.
// ---------------------------------------------------------------------------

describe("a caller-supplied CredentialProvider gets the credential protections", () => {
  const PLAINTEXT = "hasna_todos_PROVIDER-SUPERSECRET";

  function rawCredential(apiKey: string): ResolvedCredential {
    return {
      apiKey,
      tier: "disk",
      source: "caller-supplied provider",
      deliberate: false,
      diskCandidates: [],
      warning: null,
    };
  }

  test("a malformed raw credential is rejected before fetch without exposing the key", async () => {
    let fetchCalls = 0;
    const client = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.your-deployment.example/v1",
      apiKey: () => rawCredential(`AAAA\r${PLAINTEXT}`),
      fetchImpl: async (_url, init) => {
        fetchCalls += 1;
        new Headers(init!.headers as Record<string, string>);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    let thrown: unknown;
    try {
      await client.get("/items");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CredentialResolutionError);
    expect((thrown as Error).message).not.toContain(PLAINTEXT);
    expect(fetchCalls).toBe(0);
  });

  test("raw provider diagnostic metadata is not trusted on auth failures", async () => {
    const client = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.your-deployment.example/v1",
      retry: false,
      apiKey: () => ({
        apiKey: PLAINTEXT,
        tier: "env",
        source: PLAINTEXT,
        deliberate: false,
        diskCandidates: [PLAINTEXT],
        warning: `warning ${PLAINTEXT}`,
      }),
      fetchImpl: async () => new Response("", { status: 401 }),
    });

    let thrown: unknown;
    try {
      await client.get("/items");
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as Error).message;
    expect(message).toContain("caller-supplied CredentialProvider");
    expect(message).not.toContain(PLAINTEXT);
    expect(JSON.stringify(thrown)).not.toContain(PLAINTEXT);
  });

  test("sealed provider diagnostic metadata cannot be rewritten into an auth-failure leak", async () => {
    const home = makeHome();
    writeCloudEnv(home, "todos", `HASNA_TODOS_API_KEY=${PLAINTEXT}\n`);
    const resolved = resolveCredential("todos", { HOME: home })!;

    try {
      (resolved as unknown as { source: string }).source = PLAINTEXT;
    } catch {
      // Frozen credentials throw in strict runtimes; either way, the value below
      // must stay the original safe source path.
    }
    try {
      (resolved.diskCandidates as string[]).push(PLAINTEXT);
    } catch {
      // The candidate list is part of the diagnostic snapshot too.
    }

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.diskCandidates)).toBe(true);
    expect(resolved.source).not.toBe(PLAINTEXT);
    expect(resolved.diskCandidates).not.toContain(PLAINTEXT);

    const client = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.your-deployment.example/v1",
      retry: false,
      apiKey: () => resolved,
      fetchImpl: async () => new Response("", { status: 401 }),
    });

    let thrown: unknown;
    try {
      await client.get("/items");
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).not.toContain(PLAINTEXT);
    expect(JSON.stringify(thrown)).not.toContain(PLAINTEXT);
  });

  test("well-formed provider credentials are sealed per request without breaking rotation", async () => {
    const keys = [`${PLAINTEXT}-before`, `${PLAINTEXT}-after`];
    const seen: Array<{ apiKey: string; authorization: string }> = [];
    let providerCalls = 0;
    let apiKeyReads = 0;
    const client = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.your-deployment.example/v1",
      apiKey: () => {
        const apiKey = keys[providerCalls++]!;
        return {
          get apiKey() {
            apiKeyReads += 1;
            return apiKey;
          },
          tier: "disk",
          source: "caller-supplied provider",
          deliberate: false,
          diskCandidates: [],
          warning: null,
        };
      },
      fetchImpl: async (_url, init) => {
        const headers = init!.headers as Record<string, string>;
        seen.push({ apiKey: headers["x-api-key"]!, authorization: headers.Authorization! });
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await client.get("/items");
    await client.get("/items");

    expect(providerCalls).toBe(2);
    // One read per provider result proves the raw getter was snapshotted into a
    // sealed data property before both authenticated headers were assembled.
    expect(apiKeyReads).toBe(2);
    expect(seen).toEqual([
      { apiKey: keys[0]!, authorization: `Bearer ${keys[0]}` },
      { apiKey: keys[1]!, authorization: `Bearer ${keys[1]}` },
    ]);
  });
});

// ---------------------------------------------------------------------------
// P0 — CONTRACT.md §3a and `sealCredential`'s own comment promise that
// `console.log` cannot spill the key. Under Bun — the declared engine — it can:
// non-enumerability does NOT hide an own property from Bun's inspector, so
// `console.log(resolved)` printed `apiKey: "..."` verbatim. A normative
// guarantee the runtime does not honour is worse than no guarantee.
// ---------------------------------------------------------------------------

describe("the inspector cannot spill the key either", () => {
  test("Bun.inspect of a resolved credential excludes the key", () => {
    const home = makeHome();
    writeCloudEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${SECRET}\n`);

    const resolved = resolveCredential("accounts", { HOME: home })!;

    expect(Bun.inspect(resolved)).not.toContain(SECRET);
  });

  test("console.log of a resolved credential excludes the key", () => {
    const home = makeHome();
    writeCloudEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${SECRET}\n`);
    const resolved = resolveCredential("accounts", { HOME: home })!;

    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      written.push(args.map((arg) => (typeof arg === "string" ? arg : Bun.inspect(arg))).join(" "));
    };
    try {
      console.log(resolved);
    } finally {
      console.log = original;
    }

    expect(written.join("\n")).not.toContain(SECRET);
  });

  test("nesting the credential inside another object does not defeat the hook", () => {
    const home = makeHome();
    writeCloudEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${SECRET}\n`);
    const resolved = resolveCredential("accounts", { HOME: home })!;

    expect(Bun.inspect({ credential: resolved, note: "diagnostic dump" })).not.toContain(SECRET);
  });

  test("the redacted form still names the tier and source, so it stays diagnostic", () => {
    const home = makeHome();
    const diskPath = writeCloudEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${SECRET}\n`);
    const resolved = resolveCredential("accounts", { HOME: home })!;

    const rendered = Bun.inspect(resolved);
    expect(rendered).toContain("disk");
    expect(rendered).toContain(diskPath);
  });

  test("the inspect hook stays invisible to Object.keys, spreads, and property access", () => {
    const home = makeHome();
    writeCloudEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${SECRET}\n`);
    const resolved = resolveCredential("accounts", { HOME: home })!;

    expect(Object.keys(resolved)).not.toContain("apiKey");
    expect(Object.keys({ ...resolved })).toEqual(Object.keys(resolved));
    // And the secret is still readable by the code that legitimately needs it.
    expect(resolved.apiKey).toBe(SECRET);
  });
});
