import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAttachmentsTransport } from "./client-config";
import { resolveAttachmentsV1 } from "./cloud-v1";
import { createAttachmentsApiClient } from "../sdk/resolve";
import { serviceConfig } from "./todos";

const fixture = { bootstrap: "fixture-bootstrap", current: "fixture-current", rotated: "fixture-rotated", stale: "fixture-stale" };
const reference = "fixture/attachments/api-key";
let home: string;
let vault: ReturnType<typeof Bun.serve>;
let mode: string;
let vaultRequests: number;
let receiverRequests: number;
let correctKeys: boolean;
let duringLookup: (() => void) | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "attachments-vault-reference-"));
  mode = "ok"; vaultRequests = 0; receiverRequests = 0; correctKeys = true; duringLookup = undefined;
  vault = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (new URL(request.url).pathname !== "/v1/secrets/get") return new Response(null, { status: 404 });
    vaultRequests++;
    correctKeys &&= request.headers.get("x-api-key") === fixture.bootstrap;
    duringLookup?.();
    if (mode === "missing") return new Response(null, { status: 404 });
    if (mode === "denied") return new Response(null, { status: 403 });
    return Response.json({ key: reference, value: mode === "empty" ? "" : mode === "rotate" ? fixture.rotated : fixture.current });
  } });
});

afterEach(() => { vault.stop(true); rmSync(home, { recursive: true, force: true }); });

function environment(source: "environment" | "file"): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    HOME: home,
    HASNA_ATTACHMENTS_API_URL: "https://attachments.example.test",
    HASNA_ATTACHMENTS_API_KEY: fixture.stale,
    HASNA_SECRETS_API_URL: vault.url.origin,
    HASNA_SECRETS_API_KEY: fixture.bootstrap,
  };
  if (source === "environment") env.HASNA_ATTACHMENTS_API_KEY_REF = reference;
  else {
    const dir = join(home, ".hasna/attachments/config");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "credentials"), `HASNA_ATTACHMENTS_API_KEY_REF=${reference}\n`, { mode: 0o600 });
  }
  return env;
}

const receiver = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
  receiverRequests++;
  correctKeys &&= new Headers(init?.headers).get("x-api-key") === (mode === "rotate" ? fixture.rotated : fixture.current);
  return Response.json([]);
}) as typeof fetch;

for (const source of ["environment", "file"] as const) {
  test(`${source} references are admitted without treating the pointer as a literal key`, () => {
    const report = resolveAttachmentsTransport(environment(source));
    expect(report.apiKeyTier).toBe("pointer");
    expect(report.apiKey).toBe("");
    expect(JSON.stringify(report)).not.toContain(fixture.stale);
    expect(vaultRequests).toBe(0);
  });

  for (const surface of ["store", "sdk"] as const) {
    test(`${surface} resolves ${source} references with the installed Secrets SDK on each request`, async () => {
      const env = environment(source);
      const list = surface === "store"
        ? (() => { const client = resolveAttachmentsV1(env, { fetchImpl: receiver }); return () => client.store.list(); })()
        : (() => { const client = createAttachmentsApiClient({ env, fetch: receiver }); return () => client.listAttachments(); })();
      for (const next of ["ok", "rotate"]) {
        mode = next; vaultRequests = 0; receiverRequests = 0;
        await list();
        expect(vaultRequests).toBe(1);
        expect(receiverRequests).toBe(1);
        expect(correctKeys).toBe(true);
      }
      for (const failure of ["missing", "denied", "empty"]) {
        mode = failure; vaultRequests = 0; receiverRequests = 0;
        await expect(list()).rejects.toThrow();
        expect(vaultRequests).toBe(1);
        expect(receiverRequests).toBe(0);
      }
    });
  }
}

test("task integrations resolve their own service reference instead of an Attachments or stale key", async () => {
  const env = environment("environment");
  env.HASNA_TODOS_API_URL = "https://todos.example.test";
  env.HASNA_TODOS_API_KEY_REF = reference;
  env.HASNA_TODOS_API_KEY = fixture.stale;
  const config = await serviceConfig("TODOS", env);
  expect(config.url).toBe("https://todos.example.test");
  expect(config.key).toBe(fixture.current);
  expect(vaultRequests).toBe(1);
  expect(correctKeys).toBe(true);
});

for (const surface of ["store", "sdk"] as const) {
  for (const change of ["authority", "reference"] as const) {
    test(`${surface} rejects a changed ${change} during the vault request before receiver dispatch`, async () => {
      const env = environment("environment");
      const list = surface === "store"
        ? (() => { const client = resolveAttachmentsV1(env, { fetchImpl: receiver }); return () => client.store.list(); })()
        : (() => { const client = createAttachmentsApiClient({ env, fetch: receiver }); return () => client.listAttachments(); })();
      duringLookup = () => {
        if (change === "authority") env.HASNA_ATTACHMENTS_API_URL = "https://changed.example.test";
        else env.HASNA_ATTACHMENTS_API_KEY_REF = "fixture/other/api-key";
      };
      await expect(list()).rejects.toThrow(/changed/i);
      expect(vaultRequests).toBe(1);
      expect(receiverRequests).toBe(0);
    });
  }
}
