import {
  describe,
  test,
  expect,
  afterEach,
  afterAll,
  beforeAll,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startServer } from "./serve.js";
import { connectorsHome } from "../lib/paths.js";

const TEST_ID = `zzztest${process.pid}m`;
const ORIGINAL_HOME = process.env.HOME;
const TEST_HOME = mkdtempSync(join(tmpdir(), "connectors-server-mgmt-"));

function testConfigDir(name: string): string {
  return join(connectorsHome(), name);
}

function legacyTestConfigDir(name: string): string {
  return join(connectorsHome(), `connect-${name}`);
}

function cleanupTestConnectors(...names: string[]) {
  for (const name of names) {
    for (const dir of [testConfigDir(name), legacyTestConfigDir(name)]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  }
}

function cleanupProjectEnablement() {
  const connectorsDir = join(process.cwd(), ".connectors");
  if (existsSync(connectorsDir)) {
    rmSync(connectorsDir, { recursive: true });
  }
}

describe("server management routes", () => {
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.HOME = TEST_HOME;
    serverPort = 50000 + Math.floor(Math.random() * 10000);
    serverPort = await startServer(serverPort, { open: false });
    baseUrl = `http://localhost:${serverPort}`;
  });

  afterAll(() => {
    if (ORIGINAL_HOME) {
      process.env.HOME = ORIGINAL_HOME;
    } else {
      delete process.env.HOME;
    }
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe("POST /api/connectors/:name/install", () => {
    afterEach(() => {
      cleanupProjectEnablement();
    });

    test("returns 400 for invalid connector name", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/INVALID/install`, {
        method: "POST",
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });

    test("returns 404 for non-existent connector", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/nonexistent-xyz-abc/install`,
        { method: "POST" }
      );
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("not found");
    });

    test("installs a valid connector and returns success", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/anthropic/install`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean; name: string };
      expect(data.success).toBe(true);
      expect(data.name).toBe("anthropic");
    });

    test("after install, GET /api/connectors shows installed=true", async () => {
      // Install first
      const installRes = await fetch(
        `${baseUrl}/api/connectors/anthropic/install`,
        { method: "POST" }
      );
      expect(installRes.status).toBe(200);

      // Verify installed=true in the list
      const listRes = await fetch(`${baseUrl}/api/connectors`);
      const data = (await listRes.json()) as Array<{
        name: string;
        installed: boolean;
      }>;
      const anthropic = data.find((c) => c.name === "anthropic");
      expect(anthropic).toBeDefined();
      expect(anthropic!.installed).toBe(true);
    });
  });

  // ── POST /api/connectors/:name/uninstall ──

  describe("POST /api/connectors/:name/uninstall", () => {
    afterEach(() => {
      cleanupProjectEnablement();
    });

    test("returns 400 for invalid connector name", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/INVALID/uninstall`, {
        method: "POST",
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });

    test("returns 404 when connector is not installed", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/anthropic/uninstall`,
        { method: "POST" }
      );
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("not installed");
    });

    test("uninstalls a previously installed connector", async () => {
      // Install first
      const installRes = await fetch(
        `${baseUrl}/api/connectors/anthropic/install`,
        { method: "POST" }
      );
      expect(installRes.status).toBe(200);

      // Uninstall
      const res = await fetch(
        `${baseUrl}/api/connectors/anthropic/uninstall`,
        { method: "POST" }
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean; name: string };
      expect(data.success).toBe(true);
      expect(data.name).toBe("anthropic");
    });
  });

  // ── POST /api/update ──

  describe("POST /api/update", () => {
    afterEach(() => {
      cleanupProjectEnablement();
    });

    test("returns successfully with count field", async () => {
      const res = await fetch(`${baseUrl}/api/update`, { method: "POST" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { count: number };
      expect(typeof data.count).toBe("number");
      expect(data.count).toBeGreaterThanOrEqual(0);
    });

    test("after installing a connector, update returns results", async () => {
      // Install first
      const installRes = await fetch(
        `${baseUrl}/api/connectors/anthropic/install`,
        { method: "POST" }
      );
      expect(installRes.status).toBe(200);

      // Update
      const res = await fetch(`${baseUrl}/api/update`, { method: "POST" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        results: Array<{ success: boolean }>;
        count: number;
        total: number;
      };
      expect(data.total).toBeGreaterThanOrEqual(1);
      expect(data.count).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(data.results)).toBe(true);
    });
  });

  describe("GET /api/connectors/:name/operations", () => {
    test("returns internal command surface for github", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/github/operations`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        commands: string[];
        operations: Array<{ name: string; source: string; summary: string }>;
        auth: { type: string; configured: boolean };
        helpText: string;
      };
      expect(data.connector).toBe("github");
      expect(data.commands).toContain("repo");
      expect(data.commands).toContain("user");
      expect(data.auth.type).toBe("apikey");
      expect(data.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "repo", source: "internal" }),
        ])
      );
      expect(data.helpText).toContain("connect-github");
    });

    test("returns internal command surface for stripe", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe/operations`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        commands: string[];
        operations: Array<{ name: string; aliases: string[]; source: string }>;
        auth: { type: string; configured: boolean };
        helpText: string;
      };
      expect(data.connector).toBe("stripe");
      expect(data.commands).toContain("config");
      expect(data.commands).toContain("products");
      expect(data.auth.type).toBe("bearer");
      expect(data.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "products", source: "internal" }),
        ])
      );
      expect(data.helpText).toContain("connect-stripe");
    });

    test("returns clean typed command descriptors for skill connectors", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/googlegemini/operations`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        commands: string[];
        operations: Array<{ name: string; aliases: string[]; usage: string; summary: string; source: string }>;
        auth: { type: string; configured: boolean };
      };

      expect(data.connector).toBe("googlegemini");
      expect(data.commands).toContain("generate");
      expect(data.commands).toContain("image");
      expect(data.commands).not.toContain("generate|gen");
      expect(data.auth.type).toBe("apikey");
      expect(data.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "generate",
            aliases: ["gen"],
            source: "cli",
          }),
          expect.objectContaining({
            name: "image",
            aliases: ["img"],
            source: "cli",
          }),
        ])
      );
    });
  });

  describe("GET /api/connectors/:name/operations/:command", () => {
    test("returns help text for github user command", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/github/operations/user`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        command: string;
        help: string;
      };
      expect(data.connector).toBe("github");
      expect(data.command).toBe("user");
      expect(data.help).toContain("info [username]");
    });

    test("returns help text for stripe products command", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe/operations/products`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        command: string;
        help: string;
      };
      expect(data.connector).toBe("stripe");
      expect(data.command).toBe("products");
      expect(data.help).toContain("Manage products");
    });
  });

  describe("GET /api/connectors/manifest", () => {
    test("returns scoped capability manifest", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/manifest?connectors=github&includeOperations=true`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        packageName: string;
        connectorCount: number;
        connectors: Array<{ id: string; aliases: string[]; operations?: Array<{ name: string }> }>;
      };
      expect(data.packageName).toBe("@hasna/connectors");
      expect(data.connectorCount).toBe(1);
      expect(data.connectors[0]?.id).toBe("github");
      expect(data.connectors[0]?.aliases).toContain("connect-github");
      expect(data.connectors[0]?.operations?.some((operation) => operation.name === "config")).toBe(true);
    });
  });

  describe("POST /api/connectors/:name/operations/run", () => {
    test("runs an internal github command", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/github/operations/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["config", "show"], format: "json" }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        success: boolean;
        output: string;
      };
      expect(data.connector).toBe("github");
      expect(data.success).toBe(true);
      expect(data.output).toContain("\"profile\"");
    });

    test("runs an internal stripe command", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe/operations/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["config", "show"], format: "json" }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        success: boolean;
        output: string;
      };
      expect(data.connector).toBe("stripe");
      expect(data.success).toBe(true);
      expect(data.output).toContain("\"profile\"");
    });

    test("runs a legacy CLI-backed connector command", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/anthropic/operations/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["models"], format: "json" }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        success: boolean;
        output: string;
      };
      expect(data.connector).toBe("anthropic");
      expect(data.success).toBe(true);
      expect(data.output).toContain("claude");
    });

    test("runs a structured connector operation", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/github/operations/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "config",
          input: { args: ["show"], format: "json" },
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connector: string;
        operation: string;
        success: boolean;
        data?: { profile: string };
      };
      expect(data.connector).toBe("github");
      expect(data.operation).toBe("config");
      expect(data.success).toBe(true);
      expect(data.data?.profile).toBe("default");
    });
  });

  // ── GET /api/activity ──

  describe("GET /api/activity", () => {
    const testName = `${TEST_ID}activity`;

    afterEach(() => {
      cleanupTestConnectors(testName);
    });

    test("returns an array", async () => {
      const res = await fetch(`${baseUrl}/api/activity`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as unknown[];
      expect(Array.isArray(data)).toBe(true);
    });

    test("after saving a key, activity log contains the entry", async () => {
      // Save a key to trigger an activity log entry
      await fetch(`${baseUrl}/api/connectors/${testName}/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "activity-test-key" }),
      });

      const res = await fetch(`${baseUrl}/api/activity`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Array<{
        action: string;
        connector: string;
        timestamp: number;
      }>;
      const entry = data.find(
        (a) => a.connector === testName && a.action === "key_saved"
      );
      expect(entry).toBeDefined();
      expect(entry!.timestamp).toBeGreaterThan(0);
    });
  });

  // ── GET /api/connectors/:name/profiles ──

  describe("GET /api/connectors/:name/profiles", () => {
    test("returns default profile for unconfigured connector", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/anthropic/profiles`
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        current: string;
        profiles: string[];
      };
      expect(data.current).toBe("default");
      expect(Array.isArray(data.profiles)).toBe(true);
      expect(data.profiles).toContain("default");
    });

    test("returns 400 for invalid name", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/INVALID/profiles`
      );
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });
  });

  // ── POST /api/connectors/:name/profiles/switch ──

  describe("POST /api/connectors/:name/profiles/switch", () => {
    const testName = `${TEST_ID}profswitch`;

    afterEach(() => {
      cleanupTestConnectors(testName);
    });

    test("switches profile and returns success", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/${testName}/profiles/switch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: "production" }),
        }
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        profile: string;
      };
      expect(data.success).toBe(true);
      expect(data.profile).toBe("production");

      // Verify the current_profile file was written
      const currentFile = join(
        testConfigDir(testName),
        "current_profile"
      );
      expect(existsSync(currentFile)).toBe(true);
      expect(readFileSync(currentFile, "utf-8")).toBe("production");
    });

    test("returns 400 for missing profile in body", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/${testName}/profiles/switch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Missing 'profile'");
    });

    test("returns 400 for invalid name", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/INVALID/profiles/switch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: "test" }),
        }
      );
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });
  });

  // ── DELETE /api/connectors/:name/profiles/:profile ──

  describe("DELETE /api/connectors/:name/profiles/:profile", () => {
    const testName = `${TEST_ID}profdel`;

    afterEach(() => {
      cleanupTestConnectors(testName);
    });

    test("returns 400 for default profile", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/${testName}/profiles/default`,
        { method: "DELETE" }
      );
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Cannot delete the default profile");
    });

    test("returns 400 for invalid connector name", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/INVALID/profiles/staging`,
        { method: "DELETE" }
      );
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });

    test("returns 404 for non-existent profile", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/${testName}/profiles/nonexistent`,
        { method: "DELETE" }
      );
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("not found");
    });
  });

  // ── GET /api/export ──

  describe("GET /api/export", () => {
    test("returns JSON with connectors and exportedAt fields", async () => {
      const res = await fetch(`${baseUrl}/api/export`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        connectors: Record<string, unknown>;
        exportedAt: string;
      };
      expect(data).toHaveProperty("connectors");
      expect(data).toHaveProperty("exportedAt");
      expect(typeof data.connectors).toBe("object");
      expect(typeof data.exportedAt).toBe("string");
    });

    test("has Content-Disposition header", async () => {
      const res = await fetch(`${baseUrl}/api/export`);
      expect(res.status).toBe(200);
      const disposition = res.headers.get("Content-Disposition");
      expect(disposition).toBeDefined();
      expect(disposition).toContain("attachment");
      expect(disposition).toContain("connectors-backup");
    });
  });

  // ── POST /api/import ──

  describe("POST /api/import", () => {
    const testName = `${TEST_ID}import`;

    afterEach(() => {
      cleanupTestConnectors(testName);
    });

    test("returns 400 for invalid format (missing connectors)", async () => {
      const res = await fetch(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "invalid" }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid import format");
    });

    test("imports valid data and returns count", async () => {
      const importData = {
        connectors: {
          [testName]: {
            profiles: {
              default: { apiKey: "imported-key-123" },
            },
          },
        },
      };

      const res = await fetch(`${baseUrl}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importData),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        imported: number;
      };
      expect(data.success).toBe(true);
      expect(data.imported).toBe(1);

      // Verify the profile was actually written to disk
      const profileFile = join(
        testConfigDir(testName),
        "profiles",
        "default.json"
      );
      expect(existsSync(profileFile)).toBe(true);
      const saved = JSON.parse(readFileSync(profileFile, "utf-8"));
      expect(saved.apiKey).toBe("imported-key-123");
    });
  });
});
