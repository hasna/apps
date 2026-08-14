import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function runCli(args: string[], dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-credentials-"))) {
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

describe("credential reference CLI", () => {
  it("stores credential refs and keeps exports free of raw secrets", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-credentials-"));

    const add = runCli(["add", "--yes", "--name", "Credentialed", "npx", "-y", "@example/mcp-server"], dataDir);
    expect(add.exitCode).toBe(0);

    const ref = runCli(["env", "ref", "credentialed", "API_KEY=UPSTREAM_API_KEY", "--source", "env"], dataDir);
    expect(ref.exitCode).toBe(0);
    expect(ref.stdoutText).toContain("API_KEY=env:UPSTREAM_API_KEY");

    const rejected = runCli(["env", "set", "credentialed", "API_KEY=sk_live_should_not_be_stored"], dataDir);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderrText).toContain("credential reference");

    const list = runCli(["env", "list", "credentialed"], dataDir);
    expect(list.exitCode).toBe(0);
    expect(list.stdoutText).toContain("API_KEY=env:UPSTREAM_API_KEY");
    expect(list.stdoutText).not.toContain("sk_live_should_not_be_stored");

    const exported = runCli(["export", "--stdout"], dataDir);
    expect(exported.exitCode).toBe(0);
    const payload = JSON.parse(exported.stdoutText);
    expect(JSON.stringify(payload)).not.toContain("sk_live_should_not_be_stored");
    expect(payload.servers[0].credentialRefs.API_KEY).toMatchObject({
      source: "env",
      name: "UPSTREAM_API_KEY",
    });
  });
});
