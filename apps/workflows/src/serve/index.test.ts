import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkflowsService } from "../service.js";
import { createWorkflowsServer } from "./server.js";

const pkgDir = join(import.meta.dir, "..", "..");
const pkgVersion = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version as string;

const servers: { stop: () => void }[] = [];

function startServer(port: number) {
  const server = createWorkflowsServer(createWorkflowsService({ port, host: "127.0.0.1" }));
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop();
});

describe("workflows-serve (slice 1 scaffold)", () => {
  test("/health returns 200 with a health report", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const h = (await res.json()) as { ok: boolean; service: string; version: string };
    expect(h.ok).toBe(true);
    expect(h.service).toBe("workflows");
    expect(h.version).toBe(pkgVersion);
  });

  test("/ready returns 200 with the version check", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    const r = (await res.json()) as { ok: boolean; checks: Record<string, string> };
    expect(r.ok).toBe(true);
    expect(r.checks).toEqual({ version: "ok" });
  });

  test("/version returns service name and version", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/version`);
    expect(res.status).toBe(200);
    const v = (await res.json()) as { service: string; version: string };
    expect(v.service).toBe("workflows");
    expect(v.version).toBe(pkgVersion);
  });

  test("/openapi.json returns a document describing the scaffold endpoints", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/openapi.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toContain("3.");
    expect(Object.keys(doc.paths)).toContain("/health");
    expect(Object.keys(doc.paths)).toContain("/ready");
    expect(Object.keys(doc.paths)).toContain("/version");
  });

  test("unknown paths return 404", async () => {
    const base = startServer(0);
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  test("--version answers before binding and exits 0", async () => {
    const proc = Bun.spawn(["bun", "src/serve/index.ts", "--version"], { cwd: pkgDir, stdout: "pipe", stderr: "pipe" });
    const stdout = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toBe(pkgVersion);
  });

  test("--help answers before binding and exits 0", async () => {
    const proc = Bun.spawn(["bun", "src/serve/index.ts", "--help"], { cwd: pkgDir, stdout: "pipe", stderr: "pipe" });
    const stdout = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toContain("workflows-serve");
  });
});
