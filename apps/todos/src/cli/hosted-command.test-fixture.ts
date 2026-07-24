/**
 * Subprocess-only Commander fixture for positive hosted command regressions.
 * It never imports the shipped bootstrap, never resolves real credentials, and
 * installs an in-memory fetch router before an explicitly injected client is
 * handed to command registration. Production runtime registration omits the
 * seam and remains behind the Stage-A pre-load gate.
 */
import { Command } from "commander";
import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import { registerTaskCommands } from "./commands/task-commands.js";
import { registerPlanTemplateCommands } from "./commands/plan-template-commands.js";
import { registerProjectCommands } from "./commands/project-commands.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const LIST_ID = "12345678-1111-4111-8111-111111111111";
const PLAN_ID = "77777777-7777-4777-8777-777777777777";

interface Call {
  method: string;
  path: string;
  query: string;
  body?: unknown;
}

class FixtureExit extends Error {
  constructor(readonly code: number) {
    super(`fixture exit ${code}`);
  }
}

const scenario = process.env["TODOS_COMMAND_FIXTURE_SCENARIO"] ?? "";
const calls: Call[] = [];

const project = {
  id: PROJECT_ID,
  name: "Open Emails",
  path: "/workspace/open-emails",
  task_list_id: "open-emails",
};
const taskList = {
  id: LIST_ID,
  project_id: PROJECT_ID,
  slug: "release",
  name: "Release",
};
const plan = {
  id: PLAN_ID,
  slug: "stage-a-control",
  name: "Stage A control",
  description: "Injected Commander fixture",
  status: "active",
  project_id: null,
  created_at: "2026-07-18T00:00:00.000Z",
  updated_at: "2026-07-18T00:00:00.000Z",
};
const parentTask = {
  id: PARENT_ID,
  short_id: PARENT_ID.slice(0, 8),
  title: "Cloud parent",
  status: "pending",
  priority: "medium",
  tags: [],
  parent_id: null,
};

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: url.pathname, query: url.searchParams.toString(), ...(body === undefined ? {} : { body }) });

  if (scenario === "task-parent") {
    if (url.pathname === "/v1/stats" && method === "GET") {
      return response({ tasks: 1, tasks_all: 1 });
    }
    if (url.pathname === `/v1/tasks/${PARENT_ID}` && method === "GET") {
      return response({ task: parentTask });
    }
    if (url.pathname === "/v1/tasks" && method === "GET") {
      return response({ tasks: [parentTask], count: 1, total: 1 });
    }
    if (url.pathname === "/v1/tasks" && method === "POST") {
      return response({
        task: {
          id: TASK_ID,
          short_id: "11111111",
          title: (body as Record<string, unknown>)?.["title"],
          status: "pending",
          priority: "medium",
          tags: [],
          parent_id: (body as Record<string, unknown>)?.["parent_id"],
        },
      }, 201);
    }
  }

  if (scenario === "list-filter") {
    if (url.pathname === "/v1/projects" && method === "GET") return response({ projects: [project] });
    if (url.pathname === "/v1/task-lists" && method === "GET") return response({ task_lists: [taskList] });
    if (url.pathname === "/v1/tasks" && method === "GET") {
      return response({
        tasks: [{
          id: TASK_ID,
          short_id: "11111111",
          title: "Filtered task",
          status: "pending",
          priority: "high",
          tags: ["release"],
          assigned_to: "friday",
          project_id: PROJECT_ID,
          task_list_id: LIST_ID,
          updated_at: "2026-07-18T00:00:00.000Z",
        }],
      });
    }
  }

  if (scenario === "rename-success" || scenario === "rename-failure") {
    if (url.pathname === "/v1/projects" && method === "GET") return response({ projects: [project] });
    if (url.pathname === `/v1/projects/${PROJECT_ID}/rename` && method === "POST") {
      if (scenario === "rename-failure") return response({ error: "response unavailable" }, 503);
      return response({
        project: { ...project, name: (body as Record<string, unknown>)?.["name"], task_list_id: "emails-next" },
        task_lists_updated: 1,
      });
    }
  }

  if (scenario === "plans" || scenario === "plans-old-delete") {
    if (url.pathname === "/v1/plans" && method === "POST") {
      return response({ plan: { ...plan, ...(body as object) } }, 201);
    }
    if (url.pathname === "/v1/plans" && method === "GET") return response({ plans: [plan], count: 1 });
    if (url.pathname === `/v1/plans/${PLAN_ID}` && method === "GET") return response({ plan });
    if (url.pathname === `/v1/plans/${PLAN_ID}` && method === "PATCH") {
      return response({ plan: { ...plan, ...(body as object) } });
    }
    if (url.pathname === `/v1/plans/${PLAN_ID}` && method === "DELETE") {
      if (scenario === "plans-old-delete") return response({ error: "not found" }, 404);
      return response({ deleted: true, id: PLAN_ID });
    }
    if (url.pathname === "/v1/tasks" && method === "GET") return response({ tasks: [], count: 0 });
  }

  return response({ error: `unexpected synthetic request: ${method} ${url.pathname}` }, 500);
}) as typeof fetch;

const resolved = resolveStorageClient("todos", {
  HASNA_TODOS_STORAGE_MODE: "self_hosted",
  HASNA_TODOS_API_URL: "https://todos.command.test",
  HASNA_TODOS_API_KEY: "synthetic-command-fixture-key",
});
if (resolved.transport !== "cloud-http") throw new Error("expected synthetic cloud transport");
const client = resolved.client as HasnaStorageClient;

const program = new Command()
  .name("todos-command-fixture")
  .exitOverride()
  .option("--project <path>", "Project path")
  .option("-j, --json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");
const dependencies = { getCloudClient: () => client };
registerTaskCommands(program, {
  ...dependencies,
  resolveTaskReference: (ref) => ref.toLowerCase() === PARENT_ID.slice(0, 8) ? PARENT_ID : ref.toLowerCase(),
});
registerPlanTemplateCommands(program, dependencies);
registerProjectCommands(program, dependencies);

const originalExit = process.exit;
let exitCode = 0;
process.exit = ((code = 0) => {
  throw new FixtureExit(Number(code));
}) as typeof process.exit;

try {
  await program.parseAsync(["bun", "todos-command-fixture", ...process.argv.slice(2)]);
} catch (error) {
  if (error instanceof FixtureExit) {
    exitCode = error.code;
  } else if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("commander.")) {
    exitCode = Number((error as { exitCode?: unknown }).exitCode ?? 1);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    exitCode = 1;
  }
} finally {
  process.exit = originalExit;
  process.stderr.write(`\n__TODOS_COMMAND_CALLS__${JSON.stringify(calls)}\n`);
}

process.exitCode = exitCode;
