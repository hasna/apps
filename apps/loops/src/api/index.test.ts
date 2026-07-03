import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const apiPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

describe("loops-api foundation", () => {
  test("status output is import-safe and path-safe", async () => {
    const mod = await import("./index.js");
    const status = mod.apiStatus();

    expect(status.ok).toBe(true);
    expect(status.service).toBe("loops-api");
    expect(status.status.deploymentMode).toBe("self_hosted");
    expect(JSON.stringify(status)).not.toContain("dataDir");
    expect(JSON.stringify(status)).not.toContain("dbPath");
  });

  test("status command JSON uses the service envelope", () => {
    const result = spawnSync(process.execPath, [apiPath, "--json", "status"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout) as { ok: boolean; service: string; status: { deploymentMode: string } };
    expect(body).toMatchObject({
      ok: true,
      service: "loops-api",
      status: {
        deploymentMode: "self_hosted",
      },
    });
  });

  test("status output redacts credentials embedded in API URLs", async () => {
    const previousUrl = process.env.LOOPS_API_URL;
    const previousToken = process.env.LOOPS_API_TOKEN;
    process.env.LOOPS_API_URL = "https://user:fake-password@loops.example.test/api?token=fake-token";
    process.env.LOOPS_API_TOKEN = "present-but-not-returned";
    try {
      const mod = await import("./index.js");
      const status = JSON.stringify(mod.apiStatus());
      expect(status).toContain("https://loops.example.test/api");
      expect(status).not.toContain("fake-password");
      expect(status).not.toContain("fake-token");
      expect(status).not.toContain("present-but-not-returned");
    } finally {
      if (previousUrl === undefined) delete process.env.LOOPS_API_URL;
      else process.env.LOOPS_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.LOOPS_API_TOKEN;
      else process.env.LOOPS_API_TOKEN = previousToken;
    }
  });

  test("non-local serve fails closed without an API token", () => {
    const result = spawnSync(process.execPath, [apiPath, "serve", "--host", "0.0.0.0", "--port", "0"], {
      env: {
        ...process.env,
        LOOPS_API_TOKEN: "",
        HASNA_LOOPS_API_TOKEN: "",
      },
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("non-local loops-api binds require");
  });

  test("non-local serve requires the configured bearer token", async () => {
    const previousToken = process.env.LOOPS_API_TOKEN;
    const previousHasnaToken = process.env.HASNA_LOOPS_API_TOKEN;
    process.env.LOOPS_API_TOKEN = "test-api-token";
    process.env.HASNA_LOOPS_API_TOKEN = "";

    const mod = await import("./index.js");
    const server = mod.createLoopsApiServer({ host: "0.0.0.0", port: 0 });
    const url = `http://127.0.0.1:${server.port}/status`;
    try {
      const missing = await fetch(url);
      expect(missing.status).toBe(401);
      const wrong = await fetch(url, { headers: { authorization: "Bearer wrong-token" } });
      expect(wrong.status).toBe(401);
      const ok = await fetch(url, { headers: { authorization: "Bearer test-api-token" } });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { ok: boolean; service: string };
      expect(body).toMatchObject({ ok: true, service: "loops-api" });
    } finally {
      server.stop(true);
      if (previousToken === undefined) delete process.env.LOOPS_API_TOKEN;
      else process.env.LOOPS_API_TOKEN = previousToken;
      if (previousHasnaToken === undefined) delete process.env.HASNA_LOOPS_API_TOKEN;
      else process.env.HASNA_LOOPS_API_TOKEN = previousHasnaToken;
    }
  });
});
