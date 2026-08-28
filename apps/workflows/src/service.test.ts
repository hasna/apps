import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkflowsService, packageVersion, resolveWorkflowsConfig } from "./service.js";

const pkgDir = join(import.meta.dir, "..");

function pkgVersion(): string {
  return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version as string;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("workflows service (slice 1 scaffold)", () => {
  test("packageVersion() equals the package.json version", () => {
    expect(packageVersion()).toBe(pkgVersion());
  });

  test("default config resolves port 8790 and the legacy data dir until the resolver home is adopted", () => {
    const before = {
      dataDir: process.env.HASNA_WORKFLOWS_DATA_DIR,
      dataDirAlias: process.env.WORKFLOWS_DATA_DIR,
      dataKind: process.env.HASNA_DATA_HOME,
    };
    try {
      delete process.env.HASNA_WORKFLOWS_DATA_DIR;
      delete process.env.WORKFLOWS_DATA_DIR;
      delete process.env.HASNA_DATA_HOME;
      const cfg = resolveWorkflowsConfig();
      expect(cfg.port).toBe(8790);
      expect(cfg.host).toBe("127.0.0.1");
      expect(cfg.dataDir.endsWith(".hasna/workflows")).toBe(true);
    } finally {
      restoreEnv("HASNA_WORKFLOWS_DATA_DIR", before.dataDir);
      restoreEnv("WORKFLOWS_DATA_DIR", before.dataDirAlias);
      restoreEnv("HASNA_DATA_HOME", before.dataKind);
    }
  });

  test("config resolves the resolver data dir once HASNA_DATA_HOME opts in to the XDG layout", () => {
    const before = {
      dataDir: process.env.HASNA_WORKFLOWS_DATA_DIR,
      dataDirAlias: process.env.WORKFLOWS_DATA_DIR,
      dataKind: process.env.HASNA_DATA_HOME,
    };
    try {
      delete process.env.HASNA_WORKFLOWS_DATA_DIR;
      delete process.env.WORKFLOWS_DATA_DIR;
      process.env.HASNA_DATA_HOME = "/srv/xdg-data";
      const cfg = resolveWorkflowsConfig();
      expect(cfg.dataDir).toBe("/srv/xdg-data/workflows");
    } finally {
      restoreEnv("HASNA_WORKFLOWS_DATA_DIR", before.dataDir);
      restoreEnv("WORKFLOWS_DATA_DIR", before.dataDirAlias);
      restoreEnv("HASNA_DATA_HOME", before.dataKind);
    }
  });

  test("config env overrides win over defaults (HASNA_WORKFLOWS_ prefix)", () => {
    const before = { port: process.env.HASNA_WORKFLOWS_PORT, host: process.env.HASNA_WORKFLOWS_HOST };
    try {
      process.env.HASNA_WORKFLOWS_PORT = "9876";
      process.env.HASNA_WORKFLOWS_HOST = "0.0.0.0";
      const cfg = resolveWorkflowsConfig();
      expect(cfg.port).toBe(9876);
      expect(cfg.host).toBe("0.0.0.0");
    } finally {
      if (before.port === undefined) delete process.env.HASNA_WORKFLOWS_PORT;
      else process.env.HASNA_WORKFLOWS_PORT = before.port;
      if (before.host === undefined) delete process.env.HASNA_WORKFLOWS_HOST;
      else process.env.HASNA_WORKFLOWS_HOST = before.host;
    }
  });

  test("explicit config overrides env", () => {
    const before = process.env.HASNA_WORKFLOWS_PORT;
    try {
      process.env.HASNA_WORKFLOWS_PORT = "1111";
      const svc = createWorkflowsService({ port: 2222 });
      expect(svc.config.port).toBe(2222);
    } finally {
      if (before === undefined) delete process.env.HASNA_WORKFLOWS_PORT;
      else process.env.HASNA_WORKFLOWS_PORT = before;
    }
  });

  test("health() reports ok with service name and version", () => {
    const h = createWorkflowsService().health();
    expect(h.ok).toBe(true);
    expect(h.service).toBe("workflows");
    expect(h.version).toBe(pkgVersion());
    expect(h.pid).toBeGreaterThan(0);
    expect(h.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  test("ready() reports ok with a version check", () => {
    const r = createWorkflowsService().ready();
    expect(r.ok).toBe(true);
    expect(r.service).toBe("workflows");
    expect(r.checks).toEqual({ version: "ok" });
  });
});
