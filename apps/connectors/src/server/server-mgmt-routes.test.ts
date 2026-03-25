import {
  describe,
  test,
  expect,
  afterEach,
  beforeAll,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { startServer } from "./serve.js";

const HOME = homedir();
const TEST_ID = `zzztest${process.pid}m`;

function testConfigDir(name: string): string {
  return join(HOME, ".hasna", "connectors", `connect-${name}`);
}

function cleanupTestConnectors(...names: string[]) {
  for (const name of names) {
    const dir = testConfigDir(name);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
}

describe("server management routes", () => {
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    serverPort = 50000 + Math.floor(Math.random() * 10000);
    baseUrl = `http://localhost:${serverPort}`;
    await startServer(serverPort, { open: false });
  });

  describe("POST /api/connectors/:name/install", () => {
    afterEach(() => {
      // Clean up any installed connector from .connectors/
      const connectorsDir = join(process.cwd(), ".connectors");
      const installedDir = join(connectorsDir, "connect-anthropic");
      if (existsSync(installedDir)) {
        rmSync(installedDir, { recursive: true });
      }
      // Clean up the generated index file if it exists
      const indexFile = join(connectorsDir, "index.ts");
      if (existsSync(indexFile)) {
        rmSync(indexFile);
      }
      // Remove .connectors dir if empty
      if (existsSync(connectorsDir)) {
        try {
          const entries = readdirSync(connectorsDir);
          if (entries.length === 0) rmSync(connectorsDir, { recursive: true });
        } catch { /* ignore */ }
      }
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
      const connectorsDir = join(process.cwd(), ".connectors");
      const installedDir = join(connectorsDir, "connect-anthropic");
      if (existsSync(installedDir)) {
        rmSync(installedDir, { recursive: true });
      }
      const indexFile = join(connectorsDir, "index.ts");
      if (existsSync(indexFile)) {
        rmSync(indexFile);
      }
      if (existsSync(connectorsDir)) {
        try {
          const entries = readdirSync(connectorsDir);
          if (entries.length === 0) rmSync(connectorsDir, { recursive: true });
        } catch { /* ignore */ }
      }
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
      const connectorsDir = join(process.cwd(), ".connectors");
      const installedDir = join(connectorsDir, "connect-anthropic");
      if (existsSync(installedDir)) {
        rmSync(installedDir, { recursive: true });
      }
      const indexFile = join(connectorsDir, "index.ts");
      if (existsSync(indexFile)) {
        rmSync(indexFile);
      }
      if (existsSync(connectorsDir)) {
        try {
          const entries = readdirSync(connectorsDir);
          if (entries.length === 0) rmSync(connectorsDir, { recursive: true });
        } catch { /* ignore */ }
      }
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
