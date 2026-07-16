import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { OpenSecurityClient } from "./client.js";
import { Database } from "bun:sqlite";

const originalFetch = globalThis.fetch;
let child: ChildProcess | undefined;
let tempDir: string | undefined;

afterEach(() => {
  globalThis.fetch = originalFetch;
  child?.kill("SIGTERM");
  child = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP port allocated"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

describe("OpenSecurityClient scan source boundary", () => {
  test("omits sensitive-source opt-ins by default and forwards explicit choices", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "scan", scanner_types: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new OpenSecurityClient("http://127.0.0.1:1");
    await client.triggerScan("/synthetic/repo");
    await client.triggerScan("/synthetic/repo", {
      include_git_history: true,
      include_system: true,
    });

    expect(bodies[0]).toEqual({ path: "/synthetic/repo" });
    expect(bodies[1]).toEqual({
      path: "/synthetic/repo",
      include_git_history: true,
      include_system: true,
    });
  });

  test("does not expose scanner-recognized values returned through the SDK", async () => {
    globalThis.fetch = originalFetch;
    tempDir = mkdtempSync(join(tmpdir(), "shield-sdk-boundary-"));
    const synthetic = `gh${"r"}_${"A_".repeat(18)}`;
    const projectDir = join(tempDir, synthetic);
    mkdirSync(projectDir);
    const port = await availablePort();
    child = spawn("bun", ["run", "src/server/index.ts"], {
      cwd: resolve(import.meta.dir, "../.."),
      env: {
        ...process.env,
        PORT: String(port),
        HOME: tempDir,
        USERPROFILE: tempDir,
        SECURITY_DB: join(tempDir, "shield.db"),
        CEREBRAS_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("REST test server did not start")), 5_000);
      child!.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`REST test server exited early (${code})`));
      });
      child!.stdout!.on("data", (chunk) => {
        if (String(chunk).includes("security dashboard")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const client = new OpenSecurityClient(`http://127.0.0.1:${port}`);
    const created = await client.createProject(`project-${synthetic}`, projectDir);
    const listed = await client.listProjects();
    for (const output of [JSON.stringify(created), JSON.stringify(listed)]) {
      expect(output).not.toContain(synthetic);
      expect(output).toContain("REDACTED");
    }

    const scan = await client.triggerScan(tempDir);
    const db = new Database(join(tempDir, "shield.db"));
    try {
      db.prepare("UPDATE scans SET error = ? WHERE id = ?").run(synthetic, scan.id);
    } finally {
      db.close();
    }
    const fetchedScan = await client.getScan(scan.id);
    const listedScans = await client.listScans();
    for (const output of [JSON.stringify(fetchedScan), JSON.stringify(listedScans)]) {
      expect(output).not.toContain(synthetic);
      expect(output).toContain("REDACTED");
    }
  });
});
