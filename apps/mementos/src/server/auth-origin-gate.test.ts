// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
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
// Four servers:
//   SERVER_A — fail-closed default: no key, no opt-in.
//   SERVER_B — explicit opt-in (MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES=1) so the
//              Origin/Host allowlist is exercised in isolation from auth, with
//              MEMENTOS_CORS_ORIGIN pinned to the server's own origin.
//   SERVER_C — legacy static API key configured, writes opted in, and the
//              CORS origin allowlist left at its DEFAULT (localhost:19428).
//              This mirrors the O15-04420 production defect: the deployed
//              server had no MEMENTOS_CORS_ORIGIN, so the allowlist did not
//              contain the Host the CLI/MCP/SDK clients connect with, and every
//              keyed cloud write/read was refused with 403 'Host is not
//              allowed' even though the request carried a valid API key.
//   SERVER_D — the production auth path: contracts HMAC verifier
//              (API_KEY_SIGNING_SECRET), MEMENTOS_CORS_ORIGIN unset.
//
// Ports are OS-assigned ephemeral ports (never fixed ranges): the fixed
// 19200-19550 ranges collided with unrelated fleet services listening there
// and with orphaned servers from aborted runs, which made the harness flake.
let PORT_A = 0;
let PORT_B = 0;
let PORT_C = 0;
let PORT_D = 0;
let BASE_A = "";
let BASE_B = "";
let BASE_C = "";
const STATIC_KEY = "test-static-key-o15-04420";
const CONTRACTS_SECRET = "test-signing-secret-o15-04420-0123456789abcdef";

let serverA: ReturnType<typeof Bun.spawn>;
let serverB: ReturnType<typeof Bun.spawn>;
let serverC: ReturnType<typeof Bun.spawn>;
let serverD: ReturnType<typeof Bun.spawn>;

/** Ask the OS for a free loopback port (ephemeral allocation). */
function freePort(): number {
  const probe = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const port = probe.port;
  probe.stop(true);
  return port;
}

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

beforeAll(
  async () => {
    // Server A pins its own origin in the allowlist so the 401 assertions below
    // exercise the auth gate (a request that fails the origin gate would be 403
    // before auth runs — that behaviour is covered by the hostile-origin tests).
    PORT_A = freePort();
    PORT_B = freePort();
    PORT_C = freePort();
    PORT_D = freePort();
    BASE_A = `http://localhost:${PORT_A}`;
    BASE_B = `http://localhost:${PORT_B}`;
    BASE_C = `http://localhost:${PORT_C}`;
    serverA = await spawnServer(PORT_A, {
      MEMENTOS_CORS_ORIGIN: `http://localhost:${PORT_A}`,
    });
  serverB = await spawnServer(PORT_B, {
    MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES: "1",
    MEMENTOS_CORS_ORIGIN: `http://localhost:${PORT_B}`,
  });
  // Server C mirrors the O15-04420 production defect: a valid API key is
  // configured, but MEMENTOS_CORS_ORIGIN is left unset so the allowlist stays
  // at its default (localhost:19428) — the Host the clients connect with is
  // NOT on it. A keyed request must not be refused by the ambient-credential
  // gate.
  serverC = await spawnServer(PORT_C, {
    MEMENTOS_API_KEY: STATIC_KEY,
    MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES: "1",
  });
    // Server D exercises the PRODUCTION auth path: the contracts HMAC verifier
    // (API_KEY_SIGNING_SECRET), with MEMENTOS_CORS_ORIGIN unset — the exact
    // production misconfiguration. The key is minted with the real
    // @hasna/contracts/auth mintApiKey.
    serverD = await spawnServer(PORT_D, {
      API_KEY_SIGNING_SECRET: CONTRACTS_SECRET,
    });
  },
  // Four servers boot sequentially; give the hook room (default is 5s).
  30000,
);

afterAll(() => {
  serverA.kill();
  serverB.kill();
  serverC.kill();
  serverD.kill();
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

// ============================================================================
// SERVER_C — O15-04420 regression: a request that carries a VERIFIED API key
// (CLI/MCP/SDK client, no Origin header) must not be refused by the
// Origin/Host allowlist. The allowlist is an ambient-credential (CSRF) defense:
// a hostile page cannot attach the Authorization header without CORS preflight
// (separately allowlisted) and cannot read the key, so a keyed request with no
// Origin is not CSRF and must be served regardless of MEMENTOS_CORS_ORIGIN.
// Before this fix every keyed cloud write/read 403'd with 'Forbidden. Host is
// not allowed.' whenever the server's allowlist did not contain the client's
// Host — the production state at the time of the bug (no MEMENTOS_CORS_ORIGIN
// on mementos-prod, allowlist defaulted to localhost:19428).
// ============================================================================

describe("authenticated clients with a valid key are not refused by the Host allowlist (O15-04420)", () => {
  const AUTH = { Authorization: `Bearer ${STATIC_KEY}` };

  test("POST with a valid key and a non-allowlisted Host is accepted (201)", async () => {
    // Host `localhost:<PORT_C>` is NOT on the default allowlist (localhost:19428).
    const res = await fetch(`${BASE_C}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(201);
  });

  test("POST with a valid key via a loopback-IP Host is accepted (201)", async () => {
    // Host `127.0.0.1:<PORT_C>` is not on the allowlist either.
    const res = await fetch(`http://127.0.0.1:${PORT_C}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(201);
  });

  test("GET /api/memories/:id with a valid key and a non-allowlisted Host is accepted (200)", async () => {
    const created = await fetch(`${BASE_C}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await fetch(`http://127.0.0.1:${PORT_C}/api/memories/${id}`, {
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(id);
  });

  test("PATCH with a valid key and a non-allowlisted Host is accepted (200)", async () => {
    const created = await fetch(`${BASE_C}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await fetch(`http://127.0.0.1:${PORT_C}/api/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ value: "updated by keyed client" }),
    });
    expect(res.status).toBe(200);
  });

  test("GET /api/inject with a valid key and a non-allowlisted Host is accepted (200)", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT_C}/api/inject`, {
      headers: AUTH,
    });
    expect(res.status).toBe(200);
  });
});

describe("contracts-verifier path (production auth) — keyed clients skip the Host allowlist (O15-04420)", () => {
  // Minted with the REAL @hasna/contracts/auth mintApiKey — the same
  // machinery the production server verifies (stateless HMAC).
  const TOKEN = mintApiKey({
    app: "mementos",
    scopes: ["mementos:*"],
    signingSecret: CONTRACTS_SECRET,
  }).token;
  const AUTH = { Authorization: `Bearer ${TOKEN}` };

  test("POST with a valid contracts key and a non-allowlisted Host is accepted (201)", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT_D}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(201);
  });

  test("GET /api/inject with a valid contracts key and a non-allowlisted Host is accepted (200)", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT_D}/api/inject`, {
      headers: AUTH,
    });
    expect(res.status).toBe(200);
  });

  test("a key minted under a DIFFERENT secret never bypasses the gate (403)", async () => {
    const forged = mintApiKey({
      app: "mementos",
      scopes: ["mementos:*"],
      signingSecret: "wrong-signing-secret-for-gate-bypass",
    }).token;
    const res = await fetch(`http://127.0.0.1:${PORT_D}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${forged}` },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(403);
  });

  test("no key at all on a non-allowlisted Host is still refused (403)", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT_D}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(403);
  });
});

describe("unauthenticated or invalid-key requests stay fail-closed (O15-04420)", () => {
  test("POST without a key and a non-allowlisted Host is refused (403)", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT_C}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(403);
  });

  test("POST with a WRONG key and a non-allowlisted Host is refused (403)", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT_C}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-key" },
      body: JSON.stringify(MEMORY_BODY),
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/inject without a key and a non-allowlisted Host is refused on the opt-in server (403)", async () => {
    // SERVER_B has no API key configured, so an unauthenticated write-implicit
    // GET reaches the route-level gate and must still be refused on Host.
    const res = await fetch(`http://127.0.0.1:${PORT_B}/api/inject`);
    expect(res.status).toBe(403);
  });

  test("GET /api/memories/:id without a key and a non-allowlisted Host is refused on the opt-in server (403)", async () => {
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

    const res = await fetch(`http://127.0.0.1:${PORT_B}/api/memories/${id}`);
    expect(res.status).toBe(403);
  });
});
