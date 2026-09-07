import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";

// The storage-mode axis is retired (owner directive 2026-08-15): `key`,
// `encrypt-vault` and `gc` must WORK in the hosted transport, not refuse to run.
// These tests drive the real CLI at a stand-in cloud API and assert exit 0 plus
// truthful output — the guards this suite replaces exited 1 with
// "is a local-vault operation; in api mode ...".
// Exercise mirrors tests/cli-get.test.ts (in-process Bun.serve stub so spawn is
// async; spawnSync would deadlock the shared event loop).

const rootDir = join(import.meta.dir, "..");

let server: ReturnType<typeof Bun.serve>;

const META = {
  "expired/allcmds/1": { key: "expired/allcmds/1", type: "other", expires_at: "2020-01-01T00:00:00.000Z", created_at: "t", updated_at: "t" },
  "live/allcmds/1": { key: "live/allcmds/1", type: "api_key", expires_at: "2999-01-01T00:00:00.000Z", created_at: "t", updated_at: "t" },
  "live/allcmds/2": { key: "live/allcmds/2", type: "password", created_at: "t", updated_at: "t" },
};

beforeAll(() => {
  const deleted: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch(req: Request) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/secrets" && req.method === "GET") {
        return Response.json({ secrets: Object.values(META) });
      }
      if (url.pathname === "/v1/secrets" && req.method === "DELETE") {
        const key = url.searchParams.get("key");
        if (!key) return Response.json({ error: "Missing key" }, { status: 400 });
        deleted.push(key);
        return Response.json({ deleted: true });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  (globalThis as any).__allcmdsDeleted = deleted;
});

afterAll(() => {
  server.stop(true);
});

async function runCli(...args: string[]) {
  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    env: {
      ...process.env,
      HASNA_SECRETS_API_URL: `http://localhost:${server.port}`,
      HASNA_SECRETS_API_KEY: "test-api-key",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("hosted transport: maintenance commands are not transport-gated", () => {
  it("key / key init / key path / key exists / key kms all exit 0 and report server-owned encryption", async () => {
    const status = await runCli("key");
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("server-owned");
    expect(status.stdout).toContain("hosted vault");

    const init = await runCli("key", "init");
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain("Nothing to initialize");

    const path = await runCli("key", "path");
    expect(path.exitCode).toBe(0);
    expect(path.stdout.trim()).toContain(`http://localhost:${server.port}`);

    const exists = await runCli("key", "exists");
    expect(exists.exitCode).toBe(0);
    expect(exists.stdout.trim()).toBe("no");

    const kms = await runCli("key", "kms");
    expect(kms.exitCode).toBe(0);
    expect(kms.stdout).toContain("KMS envelope encryption is managed by the hosted deployment");

    const kmsSetup = await runCli("key", "kms", "setup", "--key-id", "alias/exercise");
    expect(kmsSetup.exitCode).toBe(0);
  });

  it("encrypt-vault exits 0 and reports every stored value already encrypted at rest", async () => {
    const { stdout, stderr, exitCode } = await runCli("encrypt-vault");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Encrypted 0 secret(s). 3 already encrypted.");
    expect(stderr).not.toContain("local-vault operation");
  });

  it("gc prunes lapsed rows through the API instead of being a silent no-op", async () => {
    const { stdout, exitCode } = await runCli("gc");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pruned 1 expired secret(s)");
    expect((globalThis as any).__allcmdsDeleted).toEqual(["expired/allcmds/1"]);
  });
});