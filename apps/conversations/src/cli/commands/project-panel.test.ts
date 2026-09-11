import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getStore } from "../../lib/store/index.js";
import { startLoopbackApiFixture } from "../../lib/store/test-support/loopback-api-fixture.js";
import { activateClientEnvironment } from "../../lib/store/test-support/client-environment.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
let restoreClient: () => void;
function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: [process.execPath, "--no-env-file", "run", "src/cli/index.tsx", ...args],
    stdout: "pipe", stderr: "pipe", env: fixture.env,
  });
}
beforeEach(async () => {
  fixture = await startLoopbackApiFixture();
  restoreClient = activateClientEnvironment(fixture.env);
});
afterEach(async () => {
  restoreClient();
  await fixture.stop();
});

describe("conversations project-panel CLI", () => {
  test("prints contract JSON for a seeded project", async () => {
    const project = await getStore().createProject({ name: "Swiss Bank Account", created_by: "alice" });
    await getStore().createChannel("iproj-swiss-bank-account", "alice", { project_id: project.id });
    await getStore().sendMessage({
      from: "alice",
      to: "iproj-swiss-bank-account",
      channel: "iproj-swiss-bank-account",
      project_id: project.id,
      content: "Coordination update.",
    });

    const result = runCli(["project-panel", "--project", "Swiss Bank Account", "--json", "--contract"]);
    const stdout = Buffer.from(result.stdout).toString("utf-8");
    const stderr = Buffer.from(result.stderr).toString("utf-8");

    expect(result.exitCode).toBe(0);
    expect(stderr).not.toContain("local store");
    const panel = JSON.parse(stdout);
    expect(panel.schema).toBe("hasna.project_panel.v1");
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("conversations");
    expect(panel.items).toHaveLength(1);
  });
});
