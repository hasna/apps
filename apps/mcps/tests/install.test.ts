import { describe, expect, it } from "bun:test";
import "./setup";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { installToAgents } from "../src/lib/install";
import type { McpServerEntry } from "../src/types";

function makeEntry(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: "local-server",
    name: "Local Server",
    description: null,
    command: "npx",
    args: ["-y", "@example/mcp-server"],
    env: {},
    transport: "stdio",
    url: null,
    source: "local",
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function runCodexInstall(home: string, env: Record<string, string>) {
  return Bun.spawnSync({
    cmd: [
      "bun",
      "--eval",
      `
        import { installToAgents } from "./src/lib/install.ts";
        const entry = {
          id: "local-server",
          name: "Local Server",
          description: null,
          command: "npx",
          args: ["-y", "@example/mcp-server"],
          env: ${JSON.stringify(env)},
          transport: "stdio",
          url: null,
          source: "local",
          enabled: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        process.stdout.write(JSON.stringify(installToAgents(
          entry,
          ["codex"],
          { localCommandConsent: { approved: true, source: "test" } },
        )));
      `,
    ],
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("install consent", () => {
  it("refuses to install local stdio commands into agents without approval", () => {
    const results = installToAgents(makeEntry(), ["claude"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      agent: "claude",
      success: false,
    });
    expect(results[0].error).toContain("local stdio command approval is required");
  });

  it("refuses to materialize credential refs into local agent configs", () => {
    const results = installToAgents(
      makeEntry({
        credentialRefs: { API_KEY: { source: "env", name: "UPSTREAM_API_KEY" } },
      }),
      ["codex"],
      { localCommandConsent: { approved: true, source: "test" } },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ agent: "codex", success: false });
    expect(results[0].error).toContain("credential references");
  });

  it("writes safe env values to Codex MCP config", () => {
    const home = mkdtempSync(join(tmpdir(), "mcps-codex-home-"));
    const result = runCodexInstall(home, { LOG_LEVEL: "debug", NODE_ENV: "test" });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual([
      { agent: "codex", success: true },
    ]);

    const config = readFileSync(join(home, ".codex", "config.toml"), "utf-8");
    expect(config).toContain("[mcp_servers.local-server]");
    expect(config).toContain('command = "npx"');
    expect(config).toContain('args = ["-y", "@example/mcp-server"]');
    expect(config).toContain("[mcp_servers.local-server.env]");
    expect(config).toContain('LOG_LEVEL = "debug"');
    expect(config).toContain('NODE_ENV = "test"');
  });

  it("adds safe env values when a Codex MCP config already exists", () => {
    const home = mkdtempSync(join(tmpdir(), "mcps-codex-home-"));
    const codexDir = join(home, ".codex");
    const configPath = join(codexDir, "config.toml");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      configPath,
      [
        "[mcp_servers.local-server]",
        'command = "npx"',
        'args = ["-y", "@example/mcp-server"]',
        "",
        "[mcp_servers.other]",
        'command = "node"',
        "args = []",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = runCodexInstall(home, { LOG_LEVEL: "debug" });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual([
      { agent: "codex", success: true },
    ]);

    const config = readFileSync(configPath, "utf-8");
    expect(config).toContain("[mcp_servers.local-server.env]");
    expect(config).toContain('LOG_LEVEL = "debug"');
    expect(config.indexOf("[mcp_servers.local-server.env]")).toBeLessThan(
      config.indexOf("[mcp_servers.other]"),
    );
  });

  it("preserves indented Codex tables when replacing existing env values", () => {
    const home = mkdtempSync(join(tmpdir(), "mcps-codex-home-"));
    const codexDir = join(home, ".codex");
    const configPath = join(codexDir, "config.toml");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      configPath,
      [
        "[mcp_servers.local-server]",
        'command = "npx"',
        'args = ["-y", "@example/mcp-server"]',
        "",
        "[mcp_servers.local-server.env]",
        'OLD = "stale"',
        "",
        "  [mcp_servers.other]",
        '  command = "node"',
        "  args = []",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = runCodexInstall(home, { LOG_LEVEL: "debug" });

    expect(result.exitCode).toBe(0);
    const config = readFileSync(configPath, "utf-8");
    expect(config).toContain("[mcp_servers.local-server.env]");
    expect(config).toContain('LOG_LEVEL = "debug"');
    expect(config).not.toContain("OLD");
    expect(config).toContain("  [mcp_servers.other]");
    expect(Bun.TOML.parse(config).mcp_servers.other.command).toBe("node");
  });
});
