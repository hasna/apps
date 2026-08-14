import { describe, expect, test } from "bun:test";
import { TODOS_CAPABILITIES, createCapabilityManifest } from "./capabilities.js";

describe("capability manifest", () => {
  test("creates a stable package-level manifest", () => {
    const manifest = createCapabilityManifest({
      version: "1.2.3",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-01-02T03:04:05.000Z",
      package: {
        packageName: "@hasna/todos",
        repository: "hasna/todos",
        version: "1.2.3",
      },
    });
    expect(manifest.capabilities.length).toBeGreaterThanOrEqual(8);
    expect(manifest.capabilities).toEqual(TODOS_CAPABILITIES.map((capability) => ({
      ...capability,
      source: {
        ...capability.source,
        version: "1.2.3",
      },
    })));
  });

  test("describes CLI, SDK, MCP, and server capabilities with schemas", () => {
    const manifest = createCapabilityManifest({ version: "1.2.3" });
    const kinds = new Set(manifest.capabilities.map((capability) => capability.kind));

    expect(kinds).toEqual(new Set(["cli", "sdk", "mcp", "server"]));

    for (const capability of manifest.capabilities) {
      expect(capability.id).toMatch(/^[a-z]+(\.[a-z0-9-]+)+$/);
      expect(capability.name).toBeTruthy();
      expect(capability.description.length).toBeGreaterThan(20);
      expect(capability.docsPath).toMatch(/\.(md|MD)(#.+)?$/);
      expect(capability.tags.length).toBeGreaterThan(0);
      expect(["stable", "experimental"]).toContain(capability.stability);
      expect(capability.inputSchema).toMatchObject({ type: "object" });
      expect(capability.outputSchema).toHaveProperty("type");
      expect(capability.source).toMatchObject({
        packageName: "@hasna/todos",
        repository: "hasna/todos",
        version: "1.2.3",
      });
    }
  });

  test("keeps capability ids unique and SaaS-neutral", () => {
    const ids = TODOS_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);

    const serialized = JSON.stringify(TODOS_CAPABILITIES).toLowerCase();
    for (const forbidden of ["stripe", "billing", "tenant", "aws", "s3", "platform-todos", "saas"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});
