import { describe, expect, test } from "bun:test";
import { createHostedCliHarness, type HostedCliHarness, type HostedCliResult } from "./hosted-cli.test-helper";
import { runInjectedHostedCommand } from "./hosted-command.test-helper.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const PROJECT_SLUG = "open-emails";
const PROJECT_PATH = "/workspace/hasna/opensource/open-emails";
const LIST_ID = "12345678-1111-4111-8111-111111111111";

function expectStageADenial(result: HostedCliResult, harness: HostedCliHarness): void {
  expect(result.timedOut).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
  expect(harness.requests).toEqual([]);
  expect(harness.sqliteExists()).toBe(false);
}

async function expectCommandDenied(args: readonly string[], prefix = "todos-cloud-list-filter-"): Promise<void> {
  const harness = createHostedCliHarness(prefix);
  try {
    expectStageADenial(await harness.run(args), harness);
  } finally {
    harness.dispose();
  }
}

describe("cloud CLI task-list filtering", () => {
  test("Commander parses project/list/status/priority/assignment/limit filters and renders JSON", async () => {
    const result = await runInjectedHostedCommand("list-filter", [
      "--project", "open-emails",
      "--json",
      "list",
      "--list", "release",
      "--status", "pending",
      "--priority", "high",
      "--assigned", "friday",
      "--limit", "5",
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual([
      expect.objectContaining({
        id: TASK_ID,
        project_id: PROJECT_ID,
        task_list_id: LIST_ID,
        assigned_to: "friday",
      }),
    ]);
    expect(result.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/projects",
      "GET /v1/task-lists",
      "GET /v1/tasks",
    ]);
    const taskQuery = new URLSearchParams(result.calls[2]!.query);
    expect(Object.fromEntries(taskQuery)).toEqual({
      status: "pending",
      priority: "high",
      project_id: PROJECT_ID,
      task_list_id: LIST_ID,
      assigned_to: "friday",
      limit: "5",
    });
  });

  test("Commander project-rename performs one atomic mutation and renders the response", async () => {
    const result = await runInjectedHostedCommand("rename-success", [
      "--json", "project-rename", "open-emails", "emails-next", "--name", "Emails Next",
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      project: { id: PROJECT_ID, name: "Emails Next", task_list_id: "emails-next" },
      task_lists_updated: 1,
    });
    expect(result.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/projects",
      `POST /v1/projects/${PROJECT_ID}/rename`,
    ]);
    expect(result.calls[1]!.body).toEqual({ new_slug: "emails-next", name: "Emails Next" });
  });

  test("Commander project-rename response failure performs no client rollback", async () => {
    const result = await runInjectedHostedCommand("rename-failure", [
      "--json", "project-rename", "open-emails", "emails-next",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`POST /projects/${PROJECT_ID}/rename -> 503`);
    expect(result.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/projects",
      `POST /v1/projects/${PROJECT_ID}/rename`,
    ]);
  });

  test.each([PROJECT_SLUG, "Open Emails", PROJECT_PATH])(
    "Stage A denies project ref %s before every lists operation",
    async (projectRef) => {
      for (const operationArgs of [
        [],
        ["--add", "Release", "--slug", "release"],
        ["--delete", "release"],
      ] as const) {
        await expectCommandDenied(["--project", projectRef, "--json", "lists", ...operationArgs]);
      }
    },
  );

  test.each([
    ["global project option", ["--project", PROJECT_SLUG, "--json", "add", "Cloud task", "--list", "release"]],
    ["add project option", ["--json", "add", "Cloud task", "--project", PROJECT_SLUG, "--list", "release"]],
  ] as const)("Stage A denies project-scoped add via %s before resolution", async (_label, args) => {
    await expectCommandDenied(args);
  });

  test("Stage A denies project-rename before the atomic server mutation", async () => {
    await expectCommandDenied(["--json", "project-rename", PROJECT_SLUG, "emails-next", "--name", "Emails Next"]);
  });

  test("Stage A denial precedes any remote project-rename conflict", async () => {
    await expectCommandDenied(["--json", "project-rename", PROJECT_SLUG, "emails-next"]);
  });

  test("Stage A denial requires no client-side rollback after response loss", async () => {
    await expectCommandDenied(["--json", "project-rename", PROJECT_SLUG, "emails-next"]);
  });

  test.each([
    ["project-scoped slug", "release", PROJECT_SLUG],
    ["exact UUID", LIST_ID, undefined],
    ["unique UUID prefix", "12345678", undefined],
  ] as const)("Stage A denies %s before sending the task-list filter", async (_label, ref, projectRef) => {
    await expectCommandDenied([
      ...(projectRef ? ["--project", projectRef] : []),
      "--json",
      "list",
      "--list",
      ref,
    ]);
  });

  test.each([
    ["exact UUID", PROJECT_ID],
    ["unique UUID prefix", "99999999"],
    ["canonical slug", PROJECT_SLUG],
    ["project task-list slug", "emails-canonical"],
    ["exact name", "Open Emails"],
    ["registered path", PROJECT_PATH],
    ["station-local repository path", "/home/hasna/workspace/hasna/opensource/open-emails"],
  ] as const)("Stage A denies cloud project %s before task-list scope resolution", async (_label, projectRef) => {
    await expectCommandDenied(["--project", projectRef, "--json", "list", "--list", "release"]);
  });

  test("Stage A denies --project-name before listing tasks", async () => {
    await expectCommandDenied(["--json", "list", "--all", "--project-name", PROJECT_SLUG]);
  });

  test("Stage A denies --project-name plus task-list slug before either lookup", async () => {
    await expectCommandDenied(["--json", "list", "--all", "--project-name", PROJECT_SLUG, "--list", "release"]);
  });

  test("Stage A denial precedes missing --project-name resolution", async () => {
    await expectCommandDenied(["--json", "list", "--project-name", "missing"]);
  });

  test.each(["missing", "shared", "aaaaaaaa"])(
    "Stage A denies task-list ref %s before missing or ambiguity lookup",
    async (ref) => {
      await expectCommandDenied(["--project", PROJECT_ID, "--json", "list", "--list", ref]);
    },
  );

  test.each(["missing", "Shared", "aaaaaaaa"])(
    "Stage A denies project ref %s before task-list resolution",
    async (projectRef) => {
      await expectCommandDenied(["--project", projectRef, "--json", "list", "--list", "release"]);
    },
  );
});
