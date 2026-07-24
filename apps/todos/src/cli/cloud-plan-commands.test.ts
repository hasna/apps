import { describe, expect, test } from "bun:test";
import { createHostedCliHarness, type HostedCliHarness, type HostedCliResult } from "./hosted-cli.test-helper";
import { runInjectedHostedCommand } from "./hosted-command.test-helper.js";

const PLAN_ID = "77777777-7777-4777-8777-777777777777";

function expectStageADenial(result: HostedCliResult, harness: HostedCliHarness): void {
  expect(result.timedOut).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
  expect(harness.requests).toEqual([]);
  expect(harness.sqliteExists()).toBe(false);
}

describe("cloud CLI plan commands", () => {
  test("Commander preserves plan create, list, read, complete, and delete lifecycle paths", async () => {
    const created = await runInjectedHostedCommand("plans", [
      "--json", "plans", "--add", "Stage A control", "--slug", "stage-a-control", "--description", "Injected Commander fixture",
    ]);
    expect(created).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(created.stdout)).toMatchObject({ id: PLAN_ID, slug: "stage-a-control", status: "active" });
    expect(created.calls).toEqual([expect.objectContaining({
      method: "POST",
      path: "/v1/plans",
      body: {
        name: "Stage A control",
        slug: "stage-a-control",
        description: "Injected Commander fixture",
      },
    })]);

    const listed = await runInjectedHostedCommand("plans", ["--json", "plans"]);
    expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(listed.stdout)).toEqual([expect.objectContaining({ id: PLAN_ID })]);
    expect(listed.calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["GET /v1/plans"]);

    const shown = await runInjectedHostedCommand("plans", ["--json", "plans", "--show", PLAN_ID]);
    expect(shown).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(shown.stdout)).toMatchObject({ plan: { id: PLAN_ID }, tasks: [], artifact: null });
    expect(shown.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET /v1/plans/${PLAN_ID}`,
      "GET /v1/tasks",
    ]);

    const completed = await runInjectedHostedCommand("plans", ["--json", "plans", "--complete", PLAN_ID]);
    expect(completed).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(completed.stdout)).toMatchObject({ id: PLAN_ID, status: "completed" });
    expect(completed.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET /v1/plans/${PLAN_ID}`,
      `PATCH /v1/plans/${PLAN_ID}`,
    ]);

    const deleted = await runInjectedHostedCommand("plans", ["--json", "plans", "--delete", PLAN_ID]);
    expect(deleted).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(deleted.stdout)).toEqual({ deleted: true });
    expect(deleted.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET /v1/plans/${PLAN_ID}`,
      `DELETE /v1/plans/${PLAN_ID}`,
    ]);
  }, 20_000);

  test("Commander preserves a DELETE 404 as a normal not-found result", async () => {
    const result = await runInjectedHostedCommand("plans-old-delete", [
      "--json", "plans", "--delete", PLAN_ID,
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ deleted: false });
    expect(result.stderr).toBe("");
    expect(result.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET /v1/plans/${PLAN_ID}`,
      `DELETE /v1/plans/${PLAN_ID}`,
    ]);
  });

  test("Stage A denies plan create, read, list, complete, and delete before network or SQLite", async () => {
    const harness = createHostedCliHarness("todos-cloud-plans-");
    try {
      const commands = [
        ["--json", "plans", "--add", "Codila CLI control", "--slug", "codila-cli-control", "--description", "Private CLI release plan"],
        ["--json", "plans", "--show", PLAN_ID],
        ["--json", "plans"],
        ["--json", "plans", "--complete", PLAN_ID],
        ["--json", "plans", "--delete", PLAN_ID],
      ] as const;
      for (const command of commands) {
        expectStageADenial(await harness.run(command), harness);
      }
    } finally {
      harness.dispose();
    }
  });

  test.each([
    ["--complete", "Duplicate plan"],
    ["--complete", "duplicate-slug"],
    ["--complete", "12345678"],
    ["--delete", "Duplicate plan"],
    ["--delete", "duplicate-slug"],
    ["--delete", "12345678"],
  ])("Stage A denies %s ref %s before remote ambiguity lookup", async (operation, ref) => {
    const harness = createHostedCliHarness("todos-cloud-plans-ref-");
    try {
      expectStageADenial(await harness.run(["--json", "plans", operation, ref]), harness);
    } finally {
      harness.dispose();
    }
  });

  test("Stage A denial is independent of an older server's missing plan delete route", async () => {
    const harness = createHostedCliHarness("todos-cloud-plans-old-server-");
    try {
      expectStageADenial(await harness.run(["--json", "plans", "--delete", PLAN_ID]), harness);
    } finally {
      harness.dispose();
    }
  });
});
