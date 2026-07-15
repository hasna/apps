import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { ScannerType } from "../types/index.js";

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

describe("REST scan source boundary", () => {
  let tempDir: string;
  let child: ChildProcess | null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shield-rest-boundary-"));
    child = null;
  });

  afterEach(() => {
    child?.kill("SIGTERM");
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("POST /api/scans defaults to file-only scanner types", async () => {
    const port = await availablePort();
    child = spawn("bun", ["run", "src/server/index.ts"], {
      cwd: process.cwd(),
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

    const response = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });
    expect(response.status).toBe(202);
    const scan = await response.json() as { scanner_types: ScannerType[] };
    expect(scan.scanner_types).not.toContain(ScannerType.GitHistory);
    expect(scan.scanner_types).toContain(ScannerType.Code);
  });
});
