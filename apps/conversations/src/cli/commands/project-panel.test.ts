import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createChannel } from "../../lib/channels.js";
import { closeDb } from "../../lib/db.js";
import { sendMessage } from "../../lib/messages.js";
import { createProject } from "../../lib/projects.js";
import { createDisposableStore, enterHermeticTestEnv, hermeticSpawnEnv } from "../../test/hermetic.js";

let testStore: ReturnType<typeof createDisposableStore>;
let restoreEnv: () => void;

function cleanupDb(): void {
  closeDb();
}

function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: hermeticSpawnEnv({ CONVERSATIONS_DB_PATH: testStore.dbPath }),
  });
}

beforeEach(() => {
  testStore = createDisposableStore("project-panel-cli");
  restoreEnv = enterHermeticTestEnv({ CONVERSATIONS_DB_PATH: testStore.dbPath });
  cleanupDb();
});

afterEach(() => {
  cleanupDb();
  restoreEnv();
  testStore.cleanup();
});

describe("conversations project-panel CLI", () => {
  test("prints contract JSON for a seeded project", () => {
    const project = createProject({ name: "Swiss Bank Account", created_by: "alice" });
    createChannel("iproj-swiss-bank-account", "alice", { project_id: project.id });
    sendMessage({
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
    expect(stderr).toBe("");
    const panel = JSON.parse(stdout);
    expect(panel.schema).toBe("hasna.project_panel.v1");
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("conversations");
    expect(panel.items).toHaveLength(1);
  });
});
