import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_PROVIDER_PROFILE_SEEDS } from "../src/lib/provider-profile-seeds";

function idsSortedByDisplayName() {
  return [...DEFAULT_PROVIDER_PROFILE_SEEDS]
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((profile) => profile.id);
}

function runCli(args: string[], dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-provider-"))) {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HASNA_MCPS_DATA_DIR: dataDir,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    ...result,
    dataDir,
    stdoutText: new TextDecoder().decode(result.stdout),
    stderrText: new TextDecoder().decode(result.stderr),
  };
}

describe("provider profile CLI", () => {
  it("lists curated provider profiles as JSON", () => {
    const result = runCli(["providers", "list", "--json"]);
    expect(result.exitCode).toBe(0);
    const profiles = JSON.parse(result.stdoutText);
    expect(profiles.map((profile: { id: string }) => profile.id)).toEqual(idsSortedByDisplayName());
    expect(profiles.map((profile: { id: string }) => profile.id)).toContain("github");
    expect(profiles.map((profile: { id: string }) => profile.id)).toContain("google-calendar");
    expect(profiles.map((profile: { id: string }) => profile.id)).toContain("browser");
  });

  it("searches and inspects curated provider profiles as JSON", () => {
    const search = runCli(["providers", "search", "notion", "--json"]);
    expect(search.exitCode).toBe(0);
    const profiles = JSON.parse(search.stdoutText);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].endpoint).toBe("https://mcp.notion.com/mcp");

    const info = runCli(["providers", "info", "linear", "--json"]);
    expect(info.exitCode).toBe(0);
    const linear = JSON.parse(info.stdoutText);
    expect(linear.authMetadata.bearerToken).toBe("optional");
  });

  it("installs a curated profile as a registered MCP server", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-provider-"));
    const install = runCli(["providers", "install", "notion", "--json"], dataDir);
    expect(install.exitCode).toBe(0);
    const server = JSON.parse(install.stdoutText);
    expect(server).toMatchObject({
      id: "notion",
      transport: "streamable-http",
      url: "https://mcp.notion.com/mcp",
      source: "provider-profile",
    });

    const list = runCli(["list", "--json"], dataDir);
    expect(list.exitCode).toBe(0);
    const servers = JSON.parse(list.stdoutText);
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe("notion");
  });
});
