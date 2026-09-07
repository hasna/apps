import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_PATH_VARS } from "./client-storage-policy.js";
import { getStore, getStoreResolution } from "../db/store.js";
import { createDomainsClientFromEnv } from "../sdk/index.js";

describe("clients cannot select SQLite", () => {
  test("CLI serve cannot expose a saved account credential as an unauthenticated proxy", async () => {
    const home = mkdtempSync(join(tmpdir(), "domains-serve-boundary-"));
    let requests = 0;
    const upstream = Bun.serve({hostname:"127.0.0.1", port:0, fetch() { requests++; return Response.json({domains:[]}); }});
    const child = Bun.spawn([process.execPath, "src/cli/index.ts", "serve", "--port", "38179"], {
      cwd:join(import.meta.dir,"../.."),
      env:{PATH:process.env.PATH ?? "", HOME:home, HASNA_STATION:"domains-serve-fixture", HASNA_DOMAINS_API_URL:`http://127.0.0.1:${upstream.port}`, HASNA_DOMAINS_API_KEY:"synthetic-account-fixture"},
      stdout:"pipe", stderr:"pipe", stdin:"ignore",
    });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code).not.toBe(0);
      expect(err).toContain("HASNA_DOMAINS_API_SIGNING_KEY");
      expect(requests).toBe(0);
      expect(readdirSync(home,{recursive:true}).filter((name) => /\.db(?:-|$)/.test(String(name)))).toEqual([]);
    } finally { clearTimeout(timer); child.kill(); upstream.stop(true); rmSync(home,{recursive:true,force:true}); }
  }, 15000);
  for (const variable of LOCAL_PATH_VARS) {
    test(`${variable} fails before credential lookup, with or without a key`, () => {
      for (const keyed of [false, true]) {
        const env = { [variable]: "/private/fixture-must-not-open.db", ...(keyed ? { HASNA_DOMAINS_API_KEY: "synthetic-fixture" } : {}) };
        let keychainCalls = 0;
        const credentials = { keychain: { enabled: true, run: () => { keychainCalls++; throw new Error("must not read credentials"); } } };
        expect(() => getStore(env, { credentials })).toThrow(variable);
        expect(() => getStoreResolution(env, { credentials })).toThrow(variable);
        expect(() => createDomainsClientFromEnv(env, { baseUrl: "https://fixture.invalid" })).toThrow(variable);
        expect(keychainCalls).toBe(0);
      }
    });
  }

  for (const entry of ["src/cli/index.ts", "src/mcp/index.ts"]) {
    test(`${entry} rejects a local path without creating any database`, async () => {
      const home = mkdtempSync(join(tmpdir(), "domains-api-only-"));
      try {
        const path = join(home, "legacy.db");
        const child = Bun.spawn([process.execPath, entry, ...(entry.includes("/cli/") ? ["domain", "list", "--json"] : ["--stdio"])], {
          cwd: join(import.meta.dir, "../.."),
          env: { PATH: process.env.PATH ?? "", HOME: home, HASNA_HOME: home, HASNA_STATION: "domains-api-only-fixture", HASNA_DOMAINS_DB_PATH: path },
          stdin: "ignore", stdout: "pipe", stderr: "pipe",
        });
        const timer = setTimeout(() => child.kill(), 15000);
        try {
          const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
          expect(code).not.toBe(0);
          expect(out).toBe("");
          expect(err).toContain("HASNA_DOMAINS_DB_PATH is no longer supported");
          expect(err).not.toContain(path);
          expect(existsSync(path)).toBe(false);
          expect(readdirSync(home, { recursive: true }).filter((name) => /\.db(?:-|$)/.test(String(name)))).toEqual([]);
        } finally { clearTimeout(timer); }
      } finally { rmSync(home, { recursive: true, force: true }); }
    }, 20000);
  }
});
