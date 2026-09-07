import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createChannel } from "../../lib/channels.js";
import { closeDb } from "../../lib/db.js";
import { sendMessage } from "../../lib/messages.js";
import { createProject } from "../../lib/projects.js";

const TEST_DB = join(tmpdir(), `conversations-test-project-panel-cli-${Date.now()}.db`);

function cleanupDb(): void {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(`${TEST_DB}-wal`); } catch {}
  try { unlinkSync(`${TEST_DB}-shm`); } catch {}
}

function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CONVERSATIONS_DB_PATH: TEST_DB },
  });
}

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  cleanupDb();
});

afterEach(() => {
  cleanupDb();
  delete process.env.CONVERSATIONS_DB_PATH;
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
    // Local mode announces itself once on stderr (hasna/apps#1720).
    expect(stderr).toContain("LOCAL mode");
    const panel = JSON.parse(stdout);
    expect(panel.schema).toBe("hasna.project_panel.v1");
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("conversations");
    expect(panel.items).toHaveLength(1);
  });
});
