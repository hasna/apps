import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createChannel } from "./channels.js";
import { closeDb } from "./db.js";
import { sendMessage } from "./messages.js";
import { createConversationsProjectPanel } from "./project-panel.js";
import { createProject } from "./projects.js";

const TEST_DB = join(tmpdir(), `conversations-test-project-panel-${Date.now()}.db`);

function cleanupDb(): void {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(`${TEST_DB}-wal`); } catch {}
  try { unlinkSync(`${TEST_DB}-shm`); } catch {}
}

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  cleanupDb();
});

afterEach(() => {
  cleanupDb();
  delete process.env.CONVERSATIONS_DB_PATH;
});

describe("createConversationsProjectPanel", () => {
  test("emits a contract-valid project conversation panel without full message bodies", async () => {
    const project = createProject({ name: "Swiss Bank Account", created_by: "alice" });
    createChannel("iproj-swiss-bank-account", "alice", {
      project_id: project.id,
      description: "Swiss banking coordination",
      tags: ["project", "iproj"],
    });
    sendMessage({
      from: "alice",
      to: "iproj-swiss-bank-account",
      channel: "iproj-swiss-bank-account",
      project_id: project.id,
      content: "Initial document checklist and bank shortlist.",
      priority: "normal",
    });
    sendMessage({
      from: "bob",
      to: "iproj-swiss-bank-account",
      channel: "iproj-swiss-bank-account",
      project_id: project.id,
      content: `Blocking review needed. ${"sensitive body ".repeat(40)} SECRET_TAIL_DO_NOT_INCLUDE`,
      priority: "urgent",
      blocking: true,
    });

    const panel = await createConversationsProjectPanel("Swiss Bank Account", { limit: 1 });

    expect(panel.schema).toBe("hasna.project_panel.v1");
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("conversations");
    expect(panel.kind).toBe("conversations");
    expect(panel.state).toBe("ready");
    expect(panel.items).toHaveLength(1);
    expect(panel.items[0].priority).toBe("critical");
    expect(panel.items[0].summary?.length).toBeLessThanOrEqual(180);
    expect(panel.items[0].summary).not.toContain("SECRET_TAIL_DO_NOT_INCLUDE");
    expect(panel.metrics.find((metric) => metric.id === "blocking_messages")?.value).toBe(1);
    expect(panel.resourceRefs.some((ref) => ref.uri === "conversation://channel/iproj-swiss-bank-account")).toBe(true);
  });

  test("falls back to #iproj-prefixed channels when no conversations project row exists", async () => {
    createChannel("#iproj-swiss-bank-account", "alice");
    sendMessage({
      from: "alice",
      to: "iproj-swiss-bank-account",
      channel: "iproj-swiss-bank-account",
      content: "Project channel exists before project registry mapping.",
    });

    const panel = await createConversationsProjectPanel("Swiss Bank Account");

    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.state).toBe("ready");
    expect(panel.warnings).toHaveLength(1);
    expect(panel.metrics.find((metric) => metric.id === "channels")?.value).toBe(1);
    expect(panel.items[0].resourceRefs.some((ref) => ref.uri === "conversation://channel/iproj-swiss-bank-account")).toBe(true);
  });

  test("includes channel-scoped messages when a project row exists but messages have no project_id", async () => {
    const project = createProject({ name: "Swiss Bank Account", created_by: "alice" });
    createChannel("iproj-swiss-bank-account", "alice", { project_id: project.id });
    sendMessage({
      from: "alice",
      to: "iproj-swiss-bank-account",
      channel: "iproj-swiss-bank-account",
      content: "Channel-only project update.",
    });

    const panel = await createConversationsProjectPanel(project.id);

    expect(panel.state).toBe("ready");
    expect(panel.metrics.find((metric) => metric.id === "messages")?.value).toBe(1);
    expect(panel.items[0].summary).toContain("Channel-only project update");
  });
});
