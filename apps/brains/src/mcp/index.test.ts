import { describe, expect, test } from "bun:test";
import { createMcpServer, MCP_SERVER_INFO } from "./index.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../package.json"), "utf-8")
) as { version: string };

describe("MCP server", () => {
  test("server info version matches package.json", () => {
    expect(MCP_SERVER_INFO.version).toBe(packageJson.version);
    expect(MCP_SERVER_INFO.name).toBe("brains");
  });

  test("createMcpServer returns a server instance", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });
});

describe("MCP schema validation", () => {
  test("McpGatherSchema rejects empty sources", async () => {
    const { McpGatherSchema } = await import("../lib/schemas.js");
    const result = McpGatherSchema.safeParse({ sources: [] });
    expect(result.success).toBe(false);
  });

  test("McpGatherSchema accepts valid sources", async () => {
    const { McpGatherSchema } = await import("../lib/schemas.js");
    const result = McpGatherSchema.safeParse({ sources: ["todos", "mementos"] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources).toEqual(["todos", "mementos"]);
    }
  });

  test("McpFinetuneStartSchema rejects invalid provider", async () => {
    const { McpFinetuneStartSchema } = await import("../lib/schemas.js");
    const result = McpFinetuneStartSchema.safeParse({
      provider: "anthropic",
      base_model: "claude-3",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("openai");
    }
  });

  test("McpFinetuneStartSchema accepts optional dataset_path", async () => {
    const { McpFinetuneStartSchema } = await import("../lib/schemas.js");
    const result = McpFinetuneStartSchema.safeParse({
      provider: "openai",
      base_model: "gpt-4o-mini",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dataset_path).toBeUndefined();
    }
  });

  test("McpFinetuneStatusSchema requires job_id", async () => {
    const { McpFinetuneStatusSchema } = await import("../lib/schemas.js");
    const result = McpFinetuneStatusSchema.safeParse({ provider: "openai" });
    expect(result.success).toBe(false);
  });

  test("ProviderSchema rejects unknown provider", async () => {
    const { ProviderSchema } = await import("../lib/schemas.js");
    const result = ProviderSchema.safeParse("gemini");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("openai");
    }
  });
});
