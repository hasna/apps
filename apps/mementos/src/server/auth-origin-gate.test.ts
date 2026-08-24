// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { isolatedStoreEnv } from "../test-support/store-isolation.js";

// Security P1 (todos d836c304): mementos-serve had no Origin/Host check on
// non-OPTIONS routes and authenticateRequest allowed all mutations when no API
// key was configured. Regression coverage:
//   - a hostile Origin on a state-changing route is refused (403), even when
//     unauthenticated writes are explicitly opted in;
//   - a state-changing route with no API key configured is refused (401) under
//     the fail-closed default;
//   - read routes stay open (local default unchanged);
//   - write-implicit GET routes (handlers that touch/update state or spend) are
//     gated like state-changing requests: hostile Origin refused (403),
//     allowlisted Origin/Host still works;
//   - the spend-triggering GET /api/profile/synthesize is no longer a GET route.
//
// Two servers, distinct port ranges so they cannot collide:
//   SERVER_A — fail-closed default: no key, no opt-in.
//   SERVER_B — explicit opt-in (MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES=1) so the
//              Origin/Host allowlist is exercised in isolation from auth, with
//              MEMENTOS_CORS_ORIGIN pinned to the server's own origin.
const PORT_A = 19200 + Math.floor(Math.random() * 50);
const PORT_B = 19300 + Math.floor(Math.random() * 50);
const BASE_A = `http://localhost:${PORT_A}`;
const BASE_B = `http://localhost:${PORT_B}`;

let serverA: ReturnType<typeof Bun.spawn>;
let serverB: ReturnType<typeof Bun.spawn>;

async function spawnServer(
  port: number,
  extra: Record<string, string> = {}
): Promise<ReturnType<typeof Bun.spawn>> {
  const proc = Bun.spawn(["bun", "run", "src/server/index.ts", "--port", String(port)], {
    env: isolatedStoreEnv(":memory:", {
      extra: {
        // Pin the legacy (non-contracts) auth path: no signing secret, and
        // never inherit an ambient MEMENTOS_API_KEY (isolatedStoreEnv already
        // strips it; blanking the signing secrets removes the contracts path).
        API_KEY_SIGNING_SECRET: "",
        HASNA_MEMENTOS_API_SIGNING_KEY: "",
        HASNA_API_SIGNING_KEY: "",
        // Blank the Anthropic key so the profile-synthesize tests can never
        // make a billed LLM call.
        ANTHROPIC_API_KEY: "",
        ...extra,
      },
    }),
    stdout: "pipe",
    stderr: "pipe",
    cwd: new URL("../../", import.meta.url).pathname.replace(/\/$/, ""),
  });
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not ready yet */
    }
    await Bun.sleep(200);
  }
  if (!ready) throw new Error(`Server on port ${port} failed to start`);
  return proc;
}

beforeAll(async () => {
  // Server A pins its own origin in the allowlist so the 401 assertions below
  // exercise the auth gate (a request that fails the origin gate would be 403
  // before auth runs — that behaviour is covered by the hostile-origin tests).
  serverA = await spawnServer(PORT_A, {
    MEMENTOS_CORS_ORIGIN: `http://localhost:${PORT_A}`,
  });
  serverB = await spawnServer(PORT_B, {
    MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES: "1",
    MEMENTOS_CORS_ORIGIN: `http://localhost:${PORT_B}`,
  });
});

afterAll(() => {
  serverA.kill();
  serverB.kill();
});

const MEMORY_BODY = {
  key: `auth-origin-gate-${Date.now()}`,
  value: "regression fixture",
  scope: "global",
};

// ============================================================================
// SERVER_A — fail-closed default (no key, no opt-in)
// ============================================================================

describe("fail-closed auth default (no API key configured)", () => {
  test("state-changing route without a key is refused (401)", async () => {
    const res = await fetch(`${BASE_A}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(401);
  });

  test("PATCH without a key is refused (401)", async () => {
    const res = await fetch(`${BASE_A}/api/memories/some-id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x" }),
    });
    expect(res.status).toBe(401);
  });

  test("read route stays open without a key (local default unchanged)", async () => {
    const res = await fetch(`${BASE_A}/api/memories?limit=0`);
    expect(res.status).toBe(200);
  });

  test("hostile Origin is refused on a mutating route even under the fail-closed server (403)", async () => {
    const res = await fetch(`${BASE_A}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// SERVER_B — explicit opt-in: origin/host allowlist in isolation
// ============================================================================

describe("Origin/Host allowlist on state-changing routes", () => {
  test("allowed origin may create a memory (positive control)", async () => {
    const res = await fetch(`${BASE_B}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${PORT_B}`,
      },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id?: string };
    expect(typeof data.id).toBe("string");
  });

  test("hostile Origin to a mutating route is refused (403)", async () => {
    const res = await fetch(`${BASE_B}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(403);
  });

  test("hostile Origin is refused on PATCH and DELETE too", async () => {
    const patch = await fetch(`${BASE_B}/api/memories/some-id`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ value: "x" }),
    });
    expect(patch.status).toBe(403);

    const del = await fetch(`${BASE_B}/api/memories/some-id`, {
      method: "DELETE",
      headers: { Origin: "https://evil.example" },
    });
    expect(del.status).toBe(403);
  });

  test("matching Host (no Origin) may mutate state", async () => {
    const res = await fetch(`${BASE_B}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(201);
  });

  test("non-allowlisted Host (no Origin) is refused on a mutating route (403)", async () => {
    // Request by loopback IP: the Host header carries 127.0.0.1:<port>, which
    // is not on the allowlist (only http://localhost:<port> is). The request
    // still reaches the server (bound to 127.0.0.1), exercising the Host path.
    const res = await fetch(`http://127.0.0.1:${PORT_B}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Write-implicit GET routes — handlers that touch state (recency updates) or
// trigger spend. GET is a CORS "simple request": a hostile cross-origin page
// can trigger it with no preflight, so these routes must be gated exactly like
// state-changing methods (allowlisted Origin, or allowlisted Host when no
// Origin is present). See todos d836c304 remediation cycle 1.
// ============================================================================

describe("write-implicit GET routes are gated like state-changing requests", () => {
  test("hostile Origin to GET /api/inject is refused (403)", async () => {
    const res = await fetch(`${BASE_B}/api/inject`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  test("hostile Origin to GET /api/inject is refused on the fail-closed server too (403)", async () => {
    const res = await fetch(`${BASE_A}/api/inject`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  test("allowlisted Origin GET /api/inject still works", async () => {
    const res = await fetch(`${BASE_B}/api/inject`, {
      headers: { Origin: `http://localhost:${PORT_B}` },
    });
    expect(res.status).toBe(200);
  });

  test("matching Host GET /api/inject (non-browser client) still works", async () => {
    const res = await fetch(`${BASE_B}/api/inject`);
    expect(res.status).toBe(200);
  });

  test("hostile Origin to GET /api/memories/:id is refused (403)", async () => {
    const created = await fetch(`${BASE_B}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${PORT_B}`,
      },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await fetch(`${BASE_B}/api/memories/${id}`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  test("allowlisted GET /api/memories/:id still works", async () => {
    const created = await fetch(`${BASE_B}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${PORT_B}`,
      },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await fetch(`${BASE_B}/api/memories/${id}`, {
      headers: { Origin: `http://localhost:${PORT_B}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(id);
  });

  test("profile synthesize is no longer exposed as GET (404)", async () => {
    const res = await fetch(`${BASE_B}/api/profile/synthesize`);
    expect(res.status).toBe(404);
  });

  test("hostile Origin to POST /api/profile/synthesize is refused (403)", async () => {
    const res = await fetch(`${BASE_B}/api/profile/synthesize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  test("allowlisted POST /api/profile/synthesize works (no billed LLM call)", async () => {
    const res = await fetch(`${BASE_B}/api/profile/synthesize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://localhost:${PORT_B}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: unknown };
    // No preference/fact memories in this store — a null profile, never an error.
    expect("profile" in body).toBe(true);
  });

  test("POST /api/profile/synthesize is refused without a key (fail-closed, 401)", async () => {
    const res = await fetch(`${BASE_A}/api/profile/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});
