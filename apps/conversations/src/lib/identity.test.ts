import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const ISOLATED_CHILD_ENV = "CONVERSATIONS_IDENTITY_TEST_CHILD";

function fingerprint(path: string): string {
  if (!existsSync(path)) return "absent";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (process.env[ISOLATED_CHILD_ENV] !== "1") {
  test("identity contract cannot mutate inherited production state", async () => {
    const realHome = process.env.HOME || process.env.USERPROFILE;
    if (!realHome) throw new Error("HOME or USERPROFILE is required");

    const root = mkdtempSync(join(tmpdir(), "conversations-identity-isolation-"));
    const home = join(root, "home");
    const temp = join(root, "tmp");
    const productionDbPath = join(root, "production.db");
    const configPath = join(root, "production-config.json");
    const alternateDbPath = join(root, "alternate.db");
    const realAgentIdPath = join(realHome, ".hasna", "conversations", "agent-id");
    mkdirSync(home, { recursive: true });
    mkdirSync(temp, { recursive: true });
    writeFileSync(productionDbPath, "production-database-sentinel");
    writeFileSync(configPath, "production-config-sentinel");

    const before = {
      agentId: fingerprint(realAgentIdPath),
      database: fingerprint(productionDbPath),
      config: fingerprint(configPath),
    };

    try {
      const subprocess = Bun.spawn(
        [process.execPath, "test", fileURLToPath(import.meta.url)],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            [ISOLATED_CHILD_ENV]: "1",
            HOME: home,
            USERPROFILE: home,
            TMPDIR: temp,
            HASNA_CONVERSATIONS_DB_PATH: productionDbPath,
            CONVERSATIONS_DB_PATH: alternateDbPath,
            CONVERSATIONS_CONFIG_PATH: configPath,
            HASNA_CONVERSATIONS_STORAGE_MODE: "self_hosted",
            HASNA_CONVERSATIONS_API_URL: "http://127.0.0.1:1",
            HASNA_CONVERSATIONS_API_KEY: "identity-test-key",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ]);

      expect(
        { exitCode, stdout, stderr },
        "isolated identity contract failed",
      ).toMatchObject({ exitCode: 0 });
      expect({
        agentId: fingerprint(realAgentIdPath),
        database: fingerprint(productionDbPath),
        config: fingerprint(configPath),
      }).toEqual(before);
      expect(existsSync(alternateDbPath)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
} else {
  const {
    resolveIdentity,
    requireIdentity,
    getAutoName,
    _resetAutoName,
  } = await import("./identity.js");
  const { AGENT_NAMES } = await import("./names.js");
  const agentIdFile = join(process.env.HOME!, ".hasna", "conversations", "agent-id");
  const inheritedAgentId = process.env.CONVERSATIONS_AGENT_ID;

  beforeEach(() => {
    rmSync(agentIdFile, { force: true });
    if (inheritedAgentId !== undefined) {
      process.env.CONVERSATIONS_AGENT_ID = inheritedAgentId;
    } else {
      delete process.env.CONVERSATIONS_AGENT_ID;
    }
    _resetAutoName();
  });

  afterEach(() => {
    rmSync(agentIdFile, { force: true });
    if (inheritedAgentId !== undefined) {
      process.env.CONVERSATIONS_AGENT_ID = inheritedAgentId;
    } else {
      delete process.env.CONVERSATIONS_AGENT_ID;
    }
    _resetAutoName();
  });

  describe("resolveIdentity", () => {
    test("returns explicit value when provided", () => {
      expect(resolveIdentity("alice")).toBe("alice");
    });

    test("returns env var when no explicit value", () => {
      process.env.CONVERSATIONS_AGENT_ID = "env-agent";
      expect(resolveIdentity()).toBe("env-agent");
    });

    test("explicit takes priority over env", () => {
      process.env.CONVERSATIONS_AGENT_ID = "env-agent";
      expect(resolveIdentity("explicit")).toBe("explicit");
    });

    test("falls back to auto-generated name when nothing set", () => {
      delete process.env.CONVERSATIONS_AGENT_ID;
      const name = resolveIdentity();
      expect(name).not.toBe("user");
      expect(AGENT_NAMES).toContain(name as any);
    });

    test("auto-generated name is consistent across calls", () => {
      delete process.env.CONVERSATIONS_AGENT_ID;
      const name1 = resolveIdentity();
      const name2 = resolveIdentity();
      expect(name1).toBe(name2);
    });
  });

  describe("getAutoName", () => {
    test("returns a name from the pool", () => {
      const name = getAutoName();
      expect(AGENT_NAMES).toContain(name as any);
    });

    test("persists name to file", () => {
      const name = getAutoName();
      const persisted = readFileSync(agentIdFile, "utf-8").trim();
      expect(persisted).toBe(name);
    });

    test("reads persisted name on subsequent calls", () => {
      mkdirSync(join(process.env.HOME!, ".hasna", "conversations"), { recursive: true });
      writeFileSync(agentIdFile, "custom-persisted-name\n", "utf-8");
      _resetAutoName();
      const name = getAutoName();
      expect(name).toBe("custom-persisted-name");
    });

    test("is cached in memory after first call", () => {
      const name1 = getAutoName();
      rmSync(agentIdFile, { force: true });
      const name2 = getAutoName();
      expect(name1).toBe(name2);
    });
  });

  describe("AGENT_NAMES", () => {
    test("has at least 200 names", () => {
      expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(200);
    });

    test("all names are unique", () => {
      const unique = new Set(AGENT_NAMES);
      expect(unique.size).toBe(AGENT_NAMES.length);
    });

    test("all names are lowercase kebab-case", () => {
      for (const name of AGENT_NAMES) {
        expect(name).toMatch(/^[a-z]+-[a-z]+$/);
      }
    });
  });

  describe("requireIdentity", () => {
    test("returns explicit value when provided", () => {
      expect(requireIdentity("alice")).toBe("alice");
    });

    test("returns env var when no explicit value", () => {
      process.env.CONVERSATIONS_AGENT_ID = "env-agent";
      expect(requireIdentity()).toBe("env-agent");
    });

    test("throws when no identity available", () => {
      delete process.env.CONVERSATIONS_AGENT_ID;
      expect(() => requireIdentity()).toThrow("Agent identity required");
    });
  });
}
