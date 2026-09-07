import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerAddressCommands } from "./address.js";
import { registerDomainCommands } from "./domain.js";

let stub: V1Stub;
const homes: string[] = [];
const registrySize = 1005;
const addresses = Array.from({ length: registrySize }, (_, index) => ({
  id: index === registrySize - 1 ? "last-address-id" : `address-${index}`,
  email: index === registrySize - 1 ? "support@late.example" : `sender-${index}@example.test`,
  provider_id: "registry-provider",
  verified: index < 1000,
  status: index === registrySize - 1 ? "suspended" : "active",
  created_at: new Date(Date.UTC(2026, 0, 1) - index * 1000).toISOString(),
}));
const domains = addresses.map((address, index) => ({
  id: index === registrySize - 1 ? "last-domain-id" : `domain-${index}`,
  domain: index === registrySize - 1 ? "late.example" : `domain-${index}.example.test`,
  provider: "registry-provider",
  verified: false,
  created_at: address.created_at,
}));

async function command(args: string[]) {
  const program = new Command().exitOverride();
  let data: unknown;
  let text = "";
  const output = (value: unknown, formatted: string) => { data = value; text = formatted; };
  registerAddressCommands(program, output);
  registerDomainCommands(program, output);
  const previousExit = process.exit;
  const previousError = console.error;
  let error = "";
  process.exit = ((code?: number) => { throw new Error(error || `exit ${code}`); }) as typeof process.exit;
  console.error = (message: unknown) => { error = String(message); };
  try {
    await program.parseAsync(["bun", "emails", ...args]);
    return { data, text };
  } finally { process.exit = previousExit; console.error = previousError; }
}

beforeAll(async () => { stub = await startV1Stub({ openapi: true }); });
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.seed({ addresses, domains });
  stub.applyEnv();
  // Keep the fixture principal ahead of this machine's ambient Keychain key.
  process.env.EMAILS_SESSION_TOKEN = stub.apiKey;
});
afterEach(() => {
  stub.clearEnv();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("CLI account registry visibility", () => {
  it("lists the entire registry through every list alias without a misleading next-page hint", async () => {
    for (const args of [["address", "list"], ["addresses"], ["domain", "list"], ["domains", "list"], ["domains"], ["domains", "status"]]) {
      const result = await command(args);
      expect(result.data).toHaveLength(registrySize);
      expect(result.text).not.toContain("page with --offset");
    }
  });

  it("honors an explicit limit and offset while an offset alone keeps every remaining row", async () => {
    for (const noun of ["address", "domain"]) {
      expect((await command([noun, "list", "--limit", "50", "--offset", "500"])).data).toHaveLength(50);
      expect((await command([noun, "list", "--offset", "500"])).data).toHaveLength(505);
      expect((await command([noun, "list", "--limit", "2", "--offset", "1003"])).data).toHaveLength(2);
    }
  });

  it("filters the whole registry for unverified addresses before applying a requested page", async () => {
    const all = await command(["addresses", "--unverified"]);
    expect(all.data).toHaveLength(5);
    expect(all.data).toContainEqual(expect.objectContaining({ email: "support@late.example", status: "suspended" }));
    const page = await command(["address", "list", "--unverified", "--limit", "2", "--offset", "1"]);
    expect(page.data).toMatchObject([{ id: "address-1001" }, { id: "address-1002" }]);
  });

  it("resolves late domain names and prefixes and never suggests an already registered address", async () => {
    expect((await command(["domains", "status", "last-domain"])).data).toMatchObject({ domain: "late.example" });
    expect((await command(["domains", "status", "late.example"])).data).toMatchObject({ id: "last-domain-id" });
    const suggested = (await command(["address", "suggest", "--domain", "late.example"])).data as { suggestions: string[] };
    expect(suggested.suggestions).not.toContain("support@late.example");
    await command(["address", "remove", "last-address", "--yes"]);
    await command(["domain", "remove", "last-domain", "--yes"]);
    expect(await stub.list("addresses")).toHaveLength(registrySize - 1);
    expect(await stub.list("domains")).toHaveLength(registrySize - 1);
  });

  it("deduplicates an address registered beyond the old lookup ceiling", async () => {
    const result = await command(["address", "add", "support@late.example", "--provider", "registry-provider"]);
    expect(result.data).toMatchObject({ id: "last-address-id" });
    expect(await stub.list("addresses")).toHaveLength(registrySize);
  });

  it("resolves a late address for suspension through the same complete registry", async () => {
    const result = await command(["address", "suspend", "address-1003"]);
    expect(result.data).toMatchObject({ id: "address-1003", status: "suspended" });
  });

  it("refuses ambiguous removal prefixes when another match is beyond the first thousand rows", async () => {
    await stub.seed({
      addresses: addresses.map((row, index) => index === 0 || index === registrySize - 1 ? { ...row, id: `shared-address-${index}` } : row),
      domains: domains.map((row, index) => index === 0 || index === registrySize - 1 ? { ...row, id: `shared-domain-${index}` } : row),
    });
    for (const noun of ["address", "domain"]) {
      await expect(command([noun, "remove", `shared-${noun}`, "--yes"])).rejects.toThrow(/ambiguous/);
    }
    expect(await stub.list("addresses")).toHaveLength(registrySize);
    expect(await stub.list("domains")).toHaveLength(registrySize);
  });

  it("shows the same account registry on fresh homes and stations through a gateway app prefix without writes", async () => {
    const compilerCache = mkdtempSync(join(tmpdir(), "emails-registry-compiler-"));
    homes.push(compilerCache);
    const requests: Array<{ method: string; path: string }> = [];
    const proxy = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (request.method !== "GET") return new Response("read-only fixture", { status: 405 });
        if (!url.pathname.startsWith("/emails/v1/")) return new Response("unexpected route", { status: 404 });
        return fetch(`${stub.baseUrl}${url.pathname.slice("/emails".length)}${url.search}`, {
          method: request.method, headers: request.headers,
        });
      },
    });
    // The generic fixture fills database-default columns on its first read.
    // Materialize those defaults before taking the no-write baseline.
    for (const resource of ["addresses", "domains", "providers"]) {
      await (await fetch(`${stub.baseUrl}/v1/${resource}`, {
        headers: { Authorization: `Bearer ${stub.apiKey}` },
      })).json();
    }
    const before = await stub.dump();
    try {
      for (const station of ["registry-station-a", "registry-station-b"]) {
        const home = mkdtempSync(join(tmpdir(), "emails-registry-home-"));
        homes.push(home);
        for (const noun of ["address", "domain"]) {
          const child = Bun.spawn([process.execPath, "src/cli/index.tsx", noun, "list", "--json"], {
            cwd: join(import.meta.dir, "../../.."),
            env: {
              PATH: process.env.PATH,
              HOME: home,
              HASNA_HOME: join(home, ".hasna"),
              HASNA_STATION: station,
              HASNA_EMAILS_API_URL: `http://127.0.0.1:${proxy.port}/emails`,
              HASNA_EMAILS_API_KEY: stub.apiKey,
              EMAILS_SESSION_TOKEN: stub.apiKey,
              BUN_RUNTIME_TRANSPILER_CACHE_PATH: compilerCache,
              NO_COLOR: "1",
            },
            stdout: "pipe", stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
          ]);
          expect(exitCode, stderr).toBe(0);
          const rows = JSON.parse(stdout) as Array<{ id: string }>;
          expect(rows).toHaveLength(registrySize);
          expect(rows.at(-1)?.id).toBe(noun === "address" ? "last-address-id" : "last-domain-id");
        }
        expect(readdirSync(home, { recursive: true })).toEqual([]);
      }
      expect(requests.length).toBeGreaterThan(4);
      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect(await stub.dump()).toEqual(before);
    } finally { proxy.stop(true); }
  }, 30_000);
});
