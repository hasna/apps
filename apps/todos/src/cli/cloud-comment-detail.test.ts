import { describe, expect, test } from "bun:test";
import { createHostedCliHarness, type HostedCliHarness, type HostedCliResult } from "./hosted-cli.test-helper";
import { runInjectedHostedCommand } from "./hosted-command.test-helper.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";

function expectStageADenial(result: HostedCliResult, harness: HostedCliHarness): void {
  expect(result.timedOut).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
  expect(harness.requests).toEqual([]);
  expect(harness.sqliteExists()).toBe(false);
}

describe("cloud task detail comments", () => {
  test.each([
    ["exact", PARENT_ID],
    ["short", PARENT_ID.slice(0, 8)],
  ])("Commander maps an %s parent reference to the canonical cloud parent id", async (label, parentRef) => {
    const result = await runInjectedHostedCommand("task-parent", [
      "--json", "add", "Cloud child", "--parent", parentRef,
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: TASK_ID,
      parent_id: PARENT_ID,
      title: "Cloud child",
    });
    const postCall = {
      method: "POST",
      path: "/v1/tasks",
      query: "",
      body: expect.objectContaining({ title: "Cloud child", parent_id: PARENT_ID }),
    };
    if (label === "short") {
      expect(result.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
        "GET /v1/stats",
        "GET /v1/tasks",
        `GET /v1/tasks/${PARENT_ID}`,
        "GET /v1/stats",
        "POST /v1/tasks",
      ]);
      expect(result.calls[1]?.query).toContain("include_subtasks=true");
      expect(result.calls.at(-1)).toEqual(postCall);
    } else {
      expect(result.calls).toEqual([postCall]);
    }
  });

  test("Stage A denies add, direct-ID start, and comment before network or SQLite", async () => {
    const harness = createHostedCliHarness("todos-cloud-comment-flow-");
    try {
      for (const command of [
        ["add", "Cloud short id regression"],
        ["start", TASK_ID.slice(0, 8)],
        ["comment", TASK_ID.slice(0, 8), "started from printed prefix"],
      ] as const) {
        expectStageADenial(await harness.run(command), harness);
      }
    } finally {
      harness.dispose();
    }
  });

  test("Stage A denies parent-scoped task creation before network or SQLite", async () => {
    const harness = createHostedCliHarness("todos-cloud-parent-create-");
    try {
      expectStageADenial(
        await harness.run(["--json", "add", "Cloud child", "--parent", PARENT_ID]),
        harness,
      );
    } finally {
      harness.dispose();
    }
  });

  test("Stage A denies comment, show, and inspect variants before detail or comment requests", async () => {
    const harness = createHostedCliHarness("todos-cloud-comment-detail-");
    try {
      for (const command of [
        ["comment", TASK_ID, "first persisted comment"],
        ["--json", "show", TASK_ID],
        ["--json", "inspect", TASK_ID],
        ["show", TASK_ID],
        ["inspect", TASK_ID],
      ] as const) {
        expectStageADenial(await harness.run(command), harness);
      }
    } finally {
      harness.dispose();
    }
  });

  test("Stage A makes foreign and nonexistent direct IDs indistinguishable before comments lookup", async () => {
    const harness = createHostedCliHarness("todos-cloud-missing-task-");
    try {
      const foreign = await harness.run(["--json", "show", TASK_ID]);
      const nonexistent = await harness.run(["--json", "show", "ffffffff-ffff-4fff-8fff-ffffffffffff"]);
      expectStageADenial(foreign, harness);
      expectStageADenial(nonexistent, harness);
      expect(`${foreign.stdout}\n${foreign.stderr}`).toBe(`${nonexistent.stdout}\n${nonexistent.stderr}`);
    } finally {
      harness.dispose();
    }
  });
});
