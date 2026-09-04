import { afterEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import type { TenantAuthContext } from "../lib/auth/tenant-auth.js";
import { BundleArtifactStorage, memoryObjectStore } from "../lib/bundle/artifact-storage.js";
import { MODE_DATA, MODE_SCRIPT, validateBundleManifest } from "../lib/bundle/manifest.js";
import { readBundleMarker } from "../lib/bundle/local.js";
import { createBundleApiClient } from "./bundle-client.js";
import { registerBundleCommands } from "./bundle.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  process.exitCode = 0;
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const principal: TenantAuthContext = {
  tenantId: "tenant-cli",
  principalId: "principal-cli",
  requestId: "request-cli",
  kid: "kid-cli",
  agent: "cli-test",
  scopes: ["loops:read", "loops:write", "loops:bundle"],
  roles: ["admin"],
  tokenKind: "api_key",
  claims: { v: 1, kid: "kid-cli", app: "loops", scopes: ["loops:*"], iat: 1, exp: null },
};

/**
 * A CLI harness wired to a real in-process control plane.
 *
 * The point of these tests is the round trip - pack, upload, allocate, download,
 * verify, install - so the server is the real one and only the credential
 * resolution and the bundle root are redirected.
 */
async function harness(scopes: string[] = principal.scopes) {
  const storage = createSqliteLoopStorage(join(tempDir("loops-cli-db-"), "loops.db"));
  cleanups.push(() => void storage.close());
  const artifacts = new BundleArtifactStorage({ bucket: "cli-bucket", store: memoryObjectStore() });
  const mod = await import("../api/index.js");
  const server = mod.createLoopsApiServer({
    host: "127.0.0.1",
    port: 0,
    storage,
    artifacts,
    authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal: { ...principal, scopes } }) },
    withTenantStorage: (_p, fn) => fn(storage as LoopStorageContract),
  });
  cleanups.push(() => server.stop(true));

  const bundleRoot = tempDir("loops-cli-bundles-");
  const env: NodeJS.ProcessEnv = {
    LOOPS_BUNDLE_ROOT: bundleRoot,
    HASNA_LOOPS_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_LOOPS_API_KEY: "test-key",
    HOME: tempDir("loops-cli-home-"),
  };
  const client = createBundleApiClient(env);

  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
  cleanups.push(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  const program = new Command();
  program.exitOverride();
  const actions = registerBundleCommands(program, { json: () => true, client, env });

  return {
    storage,
    artifacts,
    env,
    bundleRoot,
    logs,
    errors,
    actions,
    async run(...argv: string[]): Promise<{ exitCode: number; json: Record<string, unknown> }> {
      process.exitCode = 0;
      logs.length = 0;
      await program.parseAsync(["bun", "loops", ...argv]);
      const last = logs[logs.length - 1] ?? "{}";
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(last) as Record<string, unknown>;
      } catch {
        parsed = { raw: last };
      }
      return { exitCode: Number(process.exitCode ?? 0), json: parsed };
    },
    async createLoop(name: string) {
      return storage.createLoop({
        name,
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "scripts/run.sh" },
      });
    },
  };
}

function writeScript(dir: string, name: string, body: string): void {
  const path = join(dir, "scripts", name);
  writeFileSync(path, body, { mode: MODE_SCRIPT });
  chmodSync(path, MODE_SCRIPT);
}

describe("loops bundle init", () => {
  test("scaffolds a bundle with a version-0 manifest and never touches the network", async () => {
    const cli = await harness();
    const result = await cli.run("bundle", "init", "demo");
    expect(result.exitCode).toBe(0);
    const dir = join(cli.bundleRoot, "demo");
    expect(readdirSync(dir).sort()).toEqual(["README.md", "loop.json", "manifest.json", "scripts"]);
    const manifest = validateBundleManifest(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
    expect(manifest.version).toBe(0);
    expect(statSync(join(dir, "loop.json")).mode & 0o777).toBe(MODE_DATA);
    expect(statSync(join(dir, "scripts")).mode & 0o777).toBe(0o700);
  });

  test("refuses a non-empty directory without --force", async () => {
    const cli = await harness();
    await cli.run("bundle", "init", "demo");
    const result = await cli.run("bundle", "init", "demo");
    expect(result.exitCode).toBe(3);
    expect(result.json).toMatchObject({ ok: false });
  });

  test("refuses a name that cannot be an object key or a directory", async () => {
    const cli = await harness();
    const result = await cli.run("bundle", "init", "Not A Name");
    expect(result.exitCode).toBe(2);
  });
});

describe("push / pull round trip", () => {
  test("pushes version 1, then pulls it back byte-for-byte with contract modes", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    writeScript(join(cli.bundleRoot, "demo"), "hello.sh", "#!/bin/sh\necho hello\n");

    const pushed = await cli.run("bundle", "push", "demo");
    expect(pushed.exitCode).toBe(0);
    expect(pushed.json).toMatchObject({ ok: true, version: 1, created: true });

    // Wipe the local tree and pull it back: this is the station02 leg.
    const digest = String(pushed.json.bundleDigest);
    rmSync(join(cli.bundleRoot, "demo"), { recursive: true, force: true });
    const pulled = await cli.run("bundle", "pull", "demo");
    expect(pulled.exitCode).toBe(0);
    expect(pulled.json).toMatchObject({ ok: true, version: 1, bundleDigest: digest });

    const dir = join(cli.bundleRoot, "demo");
    expect(readFileSync(join(dir, "scripts", "hello.sh"), "utf8")).toBe("#!/bin/sh\necho hello\n");
    expect(statSync(join(dir, "scripts", "hello.sh")).mode & 0o777).toBe(MODE_SCRIPT);
    expect(statSync(join(dir, "loop.json")).mode & 0o777).toBe(MODE_DATA);
    expect(statSync(join(dir, "manifest.json")).mode & 0o777).toBe(MODE_DATA);
    const marker = readBundleMarker(dir);
    expect(marker).toMatchObject({ bundle: "demo", version: 1, source: "pull", bundleDigest: digest });
  });

  test("--dry-run prints the plan and makes no request at all", async () => {
    const cli = await harness();
    await cli.run("bundle", "init", "demo");
    // A throwing client proves the dry run is offline: any HTTP call fails the test.
    const program = new Command();
    program.exitOverride();
    const throwingClient = new Proxy({} as never, {
      get: () => () => {
        throw new Error("bundle push --dry-run must not make a request");
      },
    });
    registerBundleCommands(program, { json: () => true, client: throwingClient, env: cli.env });
    process.exitCode = 0;
    await program.parseAsync(["bun", "loops", "bundle", "push", "demo", "--dry-run"]);
    expect(Number(process.exitCode ?? 0)).toBe(0);
    expect(cli.logs[cli.logs.length - 1]).toContain('"dryRun": true');
  });

  test("a second push of an unchanged tree is idempotent", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    await cli.run("bundle", "push", "demo");
    const again = await cli.run("bundle", "push", "demo");
    expect(again.json).toMatchObject({ version: 1, created: false });
    expect((await cli.storage.listLoopRevisions(loop.id)).total).toBe(1);
  });

  test("pull refuses to overwrite a locally modified tree unless --allow-dirty", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    await cli.run("bundle", "push", "demo");
    writeScript(join(cli.bundleRoot, "demo"), "local.sh", "#!/bin/sh\necho local\n");

    const refused = await cli.run("bundle", "pull", "demo");
    expect(refused.exitCode).toBe(2);
    expect(existsSync(join(cli.bundleRoot, "demo", "scripts", "local.sh"))).toBe(true);

    const forced = await cli.run("bundle", "pull", "demo", "--allow-dirty");
    expect(forced.exitCode).toBe(0);
    expect(existsSync(join(cli.bundleRoot, "demo", "scripts", "local.sh"))).toBe(false);
  });

  test("an unmanaged directory is never deleted by a failed pull", async () => {
    const cli = await harness();
    const dir = join(cli.bundleRoot, "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "handwritten.txt"), "mine\n");
    // No such loop exists, so the pull fails; the hand-written tree must be
    // exactly where it was. A directory without a marker is never ours to
    // delete.
    const result = await cli.run("bundle", "pull", "demo");
    expect(result.exitCode).toBeGreaterThan(0);
    expect(readFileSync(join(dir, "handwritten.txt"), "utf8")).toBe("mine\n");
  });
});

describe("versions, pin and status", () => {
  test("lists versions, pins one, and refuses a pull of a different version while pinned", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    await cli.run("bundle", "push", "demo");
    writeScript(join(cli.bundleRoot, "demo"), "second.sh", "#!/bin/sh\necho second\n");
    await cli.run("bundle", "push", "demo");

    const listed = await cli.run("bundle", "versions", "demo");
    expect((listed.json.versions as unknown[]).length).toBe(2);

    expect((await cli.run("bundle", "pin", "demo", "1")).json).toMatchObject({ pinnedVersion: 1 });
    const refused = await cli.run("bundle", "pull", "demo", "--version", "2", "--allow-dirty");
    expect(refused.exitCode).toBe(3);

    expect((await cli.run("bundle", "pin", "demo", "--none")).json).toMatchObject({ pinnedVersion: null });
  });

  test("status reports drift without any network call", async () => {
    const cli = await harness();
    await cli.run("bundle", "init", "demo");
    const clean = await cli.run("bundle", "status");
    expect((clean.json.bundles as Array<{ state: string }>)[0]?.state).toBe("clean");

    writeScript(join(cli.bundleRoot, "demo"), "new.sh", "#!/bin/sh\n");
    const dirty = await cli.run("bundle", "status");
    expect((dirty.json.bundles as Array<{ state: string; changedPaths: string[] }>)[0]).toMatchObject({ state: "dirty" });
    expect((dirty.json.bundles as Array<{ changedPaths: string[] }>)[0]?.changedPaths).toContain("scripts/new.sh");
  });

  test("pinning a version that does not exist is exit 4, not a silent success", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    await cli.run("bundle", "push", "demo");
    const result = await cli.run("bundle", "pin", "demo", "42");
    expect(result.exitCode).toBe(4);
  });
});

describe("materialize and sync", () => {
  test("materialize writes a version-0 bundle from a row and uploads nothing", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    const result = await cli.run("bundle", "materialize", "demo");
    expect(result.exitCode).toBe(0);
    const manifest = validateBundleManifest(JSON.parse(readFileSync(join(cli.bundleRoot, "demo", "manifest.json"), "utf8")));
    expect(manifest.version).toBe(0);
    expect((await cli.storage.listLoopRevisions(loop.id)).total).toBe(0);
    expect(readBundleMarker(join(cli.bundleRoot, "demo"))).toMatchObject({ source: "materialize" });
  });

  test("materialize --all reports names that cannot be bundle names instead of inventing one", async () => {
    const cli = await harness();
    await cli.createLoop("Not A Bundle Name");
    const result = await cli.run("bundle", "materialize", "--all");
    expect(result.json).toMatchObject({ materialized: [] });
    expect(JSON.stringify(result.json.skipped)).toContain("loops rename");
  });

  test("sync --dry-run prints a plan and changes nothing", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    await cli.run("bundle", "push", "demo");
    rmSync(join(cli.bundleRoot, "demo"), { recursive: true, force: true });

    const planned = await cli.run("bundle", "sync", "--dry-run");
    expect(planned.exitCode).toBe(0);
    expect(planned.json).toMatchObject({ dryRun: true });
    expect((planned.json.plan as Array<{ action: string }>)[0]?.action).toBe("pull");
    expect(existsSync(join(cli.bundleRoot, "demo"))).toBe(false);

    const synced = await cli.run("bundle", "sync");
    expect(synced.exitCode).toBe(0);
    expect(existsSync(join(cli.bundleRoot, "demo", "manifest.json"))).toBe(true);
  });

  test("sync refuses a diverged bundle rather than merging it", async () => {
    const cli = await harness();
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    await cli.run("bundle", "push", "demo");
    // Remote moves...
    writeScript(join(cli.bundleRoot, "demo"), "remote.sh", "#!/bin/sh\necho remote\n");
    await cli.run("bundle", "push", "demo");
    // ...then the local tree is rolled back to an older manifest and edited.
    const marker = readBundleMarker(join(cli.bundleRoot, "demo"))!;
    writeFileSync(
      join(cli.bundleRoot, "demo", "manifest.json"),
      JSON.stringify({ ...JSON.parse(readFileSync(join(cli.bundleRoot, "demo", "manifest.json"), "utf8")), version: 1 }, null, 2),
    );
    writeScript(join(cli.bundleRoot, "demo"), "local-only.sh", "#!/bin/sh\n");
    expect(marker.version).toBe(2);

    const result = await cli.run("bundle", "sync");
    expect(result.exitCode).toBe(3);
    expect(JSON.stringify(result.json)).toContain("diff");
  });
});

describe("scope refusals", () => {
  test("a key without loops:bundle cannot push or download", async () => {
    const cli = await harness(["loops:read", "loops:write"]);
    const loop = await cli.createLoop("demo");
    await cli.run("bundle", "init", "demo", "--from-loop", loop.id);
    const pushed = await cli.run("bundle", "push", "demo");
    expect(pushed.exitCode).toBe(5);
    expect((await cli.storage.listLoopRevisions(loop.id)).total).toBe(0);
  });
});

describe("credential and verb-collision handling", () => {
  test("a missing API URL is EX_CONFIG (78), not a silent local fallback", () => {
    expect(() => createBundleApiClient({})).toThrow(/HASNA_LOOPS_API_URL/);
    try {
      createBundleApiClient({});
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(78);
    }
  });

  test("push refuses an argument that cannot be a bundle name, rather than treating it as a loop", async () => {
    // The positional is what distinguishes `loops push demo` (the bundle verb)
    // from `loops push --apply` (the shipped row backfill), so an unusable
    // positional has to fail loudly instead of silently doing the other thing.
    const cli = await harness();
    const result = await cli.run("bundle", "push", "Not A Name");
    expect(result.exitCode).toBe(2);
  });
});

describe("hosted mode (#1613)", () => {
  test("no bundle verb creates a local database under the data dir", async () => {
    const cli = await harness();
    const dataDir = tempDir("loops-hosted-data-");
    const env = { ...cli.env, LOOPS_DATA_DIR: dataDir, HASNA_LOOPS_DATA_DIR: dataDir };
    const program = new Command();
    program.exitOverride();
    const client = createBundleApiClient(env);
    registerBundleCommands(program, { json: () => true, client, env });
    const loop = await cli.createLoop("demo");

    for (const argv of [
      ["bundle", "init", "demo", "--from-loop", loop.id],
      ["bundle", "push", "demo"],
      ["bundle", "versions", "demo"],
      ["bundle", "pull", "demo", "--allow-dirty"],
      ["bundle", "status"],
      ["bundle", "sync", "--dry-run"],
      ["bundle", "materialize", "demo"],
    ]) {
      await program.parseAsync(["bun", "loops", ...argv]);
    }
    const stray = readdirSync(dataDir).filter((entry) => entry.endsWith(".db"));
    expect(stray).toEqual([]);
  });
});
