import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getConnectorPath,
  connectorExists,
  installConnector,
  installConnectors,
  getInstalledConnectors,
  removeConnector,
  getConnectorDocs,
} from "./installer.js";

// Use a temp directory for all install/remove tests
const TEST_DIR = join(import.meta.dir, "..", "..", ".test-install-tmp");

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

beforeEach(() => {
  cleanup();
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  cleanup();
});

describe("installer", () => {
  describe("getConnectorPath", () => {
    test("returns path for name without prefix", () => {
      const path = getConnectorPath("figma");
      expect(path).toContain("connect-figma");
      expect(path).toContain("connectors");
    });

    test("returns path for name with prefix", () => {
      const path = getConnectorPath("connect-figma");
      expect(path).toContain("connect-figma");
      // Should NOT have double "connect-connect-"
      expect(path).not.toContain("connect-connect-");
    });

    test("handles empty string", () => {
      const path = getConnectorPath("");
      expect(path).toContain("connect-");
    });
  });

  describe("connectorExists", () => {
    test("returns true for existing connector", () => {
      expect(connectorExists("anthropic")).toBe(true);
    });

    test("returns true with prefix", () => {
      expect(connectorExists("connect-anthropic")).toBe(true);
    });

    test("returns false for non-existent connector", () => {
      expect(connectorExists("nonexistent-xyz-abc")).toBe(false);
    });
  });

  describe("installConnector", () => {
    test("installs a connector successfully", () => {
      const result = installConnector("anthropic", { targetDir: TEST_DIR });
      expect(result.success).toBe(true);
      expect(result.connector).toBe("anthropic");
      expect(result.path).toContain("connect-anthropic");

      // Verify files were copied
      const destPath = join(TEST_DIR, ".connectors", "connect-anthropic");
      expect(existsSync(destPath)).toBe(true);
      expect(existsSync(join(destPath, "package.json"))).toBe(true);
    });

    test("creates .connectors directory if it does not exist", () => {
      const connectorsDir = join(TEST_DIR, ".connectors");
      expect(existsSync(connectorsDir)).toBe(false);

      installConnector("anthropic", { targetDir: TEST_DIR });
      expect(existsSync(connectorsDir)).toBe(true);
    });

    test("generates index.ts with exports", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      const indexPath = join(TEST_DIR, ".connectors", "index.ts");
      expect(existsSync(indexPath)).toBe(true);

      const content = readFileSync(indexPath, "utf-8");
      expect(content).toContain("export * as anthropic");
      expect(content).toContain("connect-anthropic");
    });

    test("returns error for non-existent connector", () => {
      const result = installConnector("nonexistent-xyz", { targetDir: TEST_DIR });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("returns error when already installed without overwrite", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      const result = installConnector("anthropic", { targetDir: TEST_DIR });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Already installed");
      expect(result.path).toBeDefined();
    });

    test("succeeds when already installed with overwrite", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      const result = installConnector("anthropic", {
        targetDir: TEST_DIR,
        overwrite: true,
      });
      expect(result.success).toBe(true);
    });

    test("handles connector name with prefix", () => {
      const result = installConnector("connect-figma", { targetDir: TEST_DIR });
      expect(result.success).toBe(true);
      expect(result.path).toContain("connect-figma");
    });

    test("installs multiple connectors and updates index", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      installConnector("figma", { targetDir: TEST_DIR });

      const indexPath = join(TEST_DIR, ".connectors", "index.ts");
      const content = readFileSync(indexPath, "utf-8");
      expect(content).toContain("export * as anthropic");
      expect(content).toContain("export * as figma");
    });
  });

  describe("installConnectors", () => {
    test("installs multiple connectors", () => {
      const results = installConnectors(["anthropic", "figma"], {
        targetDir: TEST_DIR,
      });
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    test("returns empty array for empty input", () => {
      const results = installConnectors([], { targetDir: TEST_DIR });
      expect(results).toEqual([]);
    });

    test("handles mix of success and failure", () => {
      const results = installConnectors(["anthropic", "nonexistent-xyz"], {
        targetDir: TEST_DIR,
      });
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe("getInstalledConnectors", () => {
    test("returns empty array when .connectors does not exist", () => {
      const result = getInstalledConnectors(TEST_DIR);
      expect(result).toEqual([]);
    });

    test("returns empty array when .connectors is empty", () => {
      mkdirSync(join(TEST_DIR, ".connectors"), { recursive: true });
      const result = getInstalledConnectors(TEST_DIR);
      expect(result).toEqual([]);
    });

    test("returns installed connector names without prefix", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      installConnector("figma", { targetDir: TEST_DIR });
      const result = getInstalledConnectors(TEST_DIR);
      expect(result).toContain("anthropic");
      expect(result).toContain("figma");
      expect(result).toHaveLength(2);
    });

    test("ignores non-connector files", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      // Create a non-connector file
      writeFileSync(join(TEST_DIR, ".connectors", "something.txt"), "test");
      const result = getInstalledConnectors(TEST_DIR);
      expect(result).toEqual(["anthropic"]);
    });
  });

  describe("removeConnector", () => {
    test("removes an installed connector", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      const removed = removeConnector("anthropic", TEST_DIR);
      expect(removed).toBe(true);

      const destPath = join(TEST_DIR, ".connectors", "connect-anthropic");
      expect(existsSync(destPath)).toBe(false);
    });

    test("returns false for non-installed connector", () => {
      const removed = removeConnector("nonexistent-xyz", TEST_DIR);
      expect(removed).toBe(false);
    });

    test("updates index.ts after removal", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      installConnector("figma", { targetDir: TEST_DIR });
      removeConnector("anthropic", TEST_DIR);

      const indexPath = join(TEST_DIR, ".connectors", "index.ts");
      const content = readFileSync(indexPath, "utf-8");
      expect(content).not.toContain("anthropic");
      expect(content).toContain("figma");
    });

    test("handles name with prefix", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      const removed = removeConnector("connect-anthropic", TEST_DIR);
      expect(removed).toBe(true);
    });
  });

  describe("getConnectorDocs", () => {
    test("returns docs for existing connector", () => {
      const docs = getConnectorDocs("stripe");
      expect(docs).not.toBeNull();
      expect(docs!.overview).toContain("Stripe");
      expect(docs!.raw).toContain("# CLAUDE.md");
    });

    test("returns null for non-existent connector", () => {
      const docs = getConnectorDocs("nonexistent-xyz");
      expect(docs).toBeNull();
    });

    test("parses auth section", () => {
      const docs = getConnectorDocs("stripe");
      expect(docs!.auth).toContain("Bearer Token");
    });

    test("parses env vars table", () => {
      const docs = getConnectorDocs("stripe");
      expect(docs!.envVars.length).toBeGreaterThan(0);
      expect(docs!.envVars[0]).toHaveProperty("variable");
      expect(docs!.envVars[0]).toHaveProperty("description");

      const apiKey = docs!.envVars.find((v) => v.variable === "STRIPE_API_KEY");
      expect(apiKey).toBeDefined();
    });

    test("parses CLI commands section", () => {
      const docs = getConnectorDocs("stripe");
      expect(docs!.cliCommands).toContain("connect-stripe");
    });

    test("parses data storage section", () => {
      const docs = getConnectorDocs("stripe");
      expect(docs!.dataStorage).toContain(".connect/connect-stripe");
    });

    test("handles connector with no CLI commands section", () => {
      const docs = getConnectorDocs("gmail");
      // gmail CLAUDE.md doesn't have a CLI Commands section
      // cliCommands should be empty string
      expect(docs).not.toBeNull();
      expect(docs!.envVars.length).toBeGreaterThan(0);
    });

    test("handles name with prefix", () => {
      const docs = getConnectorDocs("connect-stripe");
      expect(docs).not.toBeNull();
      expect(docs!.overview).toContain("Stripe");
    });

    test("raw field contains full CLAUDE.md content", () => {
      const docs = getConnectorDocs("stripe");
      expect(docs!.raw).toContain("# CLAUDE.md");
      expect(docs!.raw).toContain("## Project Overview");
      expect(docs!.raw).toContain("## Environment Variables");
    });

    test("parses env vars correctly for multiple connectors", () => {
      // Test anthropic
      const anthropicDocs = getConnectorDocs("anthropic");
      expect(anthropicDocs).not.toBeNull();
      const anthropicKey = anthropicDocs!.envVars.find(
        (v) => v.variable === "ANTHROPIC_API_KEY"
      );
      expect(anthropicKey).toBeDefined();

      // Test github
      const githubDocs = getConnectorDocs("github");
      expect(githubDocs).not.toBeNull();
      const githubToken = githubDocs!.envVars.find(
        (v) => v.variable === "GITHUB_TOKEN"
      );
      expect(githubToken).toBeDefined();
    });

    test("returns empty cliCommands for connectors without that section", () => {
      // Gmail CLAUDE.md doesn't have a "CLI Commands" section
      const docs = getConnectorDocs("gmail");
      expect(docs!.cliCommands).toBe("");
    });

    test("returns overview as first paragraph only concept", () => {
      const docs = getConnectorDocs("figma");
      expect(docs!.overview.length).toBeGreaterThan(10);
      expect(docs!.overview).toContain("Figma");
    });
  });

  describe("installConnector edge cases", () => {
    test("creates proper .connectors directory structure", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      // Verify it's .connectors/connect-anthropic (not .connect)
      expect(existsSync(join(TEST_DIR, ".connectors"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".connectors", "connect-anthropic"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".connectors", "connect-anthropic", "src"))).toBe(true);
      // Verify it's NOT .connect
      expect(existsSync(join(TEST_DIR, ".connect"))).toBe(false);
    });

    test("connector has all expected files after install", () => {
      installConnector("stripe", { targetDir: TEST_DIR });
      const base = join(TEST_DIR, ".connectors", "connect-stripe");
      expect(existsSync(join(base, "package.json"))).toBe(true);
      expect(existsSync(join(base, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(base, "README.md"))).toBe(true);
      expect(existsSync(join(base, "src", "index.ts"))).toBe(true);
    });

    test("index.ts is valid TypeScript export syntax", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      installConnector("stripe", { targetDir: TEST_DIR });
      const indexPath = join(TEST_DIR, ".connectors", "index.ts");
      const content = readFileSync(indexPath, "utf-8");
      // Check proper export syntax
      expect(content).toMatch(/export \* as \w+ from '\.\/connect-\w+\/src\/index\.js'/);
      expect(content).toContain("Auto-generated");
    });
  });

  describe("getInstalledConnectors edge cases", () => {
    test("ignores index.ts in .connectors dir", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      const result = getInstalledConnectors(TEST_DIR);
      // Should not include index.ts, only connector dirs
      expect(result).toEqual(["anthropic"]);
      expect(result).not.toContain("index.ts");
    });

    test("returns multiple connectors in consistent order", () => {
      installConnector("stripe", { targetDir: TEST_DIR });
      installConnector("anthropic", { targetDir: TEST_DIR });
      installConnector("figma", { targetDir: TEST_DIR });
      const result = getInstalledConnectors(TEST_DIR);
      expect(result).toHaveLength(3);
      expect(result).toContain("stripe");
      expect(result).toContain("anthropic");
      expect(result).toContain("figma");
    });
  });

  describe("removeConnector edge cases", () => {
    test("index.ts is empty after removing all connectors", () => {
      installConnector("anthropic", { targetDir: TEST_DIR });
      removeConnector("anthropic", TEST_DIR);

      const indexPath = join(TEST_DIR, ".connectors", "index.ts");
      const content = readFileSync(indexPath, "utf-8");
      expect(content).toContain("Auto-generated");
      expect(content).not.toContain("export * as");
    });
  });
});
