import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function runCli(args: string[], dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-import-"))) {
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

describe("import CLI", () => {
  it("rejects imported servers with invalid transport or URL values", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-import-"));
    const exportPath = join(dataDir, "bad-export.json");
    writeFileSync(
      exportPath,
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: "bad-import",
            name: "bad-import",
            description: null,
            command: "npx",
            args: [],
            env: {},
            credentialRefs: {},
            transport: "websocket",
            url: "file:///tmp/socket",
            source: "local",
            enabled: true,
            created_at: "2026-01-01 00:00:00",
            updated_at: "2026-01-01 00:00:00",
          },
        ],
        sources: [],
      }),
    );

    const result = runCli(["import", exportPath], dataDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderrText).toContain("Invalid server in import");
    expect(result.stderrText).toContain("Invalid transport type");
  });

  it("rejects imported servers with non-string transport values", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-import-"));
    const exportPath = join(dataDir, "numeric-transport-export.json");
    writeFileSync(
      exportPath,
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: "numeric-transport",
            name: "numeric-transport",
            description: null,
            command: "npx",
            args: [],
            env: {},
            credentialRefs: {},
            transport: 42,
            url: "https://example.test/mcp",
            source: "local",
            enabled: true,
            created_at: "2026-01-01 00:00:00",
            updated_at: "2026-01-01 00:00:00",
          },
        ],
        sources: [],
      }),
    );

    const result = runCli(["import", exportPath], dataDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderrText).toContain("Invalid server in import");
    expect(result.stderrText).toContain("Invalid transport type");
  });
});
