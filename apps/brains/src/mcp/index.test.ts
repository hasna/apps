import { describe, expect, test } from "bun:test";
import { createMcpServer, buildServer, getProvider, MCP_SERVER_INFO } from "./index.js";
import { TinkerProvider } from "../lib/providers/tinker.js";
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

  test("buildServer returns a server instance", () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });

  test("createMcpServer alias returns a server instance", () => {
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
      expect(result.data.limit).toBe(500);
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

  test("the legacy thinker-labs provider name is normalized to tinker across schemas and dispatch", async () => {
    const {
      McpFinetuneStartSchema,
      McpFinetuneStatusSchema,
      ProviderSchema,
    } = await import("../lib/schemas.js");

    // 0.0.35 and earlier used "thinker-labs"; the rename to "tinker" keeps the
    // legacy spelling working as a migration path (release-review P1).
    expect(ProviderSchema.parse("thinker-labs")).toBe("tinker");
    expect(ProviderSchema.safeParse("mystery-provider").success).toBe(false);

    const start = McpFinetuneStartSchema.parse({
      provider: "tinker",
      base_model: "test-base-model",
    });
    const status = McpFinetuneStatusSchema.parse({
      provider: "tinker",
      job_id: "test-job",
    });

    expect(getProvider(start.provider)).toBeInstanceOf(TinkerProvider);
    expect(getProvider(status.provider)).toBeInstanceOf(TinkerProvider);
    expect(getProvider("thinker-labs")).toBeInstanceOf(TinkerProvider);
    expect(() => getProvider("mystery-provider")).toThrow(/Unknown provider/);
  });
});

describe("getProvider legacy-name dispatch", () => {
  test("normalizes the pre-0.0.36 legacy provider name thinker-labs to the TinkerProvider", () => {
    // 0.0.35 and earlier dispatched provider value "thinker-labs". Existing
    // MCP callers passing the legacy name must not fail dispatch.
    const provider = getProvider("thinker-labs");
    expect(provider).toBeInstanceOf(TinkerProvider);
  });

  test("still rejects an unknown provider", () => {
    expect(() => getProvider("mystery-provider")).toThrow(/Unknown provider/);
  });
});
