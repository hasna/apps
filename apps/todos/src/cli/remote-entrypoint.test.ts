import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  applyTodosCliAuthorityEnvironment,
  getTodosCliCommandCapabilityMatrix,
  initializeTodosCliAuthority,
  type TodosCliAuthorityInitialization,
} from "./stage-a.js";
import { getTodosCloudClient, resetTodosCloudClient } from "./cloud-router.js";
import { deliverTodosApiKeyViaDisk, TODOS_TEST_KEYCHAIN_ACCOUNT } from "../testing.js";
import {
  createBunPackageIsolatedTempDir,
  projectExternalBunDuplicatePackageWarning,
} from "../test/bun-fixture-isolation.js";
import {
  deriveTodosTaskManifestApplyPreconditionDigest,
  deriveTodosTaskManifestCompensationPreconditionDigest,
  deriveTodosTaskManifestIdempotencyKey,
  taskManifestCompensationRequestDigest,
  taskManifestRequestDigest,
} from "../task-manifest/index.js";

/** `todos add` warns on stderr when a task ends up both unassigned and unattributed —
 *  that warning is the point of the fix, not incidental noise, so it is stripped here
 *  rather than tolerated wholesale. Any OTHER stderr output still fails the assertion. */
function stderrWithoutAttributionWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.includes("ownerless and unattributable"))
    .join("\n")
    .trim();
}

const REPO_ROOT = join(import.meta.dir, "../..");

/**
 * Exact number of local-only commands in the Stage-A capability matrix.
 *
 * This is deliberately an exact literal, not a `>=` floor. A reclassification
 * in either direction must be reviewed deliberately rather than silently
 * changing which authority a command can reach.
 */
const EXPECTED_LOCAL_ONLY_COMMANDS = 114;
const TASK_FIXTURE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TASK_FIXTURE_ID = "22222222-2222-4222-8222-222222222222";
const tempRoots: string[] = [];
let buildRoot: string | undefined;
let executable: string;

const STALE_LOCK_HELP_INVOCATIONS: string[][] = [
  ["stale-lock-handoff", "--help"],
  ["help", "stale-lock-handoff"],
];

type CliResult = { exitCode: number; stdout: string; stderr: string; removedExternalBunWarnings: string[] };

async function buildCli(): Promise<string> {
  const ignoredBuildParent = join(REPO_ROOT, ".tmp");
  mkdirSync(ignoredBuildParent, { recursive: true });
  buildRoot = mkdtempSync(join(ignoredBuildParent, "remote-cli-entrypoint-"));
  const build = await Bun.build({
    entrypoints: [join(REPO_ROOT, "src/cli/index.tsx")],
    outdir: buildRoot,
    target: "bun",
    external: ["ink", "react", "chalk", "@modelcontextprotocol/sdk", "@hasna/contracts/client/storage"],
  });
  expect(build.success).toBe(true);
  expect(build.outputs).toHaveLength(1);
  return build.outputs[0]!.path;
}

async function runCli(executable: string, args: string[], env: Record<string, string>, cwd = REPO_ROOT): Promise<CliResult> {
  const proc = Bun.spawn(["bun", executable, ...args], {
    cwd,
    env: { ...env, NODE_PATH: join(REPO_ROOT, "node_modules") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const projected = projectExternalBunDuplicatePackageWarning(stderr);
  return { exitCode: await proc.exited, stdout, stderr: projected.stderr, removedExternalBunWarnings: projected.removed };
}

function staleLockCapabilityEnv(authorityUrl: string): Record<string, string> {
  const root = createBunPackageIsolatedTempDir("todos-stale-lock-capability-");
  tempRoots.push(root);
  const home = join(root, "home");
  mkdirSync(home);
  return {
    PATH: process.env.PATH ?? "",
    BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
    HOME: home,
    LANG: "C.UTF-8",
    TODOS_AUTO_PROJECT: "false",
    HASNA_TODOS_API_URL: authorityUrl,
    HASNA_TODOS_API_KEY: "fixture-remote-key",
  };
}

function staleLockCapabilityAuthority(advertiseHandoff: boolean) {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
        return Response.json({
          openapi: "3.1.0",
          paths: advertiseHandoff
            ? { "/v1/tasks/{id}/stale-lock-handoff": { post: {} } }
            : {},
        });
      }
      if (url.pathname === `/v1/tasks/${TASK_FIXTURE_ID}/stale-lock-handoff`) {
        return Response.json(
          { error: "unknown task action: stale-lock-handoff" },
          { status: 404 },
        );
      }
      return Response.json({ error: "fixture route missing" }, { status: 404 });
    },
  });
  return { requests, server };
}

function recursiveInventory(root: string, relative = ""): string[] {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root).sort();
  return entries.flatMap((entry) => {
    const childRelative = relative ? `${relative}/${entry}` : entry;
    const child = join(root, entry);
    return lstatSync(child).isDirectory()
      ? [`${childRelative}/`, ...recursiveInventory(child, childRelative)]
      : [childRelative];
  });
}

/** Files the CLI may legitimately keep under ~/.hasna/todos in remote mode.
 *  `identity.json` is client-side session state — "who am I in this shell" — written
 *  by `todos init` and removed by `todos release`. It carries no task data and is
 *  not an authority store, so it does not breach the remote-authority boundary.
 *  `config/` is the credential directory the @hasna/contracts chain READS —
 *  `config/credentials` is how these fixtures deliver the run's API key, so its
 *  presence is the opposite of a boundary breach. Everything else must still be
 *  absent. */
const REMOTE_SAFE_TODOS_HOME_ENTRIES = new Set(["identity.json", "config"]);

/** Nothing under ~/.hasna/todos/config may be a store; only the credential file lives there. */
const REMOTE_SAFE_TODOS_CONFIG_ENTRIES = new Set(["credentials"]);

function expectNoLocalDatabase(root: string, explicitPath: string): void {
  expect(existsSync(explicitPath)).toBe(false);
  expect(existsSync(join(root, ".todos"))).toBe(false);
  expect(existsSync(join(root, ".hasna", "todos", "todos.db"))).toBe(false);
  const configDir = join(root, ".hasna", "todos", "config");
  if (existsSync(configDir)) {
    expect(readdirSync(configDir).filter((entry) => !REMOTE_SAFE_TODOS_CONFIG_ENTRIES.has(entry))).toEqual([]);
  }
  // Assert on the CONTENTS rather than the directory's existence: the old check
  // used "the directory must not exist" as a proxy for "no local store was
  // created", which stopped being equivalent once a config file lived there.
  // Enumerating is strictly tighter — it also catches a stray .db under any name.
  const todosHome = join(root, ".hasna", "todos");
  if (!existsSync(todosHome)) return;
  const unexpected = readdirSync(todosHome).filter((entry) => !REMOTE_SAFE_TODOS_HOME_ENTRIES.has(entry));
  expect(unexpected).toEqual([]);
}

function registeredCliNames(): Set<string> {
  const files = [
    join(REPO_ROOT, "src/cli/index.tsx"),
    ...readdirSync(join(REPO_ROOT, "src/cli/commands"))
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => join(REPO_ROOT, "src/cli/commands", name)),
  ];
  const names = new Set<string>(["help"]);
  const rootCommand = (expression: ts.Expression): string | null => {
    let current = expression;
    while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      const property = current.expression;
      if (property.name.text === "command" && ts.isIdentifier(property.expression) && property.expression.text === "program") {
        const argument = current.arguments[0];
        return argument && ts.isStringLiteral(argument) ? argument.text.split(/[ <[]/)[0]! : null;
      }
      current = property.expression;
    }
    return null;
  };
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const property = node.expression;
        if (property.name.text === "command" && ts.isIdentifier(property.expression) && property.expression.text === "program") {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) names.add(argument.text.split(/[ <[]/)[0]!);
        }
        if (property.name.text === "alias" || property.name.text === "aliases") {
          const canonical = rootCommand(property.expression);
          if (canonical) {
            const argument = node.arguments[0];
            if (argument && ts.isStringLiteral(argument)) names.add(argument.text);
            if (argument && ts.isArrayLiteralExpression(argument)) {
              for (const item of argument.elements) if (ts.isStringLiteral(item)) names.add(item.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return names;
}

beforeAll(async () => {
  executable = await buildCli();
});

beforeEach(() => {
  resetTodosCloudClient();
});

afterEach(() => {
  resetTodosCloudClient();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (buildRoot) rmSync(buildRoot, { recursive: true, force: true });
});

describe("remote CLI entrypoint authority boundary", () => {
  test("every registered canonical command and alias has exactly one Stage-A capability owner", () => {
    const registered = [...registeredCliNames()].sort();
    const matrix = getTodosCliCommandCapabilityMatrix();
    expect([...matrix.keys()].sort()).toEqual(registered);
    expect([...matrix.values()].filter((owner) => owner === "local-only").length).toBe(EXPECTED_LOCAL_ONLY_COMMANDS);
    expect([...matrix.values()].every((owner) => ["diagnostic", "remote-http", "local-only"].includes(owner))).toBe(true);
  });

  test("built fail helper uses /v1 with reason and retry without opening SQLite", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.json().catch(() => ({}));
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
          return Response.json({
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/fail": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/FailTaskInput" },
                      },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                FailTaskInput: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    reason: { type: "string" },
                    retry: { type: "boolean" },
                  },
                },
              },
            },
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_FIXTURE_ID}/fail` && request.method === "POST") {
          return Response.json({
            result: {
              task: { id: TASK_FIXTURE_ID, short_id: "T-FAIL", title: "Remote fail", status: "failed", reason: "remote reason" },
              retryTask: { id: OTHER_TASK_FIXTURE_ID, short_id: "T-RETRY", title: "Remote retry", status: "pending" },
            },
          });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-fail-route-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);
    try {
      const result = await runCli(executable, [
        "--agent", "nausicaa", "--json", "fail", TASK_FIXTURE_ID, "--reason", "remote reason", "--retry",
      ], env, cwd);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        task: { id: TASK_FIXTURE_ID, status: "failed", reason: "remote reason" },
        retryTask: { id: OTHER_TASK_FIXTURE_ID, status: "pending" },
      });
      expect(requests).toEqual([
        { method: "GET", path: "/v1/openapi.json", body: {} },
        {
          method: "POST",
          path: `/v1/tasks/${TASK_FIXTURE_ID}/fail`,
          body: { agent_id: "nausicaa", reason: "remote reason", retry: true },
        },
      ]);
      expect(recursiveInventory(cwd)).toEqual(before);
      expectNoLocalDatabase(home, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built fail helper rejects a non-boolean retry schema before mutation", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.json().catch(() => ({}));
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
          return Response.json({
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/fail": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/FailTaskInput" },
                      },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                FailTaskInput: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    reason: { type: "string" },
                    retry: { type: "string" },
                  },
                },
              },
            },
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_FIXTURE_ID}/fail` && request.method === "POST") {
          return Response.json({
            result: {
              task: { id: TASK_FIXTURE_ID, status: "failed" },
              retryTask: { id: OTHER_TASK_FIXTURE_ID, status: "pending" },
            },
          });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-fail-route-incompatible-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);
    try {
      const result = await runCli(executable, [
        "--agent", "nausicaa", "--json", "fail", TASK_FIXTURE_ID, "--reason", "remote reason", "--retry",
      ], env, cwd);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("REMOTE_RETRY_UNSUPPORTED");
      expect(result.stderr).toContain("no failure mutation was sent");
      expect(requests).toEqual([
        { method: "GET", path: "/v1/openapi.json", body: {} },
      ]);
      expect(recursiveInventory(cwd)).toEqual(before);
      expectNoLocalDatabase(home, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built task-manifest CLI uses /v1 task-manifest routes without opening SQLite", async () => {
    const planId = "33333333-3333-4333-8333-333333333333";
    const receiptId = "44444444-4444-4444-8444-444444444444";
    const compensationReceiptId = "77777777-7777-4777-8777-777777777777";
    const outboxId = "55555555-5555-4555-8555-555555555555";
    const projectId = "66666666-6666-4666-8666-666666666666";
    const operationId = "task-manifest-cli-test";
    const applyStepId = "apply";
    const compensationStepId = "compensate";
    const manifestBase = {
      version: 1 as const,
      operation_id: operationId,
      step_id: applyStepId,
      idempotency_key: "",
      precondition_digest: "",
      project_id: projectId,
      plan: { key: "cli-test", name: "CLI test" },
      tasks: [{ key: "verify", title: "Verify CLI task-manifest route" }],
    };
    const applyPreconditionDigest = deriveTodosTaskManifestApplyPreconditionDigest(manifestBase);
    const applyRequestDigest = taskManifestRequestDigest({
      ...manifestBase,
      precondition_digest: applyPreconditionDigest,
    });
    const applyIdempotencyKey = deriveTodosTaskManifestIdempotencyKey({
      operation_id: operationId,
      step_id: applyStepId,
      direction: "apply",
      target_selector: projectId,
      request_digest: applyRequestDigest,
      precondition_digest: applyPreconditionDigest,
    });
    const compensationPreconditionDigest = deriveTodosTaskManifestCompensationPreconditionDigest({
      receipt_id: receiptId,
      operation_id: operationId,
      step_id: compensationStepId,
      if_binding_version: 1,
    });
    const compensationRequestDigest = taskManifestCompensationRequestDigest({
      receipt_id: receiptId,
      operation_id: operationId,
      step_id: compensationStepId,
      precondition_digest: compensationPreconditionDigest,
      if_binding_version: 1,
    });
    const compensationIdempotencyKey = deriveTodosTaskManifestIdempotencyKey({
      operation_id: operationId,
      step_id: compensationStepId,
      direction: "compensate",
      target_selector: receiptId,
      request_digest: compensationRequestDigest,
      precondition_digest: compensationPreconditionDigest,
    });
    const remoteKey = "fixture-remote-key";
    const expectedAuthorization = `${"Bear"}er ${remoteKey}`;
    const requests: Array<{ method: string; path: string; body: unknown; authorized: boolean }> = [];
    let applyCount = 0;
    const applyResult = (duplicate: boolean) => ({
      duplicate,
      receipt: {
        receipt_id: receiptId,
        authority: "todos",
        route: "todos.task-manifest.v1",
        schema_version: 1,
        kind: "apply",
        operation_id: operationId,
        step_id: applyStepId,
        idempotency_key: applyIdempotencyKey,
        request_digest: applyRequestDigest,
        precondition_digest: applyPreconditionDigest,
        result_digest: "a".repeat(64),
        outcome: "accepted",
        reason: null,
        duplicate_of_receipt_id: null,
        binding_version: 1,
        apply_receipt_id: null,
        created_at: "2026-08-10T08:00:00.000Z",
      },
      graph: { plan_id: planId, task_ids: { verify: TASK_FIXTURE_ID }, comment_ids: [], verification_ids: [], dependency_ids: [] },
      readback: { plans: 1, tasks: 1, dependencies: 0, comments: 0, verifications: 0, complete: true },
      outbox_ids: [outboxId],
      result_digest: "a".repeat(64),
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.json().catch(() => ({}));
        requests.push({
          method: request.method,
          path: url.pathname,
          body,
          authorized: request.headers.get("authorization") === expectedAuthorization,
        });
        if (url.pathname === "/v1/task-manifest/capability" && request.method === "GET") {
          return Response.json({
            capability: {
              authority: "todos",
              route: "todos.task-manifest.v1",
              schema_version: 1,
              tenant_id: "tenant-cli-test",
              backend: "http",
              deterministic_ids: true,
              operation_step_identity: true,
              deterministic_idempotency_keys: true,
              terminal_nonacceptance_receipts: true,
              plan_slug_provenance: "deterministic-v1",
              immutable_receipts: true,
              transactional_outbox: true,
              idempotent_outbox_delivery: true,
              exact_bounded_readback: true,
              conditional_compensation: true,
              transcript_safe: false,
              bounds: {
                tasks: 100,
                dependencies: 200,
                comments: 200,
                verifications: 200,
                effects: 50,
                metadata_fields: 100,
                effect_payload_fields: 100,
                request_bytes: 262144,
                response_bytes: 262144,
              },
            },
          });
        }
        if (url.pathname === "/v1/task-manifest/apply" && request.method === "POST") {
          applyCount += 1;
          return Response.json({ result: applyResult(applyCount > 1) }, { status: 201 });
        }
        if (url.pathname === "/v1/task-manifest/read-exact" && request.method === "POST") {
          return Response.json({ result: applyResult(false) });
        }
        if (url.pathname === "/v1/task-manifest/bindings/lookup" && request.method === "POST") {
          return Response.json({
            result: {
              authority: "todos",
              route: "todos.task-manifest.v1",
              schema_version: 1,
              tenant_id: "tenant-cli-test",
              plan_id: planId,
              operation_id: operationId,
              step_id: applyStepId,
              apply_receipt_id: receiptId,
              binding_version: 1,
              state: "applied",
            },
          });
        }
        if (url.pathname === "/v1/task-manifest/compensate" && request.method === "POST") {
          return Response.json({
            result: {
              duplicate: false,
              receipt: {
                receipt_id: compensationReceiptId,
                authority: "todos",
                route: "todos.task-manifest.v1",
                schema_version: 1,
                kind: "compensate",
                operation_id: operationId,
                step_id: compensationStepId,
                idempotency_key: compensationIdempotencyKey,
                request_digest: compensationRequestDigest,
                precondition_digest: compensationPreconditionDigest,
                result_digest: "b".repeat(64),
                outcome: "accepted",
                reason: null,
                duplicate_of_receipt_id: null,
                binding_version: 2,
                apply_receipt_id: receiptId,
                created_at: "2026-08-10T08:05:00.000Z",
              },
              absent: true,
              readback: { plans: 0, tasks: 0, dependencies: 0, comments: 0, verifications: 0, complete: true },
            },
          }, { status: 201 });
        }
        if (url.pathname === "/v1/task-manifest/outbox/delivered" && request.method === "POST") {
          return Response.json({ delivered: true });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-task-manifest-cli-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const manifestPath = join(cwd, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      operation_id: "task-manifest-cli-test",
      step_id: applyStepId,
      idempotency_key: applyIdempotencyKey,
      precondition_digest: applyPreconditionDigest,
      project_id: projectId,
      plan: manifestBase.plan,
      tasks: manifestBase.tasks,
    }));
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: remoteKey,
});
    const before = recursiveInventory(cwd);
    try {
      const capability = await runCli(executable, ["--json", "task-manifest", "capability"], env, cwd);
      const first = await runCli(executable, ["--json", "task-manifest", "apply", "--file", manifestPath], env, cwd);
      const second = await runCli(executable, ["--json", "task-manifest", "apply", "--file", manifestPath], env, cwd);
      const readExact = await runCli(executable, ["--json", "task-manifest", "read-exact", receiptId], env, cwd);
      const lookup = await runCli(executable, [
        "--json", "task-manifest", "lookup", "--plan-id", planId,
      ], env, cwd);
      const explicitLookup = await runCli(executable, [
        "--json", "task-manifest", "lookup", "--tenant-id", "tenant-cli-explicit", "--plan-id", planId,
      ], env, cwd);
      const compensated = await runCli(executable, [
        "--json", "task-manifest", "compensate", "--receipt-id", receiptId,
        "--operation-id", operationId, "--step-id", compensationStepId,
        "--idempotency-key", compensationIdempotencyKey,
        "--precondition-digest", compensationPreconditionDigest,
        "--if-binding-version", "1",
      ], env, cwd);
      const delivered = await runCli(executable, ["--json", "task-manifest", "outbox-delivered", outboxId], env, cwd);

      expect({ exitCode: capability.exitCode, stderr: capability.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect({ exitCode: first.exitCode, stderr: first.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect({ exitCode: second.exitCode, stderr: second.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect({ exitCode: readExact.exitCode, stderr: readExact.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect({ exitCode: lookup.exitCode, stderr: lookup.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect({ exitCode: explicitLookup.exitCode, stderr: explicitLookup.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect({ exitCode: compensated.exitCode, stderr: compensated.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect({ exitCode: delivered.exitCode, stderr: delivered.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(capability.stdout).capability).toMatchObject({
        authority: "todos",
        route: "todos.task-manifest.v1",
        tenant_id: "tenant-cli-test",
        backend: "http",
      });
      expect(JSON.parse(first.stdout).result).toMatchObject({ duplicate: false, receipt: { receipt_id: receiptId } });
      expect(JSON.parse(second.stdout).result).toMatchObject({ duplicate: true, receipt: { receipt_id: receiptId } });
      expect(JSON.parse(readExact.stdout).result).toMatchObject({ duplicate: false, receipt: { receipt_id: receiptId } });
      expect(first.stdout).not.toContain("AUTH_KEY");
      expect(first.stdout).not.toContain("TEST_KEY");
      expect(JSON.parse(lookup.stdout).result).toEqual({
        authority: "todos",
        route: "todos.task-manifest.v1",
        schema_version: 1,
        tenant_id: "tenant-cli-test",
        plan_id: planId,
        operation_id: operationId,
        step_id: applyStepId,
        apply_receipt_id: receiptId,
        binding_version: 1,
        state: "applied",
      });
      expect(JSON.parse(explicitLookup.stdout).result).toEqual(JSON.parse(lookup.stdout).result);
      expect(JSON.parse(compensated.stdout).result).toMatchObject({
        duplicate: false,
        receipt: { receipt_id: compensationReceiptId, apply_receipt_id: receiptId, binding_version: 2 },
        absent: true,
      });
      expect(JSON.parse(delivered.stdout)).toEqual({ delivered: true });
      expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        "GET /v1/task-manifest/capability",
        "POST /v1/task-manifest/apply",
        "POST /v1/task-manifest/apply",
        "POST /v1/task-manifest/read-exact",
        "GET /v1/task-manifest/capability",
        "POST /v1/task-manifest/bindings/lookup",
        "POST /v1/task-manifest/bindings/lookup",
        "POST /v1/task-manifest/compensate",
        "POST /v1/task-manifest/outbox/delivered",
      ]);
      expect(requests[3]!.body).toEqual({ receipt_id: receiptId });
      expect(requests[5]!.body).toEqual({
        authority: "todos",
        route: "todos.task-manifest.v1",
        schema_version: 1,
        tenant_id: "tenant-cli-test",
        plan_id: planId,
        max_items: 1,
      });
      expect(requests[6]!.body).toEqual({
        authority: "todos",
        route: "todos.task-manifest.v1",
        schema_version: 1,
        tenant_id: "tenant-cli-explicit",
        plan_id: planId,
        max_items: 1,
      });
      expect(requests[7]!.body).toEqual({
        receipt_id: receiptId,
        operation_id: operationId,
        step_id: compensationStepId,
        idempotency_key: compensationIdempotencyKey,
        precondition_digest: compensationPreconditionDigest,
        if_binding_version: 1,
      });
      expect(requests[8]!.body).toEqual({ outbox_id: outboxId });
      expect(requests.every((request) => request.authorized)).toBe(true);
      expect(recursiveInventory(cwd)).toEqual(before);
      expectNoLocalDatabase(home, localDbPath);
    } finally {
      server.stop(true);
    }
  }, 30000);

  test("selects HTTP before local-capable command modules initialize", () => {
    const result: TodosCliAuthorityInitialization = initializeTodosCliAuthority(
      ["--json", "status"],
      {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    );

    expect(result).toEqual({
      route: "remote-http",
      v1_base_url: "https://authority.invalid/v1",
    });
    expect(() => initializeTodosCliAuthority(
      ["task", "--json", "upsert", "--fingerprint", "fixture", "--title", "Fixture"],
      {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).not.toThrow();

    expect(() => initializeTodosCliAuthority(
      ["storage", "artifacts", "upload", "--run-id", "status"],
      {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).toThrow("REMOTE_COMMAND_UNSUPPORTED");
    expect(() => initializeTodosCliAuthority(
      ["config", "--set", "danger=true"],
      {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).toThrow("REMOTE_COMMAND_UNSUPPORTED");
    expect(() => initializeTodosCliAuthority(
      ["projects", "--add", "/workspace/example", "--dry-run"],
      {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).toThrow("REMOTE_COMMAND_UNSUPPORTED");

    for (const args of [
      ["--project", "--help", "storage", "artifacts", "upload", "--run-id", "status"],
      ["--agent", "--help", "config", "--set", "danger=true"],
      ["--session", "--help", "projects", "--dry-run", "--add", "/workspace/example"],
      ["--unknown-leading", "--help"],
      ["storage", "--project", "fixture", "status", "extra"],
      ["config", "--get", "--help"],
      ["list", "--recurring"],
      ["claim", "fixture-agent", "--stale-minutes", "30"],
      ["claim", "fixture-agent", "--steal-stale"],
      ["status", "--agent", "fixture-agent"],
      ["bulk", "unknown", TASK_FIXTURE_ID],
      ["bulk", "done", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
      // `bulk tag|untag` needs something to apply. Failing closed here is what
      // stops a no-op backfill from reporting success over thousands of rows.
      ["bulk", "tag", TASK_FIXTURE_ID],
      ["bulk", "untag", TASK_FIXTURE_ID],
      // The tag actions carry no plan semantics, so the plan flags stay
      // rejected rather than being silently ignored.
      ["bulk", "tag", TASK_FIXTURE_ID, "--tag", "directive:k_abc", "--plan", "fixture-plan"],
      ["projects", "--path-prefix", "/tmp"],
      ["plans", "--write-artifacts"],
    ]) {
      expect(() => initializeTodosCliAuthority(args, {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      })).toThrow("REMOTE_COMMAND_UNSUPPORTED");
    }

    for (const args of [
      ["storage", "status"],
      ["config"],
      ["config", "--get", "completion_guard.enabled"],
      ["init", "fixture-agent"],
      ["agents"],
      ["heartbeat", "fixture-agent"],
      ["release", "fixture-agent"],
      ["lock", "11111111-1111-4111-8111-111111111111"],
      ["unlock", "11111111-1111-4111-8111-111111111111"],
      ["active"],
      ["timeline"],
      ["--project=fixture", "lists"],
      ["lists", "--project", "fixture", "--json"],
      ["storage", "--project=fixture", "status"],
      ["--agent=fixture-agent", "comment", TASK_FIXTURE_ID, "note"],
      ["history", TASK_FIXTURE_ID],
      ["approve", TASK_FIXTURE_ID],
      ["complete", TASK_FIXTURE_ID],
      ["bulk", "done", TASK_FIXTURE_ID],
      // Bulk plan reassignment is serviced remotely (shared plan lookup + PATCH
      // per task), so it must not fail closed under remote authority.
      ["bulk", "plan", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
      ["bulk", "move-plan", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
      ["bulk", "plan", TASK_FIXTURE_ID, "--clear-plan"],
      // Bulk tagging is serviced remotely (read the row, merge, PATCH
      // /v1/tasks/<id>). Provenance backfill is the reason it exists: stamping
      // `directive:<knowledge-id>` onto existing work must not require one
      // process per task, and must not fail closed under remote authority.
      ["bulk", "tag", TASK_FIXTURE_ID, "--tag", "directive:k_msd4cz8t_ste6f4"],
      ["bulk", "untag", TASK_FIXTURE_ID, "--tag", "directive:k_msd4cz8t_ste6f4"],
      ["bulk", "tag", TASK_FIXTURE_ID, "--tag", "directive:k_abc,governance"],
      ["deps", TASK_FIXTURE_ID, "--needs", OTHER_TASK_FIXTURE_ID],
      // `deps <id>` works remotely, so its presentation-only flags must stay
      // supported too: `--graph`/`--direction` degrade to the same flat edges
      // rather than flipping a working command to REMOTE_COMMAND_UNSUPPORTED.
      ["deps", TASK_FIXTURE_ID],
      ["deps", TASK_FIXTURE_ID, "--graph"],
      ["deps", TASK_FIXTURE_ID, "--graph", "--json"],
      ["deps", TASK_FIXTURE_ID, "--direction=up"],
      ["deps", TASK_FIXTURE_ID, "--direction", "down"],
      ["link-commit", TASK_FIXTURE_ID, "abc123"],
      ["find-commit", "abc123"],
      ["link-ref", TASK_FIXTURE_ID, "branch/name"],
      ["find-ref", "branch/name"],
      ["record-verification", TASK_FIXTURE_ID, "bun test"],
      ["recap"],
      ["standup"],
      // Dedicated alias mutators must share the same remote capability surface as
      // their `update --assign`/`update --tags` equivalents (assign-tag-untag bug).
      ["assign", TASK_FIXTURE_ID, "fixture-agent"],
      ["tag", TASK_FIXTURE_ID, "fixture-tag"],
      ["untag", TASK_FIXTURE_ID, "fixture-tag"],
      ["projects", "--path-prefix", "/tmp", "--deregister", "fixture"],
      ["projects", "--deregister=fixture", "--dry-run"],
    ]) {
      expect(() => initializeTodosCliAuthority(args, {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      })).not.toThrow();
    }
  });

  test("shell-completion generation stays diagnostic in remote mode even with a shell argument", () => {
    for (const args of [
      ["completions", "bash"],
      ["completions", "zsh"],
      ["completions", "fish"],
      ["completion", "bash"],
      ["completion", "zsh"],
      ["completion", "fish"],
    ]) {
      const result = initializeTodosCliAuthority(args, {
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      });
      expect(result).toEqual({
        route: "remote-diagnostic",
        v1_base_url: "https://authority.invalid/v1",
      });
    }
  });

  test("built Stage-A adversarial invocations leave synthetic cwd and HOME byte-for-byte absent", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        return Response.json({ error: "Stage A should have rejected before HTTP" }, { status: 500 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-stage-a-adversarial-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);
    try {
      for (const args of [
        ["storage", "artifacts", "upload", "--run-id", "status"],
        ["storage", "artifacts", "upload", "--run-id", "--help"],
        ["--project", "--help", "storage", "artifacts", "upload", "--run-id", "status"],
        ["--unknown-leading", "--help"],
        ["config", "--set", "danger=true"],
        ["config", "--get", "--help"],
        ["projects", "--add", "/workspace/example", "--dry-run"],
        ["projects", "--update", "example", "--name", "changed", "--dry-run"],
        ["list", "--recurring"],
        ["claim", "fixture-agent", "--stale-minutes", "30"],
        ["claim", "fixture-agent", "--steal-stale"],
        ["--project", "fixture", "claim", "fixture-agent"],
        ["--agent", "fixture", "status"],
        ["bulk", "unknown", TASK_FIXTURE_ID],
        ["bulk", "done", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
        ["projects", "--path-prefix", "/tmp"],
        ["plans", "--write-artifacts"],
        ["agents-normalize"],
      ]) {
        const requestCount = requests.length;
        const result = await runCli(executable, args, env, cwd);
        expect({ args, exitCode: result.exitCode }).toEqual({ args, exitCode: 1 });
        expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
        expect(requests).toHaveLength(requestCount);
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(home, localDbPath);
      }
    } finally {
      server.stop(true);
    }
  }, 45_000);

  test("built projects --deregister applies its guards and deletes through /v1", async () => {
    const PROJECT_ID = "77777777-7777-4777-8777-777777777777";
    const project = { id: PROJECT_ID, name: "Disposable", path: "/tmp/disposable", task_list_id: null };
    const completedTask = {
      id: "88888888-8888-4888-8888-888888888888",
      title: "Completed probe",
      status: "completed",
      project_id: PROJECT_ID,
      parent_id: "99999999-9999-4999-8999-999999999999",
    };
    const tasks: Array<Record<string, unknown>> = [completedTask];
    const requests: string[] = [];
    let deleted = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}${url.search}`);
        if (url.pathname === "/v1/projects" && request.method === "GET") {
          return Response.json({ projects: deleted ? [] : [project] });
        }
        if (url.pathname === "/v1/tasks" && request.method === "GET") {
          const items = tasks.filter((task) => task.project_id === url.searchParams.get("project_id"));
          return Response.json({ tasks: items, count: items.length, total: items.length });
        }
        if (url.pathname === `/v1/projects/${PROJECT_ID}` && request.method === "DELETE") {
          deleted = true;
          return Response.json({ deleted: true, id: PROJECT_ID });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-remote-deregister-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    mkdirSync(cwd);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);
    try {
      const dryRun = await runCli(executable, [
        "--json", "projects", "--deregister", PROJECT_ID, "--path-prefix", "/tmp", "--dry-run",
      ], env, cwd);
      expect({ exitCode: dryRun.exitCode, stderr: dryRun.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(dryRun.stdout)).toMatchObject({
        action: "would_deregister",
        project_id: PROJECT_ID,
        total_tasks: 1,
        incomplete_tasks: 0,
        tasks_preserved: true,
      });
      expect(deleted).toBe(false);
      expect(requests).toContain(`GET /v1/tasks?project_id=${PROJECT_ID}&include_subtasks=true`);

      tasks.push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending", project_id: PROJECT_ID });
      const incomplete = await runCli(executable, [
        "projects", "--deregister", PROJECT_ID, "--path-prefix", "/tmp",
      ], env, cwd);
      expect(incomplete.exitCode).toBe(1);
      expect(incomplete.stderr).toContain("1 incomplete task(s) remain");
      expect(deleted).toBe(false);
      tasks.pop();

      const outsidePrefix = await runCli(executable, [
        "projects", "--deregister", PROJECT_ID, "--path-prefix", "/tmp/disposable-sibling",
      ], env, cwd);
      expect(outsidePrefix.exitCode).toBe(1);
      expect(outsidePrefix.stderr).toContain("is not within /tmp/disposable-sibling");
      expect(deleted).toBe(false);

      const deregistered = await runCli(executable, [
        "--json", "projects", `--deregister=${PROJECT_ID}`, "--path-prefix=/tmp",
      ], env, cwd);
      expect({ exitCode: deregistered.exitCode, stderr: deregistered.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(deregistered.stdout)).toMatchObject({
        action: "deregistered",
        project_id: PROJECT_ID,
        total_tasks: 1,
        incomplete_tasks: 0,
        tasks_preserved: true,
      });
      expect(deleted).toBe(true);
      expect(requests.at(-1)).toBe(`DELETE /v1/projects/${PROJECT_ID}`);
      expect(recursiveInventory(cwd)).toEqual(before);
      expectNoLocalDatabase(root, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("only redaction configuration and scans select local transport under hosted configuration", () => {
    const hostedEnv = {
      HASNA_TODOS_API_URL: "https://authority.invalid",
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    const localOnly = [...getTodosCliCommandCapabilityMatrix()]
      .filter(([, owner]) => owner === "local-only")
      .map(([command]) => command)
      .sort();
    expect(localOnly.length).toBe(EXPECTED_LOCAL_ONLY_COMMANDS);

    for (const command of localOnly.filter((candidate) => candidate !== "redaction")) {
      const env = { ...hostedEnv };
      expect(() => initializeTodosCliAuthority([command], env)).toThrow(/REMOTE_COMMAND_UNSUPPORTED/);
      expect(env.HASNA_TODOS_API_KEY).toBe("fixture-remote-key");
      expect(getTodosCloudClient(env)?.baseUrl).toBe("https://authority.invalid/v1");
    }

    for (const subcommand of ["status", "add", "scan"]) {
      const env = { ...hostedEnv };
      const authority = initializeTodosCliAuthority(["redaction", subcommand], env);
      expect(authority).toEqual({
        route: "local",
        v1_base_url: null,
        selected_by: "local-only-command",
      });
      applyTodosCliAuthorityEnvironment(authority, env);
      // REMOVED, not blanked: the resolver refuses a declared-but-blank
      // authority or credential loudly instead of reading it as absent, so the
      // admitted-local decision has to spell "absent" as absent.
      expect("HASNA_TODOS_API_URL" in env).toBe(false);
      expect("HASNA_TODOS_API_KEY" in env).toBe(false);
      // And the opt-in it stamps is what actually holds the decision: the
      // Keychain and the credential file are not consulted at all, so a machine
      // that has either cannot reconstruct hosted routing for a local command.
      expect(env.HASNA_TODOS_LOCAL).toBe("1");
      expect(getTodosCloudClient(env)).toBeNull();
    }

    expect(() => initializeTodosCliAuthority(["redaction", "evidence"], hostedEnv))
      .toThrow(/REMOTE_COMMAND_UNSUPPORTED/);
  });

  test("built help and manual advertise only remote-executable commands", async () => {
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: createBunPackageIsolatedTempDir("todos-remote-help-"),
      LANG: "C.UTF-8",
      HASNA_TODOS_API_URL: "https://authority.invalid",
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    tempRoots.push(env.HOME);

    const localOnly = [...getTodosCliCommandCapabilityMatrix()]
      .filter(([, owner]) => owner === "local-only")
      .map(([command]) => command);

    const manual = await runCli(executable, ["manual", "--json"], env);
    expect(manual.exitCode).toBe(0);
    const parsed = JSON.parse(manual.stdout) as {
      local_only: boolean;
      examples: string[];
      commands: { path: string[] }[];
    };
    const advertised = parsed.commands.map((entry) => entry.path[0] ?? "");
    // Regression: no advertised command may be one Stage A rejects at runtime.
    expect(advertised.filter((name) => localOnly.includes(name))).toEqual([]);
    for (const name of ["status", "list", "add"]) expect(advertised).toContain(name);
    for (const name of ["ready", "usage", "burndown", "summary", "verify-providers"]) {
      expect(advertised).not.toContain(name);
    }
    expect(parsed.local_only).toBe(false);
    expect(parsed.examples.some((example) => example.startsWith("todos ready"))).toBe(false);

    const help = await runCli(executable, ["--help"], env);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).not.toMatch(/\bburndown\b/);
    expect(help.stdout).not.toMatch(/\bverify-providers\b/);
    expect(help.stdout).toMatch(/\bstatus\b/);
  });

  test("unsupported authorities hide stale-lock handoff from every help form", async () => {
    const { requests, server } = staleLockCapabilityAuthority(false);
    const env = staleLockCapabilityEnv(`http://127.0.0.1:${server.port}`);
    try {
      const help = await runCli(executable, ["--help"], env);
      expect(help.exitCode).toBe(0);
      expect(help.stdout).not.toMatch(/\bstale-lock-handoff\b/);

      for (const args of STALE_LOCK_HELP_INVOCATIONS) {
        const directHelp = await runCli(executable, args, env);
        expect(directHelp.exitCode).not.toBe(0);
        expect(directHelp.stderr).toContain("REMOTE_COMMAND_UNAVAILABLE");
        expect(`${directHelp.stdout}\n${directHelp.stderr}`).not.toContain(
          "Usage: todos stale-lock-handoff",
        );
      }

      const result = await runCli(executable, [
        "--agent", "fixture-agent",
        "stale-lock-handoff", TASK_FIXTURE_ID,
        "--expected-holder", "previous-agent",
        "--expected-lock-version", "2020-01-01T00:00:00.000Z",
        "--stale-after-seconds", "3600",
        "--new-holder", "fixture-agent",
        "--reason", "remote version-skew control",
      ], env);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("REMOTE_STALE_LOCK_HANDOFF_UNSUPPORTED");
      expect(requests).toEqual([
        "GET /v1/openapi.json",
        "GET /v1/openapi.json",
        "GET /v1/openapi.json",
        "GET /v1/openapi.json",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("compatible authorities expose stale-lock handoff in every help form", async () => {
    const { requests, server } = staleLockCapabilityAuthority(true);
    const env = staleLockCapabilityEnv(`http://127.0.0.1:${server.port}`);
    try {
      const compatibleHelp = await runCli(executable, ["--help"], env);
      expect(compatibleHelp.exitCode).toBe(0);
      expect(compatibleHelp.stdout).toMatch(/\bstale-lock-handoff\b/);
      expect(requests).toEqual(["GET /v1/openapi.json"]);

      for (const args of STALE_LOCK_HELP_INVOCATIONS) {
        const directHelp = await runCli(executable, args, env);
        expect(directHelp.exitCode).toBe(0);
        expect(directHelp.stdout).toContain("Usage: todos stale-lock-handoff");
      }
    } finally {
      server.stop(true);
    }
  });

  test("unreachable authorities hide stale-lock handoff from named help", async () => {
    const { server } = staleLockCapabilityAuthority(true);
    const authorityUrl = `http://127.0.0.1:${server.port}`;
    server.stop(true);
    const env = staleLockCapabilityEnv(authorityUrl);
    for (const args of STALE_LOCK_HELP_INVOCATIONS) {
      const unreachableHelp = await runCli(executable, args, env);
      expect(unreachableHelp.exitCode).not.toBe(0);
      expect(unreachableHelp.stderr).toContain("REMOTE_COMMAND_UNAVAILABLE");
      expect(`${unreachableHelp.stdout}\n${unreachableHelp.stderr}`).not.toContain(
        "Usage: todos stale-lock-handoff",
      );
    }
  });

  test("built status command uses /v1 and never opens the local or Postgres adapter", async () => {
    const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          method: request.method,
          path: url.pathname,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/v1/stats") {
          return Response.json({ tasks: 0, projects: 0 });
        }
        if (url.pathname === "/v1/tasks") {
          return Response.json({ tasks: [], count: 0 });
        }
        return Response.json({ error: "route not present in fixture" }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-remote-entrypoint-");
    tempRoots.push(root);
    const localDbPath = join(root, "local-adapter-must-not-open", "todos.db");

    try {
      const result = await runCli(executable, ["--json", "status"], deliverTodosApiKeyViaDisk({
          PATH: process.env.PATH ?? "",
          BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_AUTO_PROJECT: "false",
          TODOS_DB_PATH: localDbPath,
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: "fixture-remote-key",
      }));

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        source: "cloud",
        transport: "http-v1",
        authority: { v1_base_url: `http://127.0.0.1:${server.port}/v1`, local_fallback: false },
        total: 0,
      });
      expect(requests.some((request) => request.path === "/v1/stats")).toBe(true);
      expect(requests.some((request) => request.path === "/v1/tasks")).toBe(true);
      expect(requests.every((request) => request.authorization === "Bearer fixture-remote-key")).toBe(true);
      expect(existsSync(join(root, "local-adapter-must-not-open"))).toBe(false);
      expectNoLocalDatabase(root, localDbPath);

      for (const diagnostic of [["--json", "config"], ["--json", "storage", "status"]]) {
        const diagnosticResult = await runCli(executable, diagnostic, {
          PATH: process.env.PATH ?? "",
          BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_DB_PATH: localDbPath,
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: "fixture-remote-key",
        });
        expect({ exitCode: diagnosticResult.exitCode, stderr: diagnosticResult.stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(() => JSON.parse(diagnosticResult.stdout)).not.toThrow();
        expectNoLocalDatabase(root, localDbPath);
      }

      // A credential with no URL is no longer half-configured: the fleet gateway
      // is the default authority (hasna/apps#1720), so the URL-missing arm this
      // block used to assert no longer exists. The half that is still missing —
      // and still fatal — is the CREDENTIAL. `HASNA_STATION` is pinned to an
      // account no item uses because the Keychain tier is ambient for the
      // spawned process and is exactly what an env dictionary cannot blank:
      // without the pin, the developer's own item would satisfy this run. The
      // HOME is a FRESH one for the same reason: `root` already holds the
      // credential file this fixture delivered for the hosted runs above, and
      // the disk tier would resolve it.
      const credentiallessHome = createBunPackageIsolatedTempDir("todos-remote-no-credential-");
      tempRoots.push(credentiallessHome);
      const missingKey = await runCli(executable, ["--json", "projects"], {
        PATH: process.env.PATH ?? "",
        BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
        HOME: credentiallessHome,
        TMPDIR: credentiallessHome,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: localDbPath,
        HASNA_STATION: TODOS_TEST_KEYCHAIN_ACCOUNT,
        HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      });
      expect(missingKey.exitCode).toBe(1);
      expect(missingKey.stderr).toContain("REMOTE_API_KEY_MISSING");
      expectNoLocalDatabase(root, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built safe coordination handlers use only V1 and preserve a synthetic filesystem", async () => {
    const TASK_ID = "11111111-1111-4111-8111-111111111111";
    const AGENT_ID = "22222222-2222-4222-8222-222222222222";
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "GET" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
        requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
        if (request.headers.get("authorization") !== "Bearer fixture-remote-key") {
          return Response.json({ error: "fixture auth required" }, { status: 401 });
        }
        if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
          return Response.json({
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/stale-lock-handoff": {
                post: {},
              },
            },
          });
        }
        const agent = { id: AGENT_ID, name: "fixture-agent", last_seen_at: "2026-07-18T00:00:00.000Z" };
        const task = {
          id: TASK_ID,
          short_id: "FIX-1",
          title: "Fixture task",
          status: "in_progress",
          priority: "medium",
          updated_at: "2026-07-18T00:00:00.000Z",
        };
        if (url.pathname === "/v1/agents" && request.method === "POST") return Response.json({ agent }, { status: 201 });
        if (url.pathname === "/v1/agents" && request.method === "GET") return Response.json({ agents: [agent], count: 1 });
        if (url.pathname === "/v1/agents/fixture-agent/heartbeat") return Response.json({ agent });
        if (url.pathname === "/v1/agents/fixture-agent/release") return Response.json({ agent, released: true });
        if (url.pathname === `/v1/tasks/${TASK_ID}/lock`) return Response.json({ result: { success: true, locked_by: "fixture-agent" } });
        if (url.pathname === `/v1/tasks/${TASK_ID}/unlock`) return Response.json({ success: true });
        if (url.pathname === `/v1/tasks/${TASK_ID}/stale-lock-handoff`) {
          return Response.json({
            receipt: {
              schema_version: "todos.stale-lock-handoff.v1",
              receipt_id: "33333333-3333-4333-8333-333333333333",
              task_id: TASK_ID,
              actor: "fixture-agent",
              previous_holder: "previous-agent",
              previous_lock_version: "2020-01-01T00:00:00.000Z",
              new_holder: "fixture-agent",
              new_lock_version: "2026-08-09T10:00:00.000Z",
              stale_after_seconds: 3600,
              stale_cutoff: "2026-08-09T09:00:00.000Z",
              reason: "remote exact stale lock",
              created_at: "2026-08-09T10:00:00.000Z",
            },
          });
        }
        if (url.pathname === "/v1/tasks" && url.searchParams.get("status") === "in_progress") {
          return Response.json({ tasks: [task], count: 1, total: 1 });
        }
        if (url.pathname === "/v1/activity") return Response.json({ activity: [], count: 0 });
        return Response.json({ error: `fixture route missing: ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-safe-coordination-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);
    try {
      for (const args of [
        ["--json", "init", "  fixture-agent  "],
        ["--json", "agents"],
        ["--json", "heartbeat", "fixture-agent"],
        ["--json", "release", "fixture-agent"],
        ["--agent", "fixture-agent", "--json", "lock", TASK_ID],
        ["--agent", "fixture-agent", "--json", "unlock", TASK_ID],
        [
          "--agent", "fixture-agent", "--json", "stale-lock-handoff", TASK_ID,
          "--expected-holder", "previous-agent",
          "--expected-lock-version", "2020-01-01T00:00:00.000Z",
          "--stale-after-seconds", "3600",
          "--new-holder", "fixture-agent",
          "--reason", "remote exact stale lock",
        ],
        ["--json", "active"],
        ["--json", "timeline"],
      ]) {
        const result = await runCli(executable, args, env, cwd);
        expect({ args, exitCode: result.exitCode, stderr: stderrWithoutAttributionWarning(result.stderr) }).toEqual({ args, exitCode: 0, stderr: "" });
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(home, localDbPath);
      }
      expect(requests.find((request) => request.method === "POST" && request.path === "/v1/agents")?.body).toEqual({
        name: "fixture-agent",
      });
      expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        "GET /v1/agents",
        "POST /v1/agents",
        "GET /v1/agents",
        "POST /v1/agents/fixture-agent/heartbeat",
        "POST /v1/agents/fixture-agent/release",
        `POST /v1/tasks/${TASK_ID}/lock`,
        `POST /v1/tasks/${TASK_ID}/unlock`,
        "GET /v1/openapi.json",
        `POST /v1/tasks/${TASK_ID}/stale-lock-handoff`,
        "GET /v1/tasks?status=in_progress",
        "GET /v1/activity?limit=5000",
      ]);
      expect(requests.find(
        (request) => request.path === `/v1/tasks/${TASK_ID}/stale-lock-handoff`,
      )?.body).toEqual({
        expected_holder: "previous-agent",
        expected_lock_version: "2020-01-01T00:00:00.000Z",
        stale_after_seconds: 3600,
        new_holder: "fixture-agent",
        reason: "remote exact stale lock",
      });
    } finally {
      server.stop(true);
    }
  });

  test("full UUID assignment parity keeps unassign on the hosted authority", async () => {
    const TASK_ID = "66666666-6666-4666-8666-666666666666";
    const MISSING_TASK_ID = "77777777-7777-4777-8777-777777777777";
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const comment = {
      id: "comment-1",
      task_id: TASK_ID,
      agent_id: "fixture-agent",
      session_id: null,
      content: "hosted parity",
      type: "comment",
      progress_pct: null,
      created_at: "2026-08-09T00:00:01.000Z",
    };
    const state = {
      id: TASK_ID,
      short_id: "FIX-UNASSIGN-1",
      project_id: "project-1",
      parent_id: null,
      plan_id: null,
      task_list_id: null,
      title: "Hosted unassign parity",
      description: null,
      status: "pending",
      priority: "medium",
      agent_id: null,
      assigned_to: "fixture-agent",
      session_id: null,
      working_dir: null,
      tags: [],
      metadata: {},
      version: 1,
      locked_by: "fixture-agent",
      locked_at: "2026-08-09T00:00:00.000Z",
      created_at: "2026-08-09T00:00:00.000Z",
      updated_at: "2026-08-09T00:00:00.000Z",
      started_at: null,
      completed_at: null,
      due_at: null,
      estimated_minutes: null,
      actual_minutes: null,
      requires_approval: false,
      approved_by: null,
      approved_at: null,
      recurrence_rule: null,
      recurrence_parent_id: null,
      spawns_template_id: null,
      confidence: null,
      reason: null,
      spawned_from_session: null,
      assigned_by: null,
      created_by: "fixture-agent",
      assigned_from_project: null,
      task_type: null,
      cost_tokens: 0,
      cost_usd: 0,
      delegated_from: null,
      delegation_depth: 0,
      retry_count: 0,
      max_retries: 3,
      retry_after: null,
      sla_minutes: null,
      runner_id: null,
      runner_started_at: null,
      runner_completed_at: null,
      current_step: null,
      total_steps: null,
    };
    let commentWritten = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "GET"
          ? {}
          : await request.json().catch(() => ({})) as Record<string, unknown>;
        requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
        if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
          return Response.json({
            paths: {
              "/v1/tasks/{id}/refs": { get: {} },
            },
          });
        }
        if (url.pathname === "/v1/agents" && request.method === "GET") {
          return Response.json({
            agents: [
              { id: "fixture-agent", name: "fixture-agent" },
              { id: "fixture-assignee", name: "fixture-assignee" },
            ],
            count: 2,
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/refs` && request.method === "GET") {
          return Response.json({ refs: [], count: 0 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/dependencies` && request.method === "GET") {
          return Response.json({ dependencies: [], blocked_by: [] });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "GET") {
          const comments = commentWritten ? [comment] : [];
          return Response.json({
            comments,
            count: comments.length,
            has_more: false,
            next_cursor: null,
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "POST") {
          expect(body).toMatchObject({ content: "hosted parity", agent_id: "fixture-agent" });
          commentWritten = true;
          return Response.json({ comment }, { status: 201 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({ task: state });
        }
        if (url.pathname === `/v1/tasks/${MISSING_TASK_ID}` && request.method === "GET") {
          return Response.json({ error: "task not found" }, { status: 404 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "PATCH") {
          expect(Object.keys(body)).toEqual(["assigned_to"]);
          if (body.assigned_to === "fixture-assignee") {
            state.assigned_to = "fixture-assignee";
          } else if (body.assigned_to === null) {
            state.assigned_to = null;
          } else {
            return Response.json({ error: "unexpected assignment patch" }, { status: 400 });
          }
          state.version += 1;
          state.updated_at = "2026-08-09T00:00:02.000Z";
          return Response.json({ task: state });
        }
        return Response.json({ error: `fixture route missing: ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-unassign-parity-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
      TODOS_AGENT_ID: "fixture-agent",
});
    try {
      const shown = await runCli(executable, ["--json", "show", TASK_ID], env, cwd);
      expect({ exitCode: shown.exitCode, stderr: shown.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(shown.stdout)).toMatchObject({ id: TASK_ID, assigned_to: "fixture-agent" });

      const commented = await runCli(executable, ["--json", "comment", TASK_ID, "hosted parity"], env, cwd);
      expect({ exitCode: commented.exitCode, stderr: commented.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(commented.stdout)).toMatchObject({ task_id: TASK_ID, content: "hosted parity" });

      const assigned = await runCli(executable, ["--json", "assign", TASK_ID, "fixture-assignee", "--assign-seat"], env, cwd);
      expect({ exitCode: assigned.exitCode, stderr: assigned.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(assigned.stdout)).toMatchObject({ id: TASK_ID, assigned_to: "fixture-assignee" });

      const unassigned = await runCli(executable, ["--json", "unassign", TASK_ID], env, cwd);
      expect({ exitCode: unassigned.exitCode, stderr: unassigned.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(unassigned.stdout)).toMatchObject({
        id: TASK_ID,
        assigned_to: null,
        locked_by: "fixture-agent",
      });

      const readback = await runCli(executable, ["--json", "show", TASK_ID], env, cwd);
      expect({ exitCode: readback.exitCode, stderr: readback.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(readback.stdout)).toMatchObject({
        id: TASK_ID,
        assigned_to: null,
        locked_by: "fixture-agent",
      });

      const missing = await runCli(executable, ["--json", "unassign", MISSING_TASK_ID], env, cwd);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain(`Task not found: ${MISSING_TASK_ID}`);
      expect(missing.stdout).toContain(`"error":"Task not found: ${MISSING_TASK_ID}`);

      expect(requests.map((request) => `${request.method} ${request.path}`)).toContain(
        `PATCH /v1/tasks/${TASK_ID}`,
      );
      const unassignPatch = requests.find(
        (request) => request.method === "PATCH" && request.body.assigned_to === null,
      );
      expect(unassignPatch).toEqual({
        method: "PATCH",
        path: `/v1/tasks/${TASK_ID}`,
        body: { assigned_to: null },
      });
      expectNoLocalDatabase(home, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built deps --graph/--direction stay on /v1 and render the same flat edges as base deps", async () => {
    // Regression: a lone `--graph`/`--direction` flag used to flip a working
    // `deps <id>` into REMOTE_COMMAND_UNSUPPORTED at Stage A. The recursive graph
    // is a local-only view, so in remote mode these flags must degrade to the same
    // flat dependency/blocked-by edges instead of failing closed.
    const TASK_ID = "44444444-4444-4444-8444-444444444444";
    const DEP_ID = "55555555-5555-4555-8555-555555555555";
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        if (request.headers.get("authorization") !== "Bearer fixture-remote-key") {
          return Response.json({ error: "fixture auth required" }, { status: 401 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/dependencies` && request.method === "GET") {
          return Response.json({
            dependencies: [{ task_id: TASK_ID, depends_on: DEP_ID }],
            blocked_by: [],
          });
        }
        // The JSON read hydrates edge targets into nodes (id + status), so the
        // dependency task row is served too. The recursive graph and the human
        // views still only need the flat edge endpoint above.
        const taskRow = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
        if (taskRow && request.method === "GET") {
          const id = decodeURIComponent(taskRow[1]!);
          if (id === DEP_ID) {
            return Response.json({ task: { id: DEP_ID, short_id: null, project_id: null, parent_id: null, plan_id: null, title: "Upstream dep", description: null, status: "pending", priority: "medium", tags: [], metadata: {}, version: 1, created_at: "2026-07-10T00:00:00.000Z", updated_at: "2026-07-10T00:00:00.000Z" } });
          }
          return Response.json({ error: "task not found" }, { status: 404 });
        }
        return Response.json({ error: `fixture route missing: ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-deps-graph-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);
    try {
      for (const args of [
        ["--json", "deps", TASK_ID],
        ["--json", "deps", TASK_ID, "--graph"],
        ["--json", "deps", TASK_ID, "--direction", "up"],
        ["deps", TASK_ID, "--graph"],
      ]) {
        const requestCount = requests.length;
        const result = await runCli(executable, args, env, cwd);
        expect({ args, exitCode: result.exitCode, stderr: stderrWithoutAttributionWarning(result.stderr) }).toEqual({ args, exitCode: 0, stderr: "" });
        // Every variant reaches HTTP (no Stage-A rejection, no local fallback)
        // and the edge read is the FIRST call for the flag combination.
        expect(requests[requestCount]).toBe(`GET /v1/tasks/${TASK_ID}/dependencies`);
        if (args.includes("--json")) {
          // The machine-readable read hydrates the flat edges into a versioned,
          // status-bearing shape that matches local mode (never the bare edge rows).
          const payload = JSON.parse(result.stdout);
          expect(payload.schema_version).toBe("todos.task_dependency_edges.v1");
          expect(payload.task_id).toBe(TASK_ID);
          expect(payload.dependencies).toEqual([
            { id: DEP_ID, short_id: null, title: "Upstream dep", status: "pending", priority: "medium", plan_id: null, project_id: null },
          ]);
          // The pending prerequisite blocks this task (regression 4599ef37:
          // blocked_by used to carry the dependents instead).
          expect(payload.blocked_by).toEqual([
            { id: DEP_ID, short_id: null, title: "Upstream dep", status: "pending", priority: "medium", plan_id: null, project_id: null },
          ]);
          expect(payload.blocks).toEqual([]);
        } else {
          expect(result.stdout).toContain(DEP_ID);
        }
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(home, localDbPath);
      }
    } finally {
      server.stop(true);
    }
  }, 45_000);

  test("built remote done and complete alias persist completion through /v1", async () => {
    const TASK_ID = "33333333-3333-4333-8333-333333333333";
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    let advertiseEvidence = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/openapi.json") {
          return Response.json(advertiseEvidence ? {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/complete": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/CompleteTaskInput" } },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                CompleteTaskInput: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    attachment_ids: { type: "array", items: { type: "string" } },
                    files_changed: { type: "array", items: { type: "string" } },
                    test_results: { type: "string" },
                    commit_hash: { type: "string" },
                    notes: { type: "string" },
                    confidence: { type: "number" },
                  },
                },
              },
            },
          } : {
            openapi: "3.1.0",
            paths: { "/v1/tasks/{id}/complete": { post: { responses: {} } } },
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/complete`) {
          return Response.json({ task: { id: TASK_ID, title: "Done", status: "completed", confidence: body.confidence, metadata: { _evidence: body } } });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });
    const root = createBunPackageIsolatedTempDir("todos-done-evidence-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);
    try {
      const unsupported = await runCli(executable, [
        "--agent", "fixture-agent", "--json", "done", TASK_ID, "--notes", "must not be dropped",
      ], env, cwd);
      expect(unsupported.exitCode).toBe(1);
      expect(unsupported.stderr).toContain("REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED");
      expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        "GET /v1/openapi.json",
      ]);

      advertiseEvidence = true;
      requests.length = 0;
      const done = await runCli(executable, [
        "--agent", "fixture-agent", "--json", "done", TASK_ID,
        "--attach-ids", "attachment-one,attachment-two",
        "--files-changed", "src/a.ts,src/b.ts",
        "--test-results", "12 passed",
        "--commit-hash", "abc123",
        "--notes", "verified",
        "--confidence", "0.85",
      ], env, cwd);
      expect({ exitCode: done.exitCode, stderr: done.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ method: "GET", path: "/v1/openapi.json" });
      expect(requests[1]).toEqual({
        method: "POST",
        path: `/v1/tasks/${TASK_ID}/complete`,
        body: {
          agent_id: "fixture-agent",
          attachment_ids: ["attachment-one", "attachment-two"],
          files_changed: ["src/a.ts", "src/b.ts"],
          test_results: "12 passed",
          commit_hash: "abc123",
          notes: "verified",
          confidence: 0.85,
        },
      });
      const complete = await runCli(executable, ["--agent", "fixture-agent", "--json", "complete", TASK_ID], env, cwd);
      expect({ exitCode: complete.exitCode, stderr: complete.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(requests[2]).toEqual({
        method: "POST",
        path: `/v1/tasks/${TASK_ID}/complete`,
        body: { agent_id: "fixture-agent" },
      });
      const invalid = await runCli(executable, ["--json", "done", TASK_ID, "--confidence", "1.5"], env, cwd);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr).toContain("--confidence must be a number between 0.0 and 1.0");
      expect(requests).toHaveLength(3);
      expect(recursiveInventory(cwd)).toEqual(before);
      expectNoLocalDatabase(home, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built add --plan refuses a readable task whose authoritative plan link was dropped", async () => {
    const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
    const PLAN_ID = "22222222-2222-4222-8222-222222222222";
    const TASK_ID = "33333333-3333-4333-8333-333333333333";
    const requests: string[] = [];
    const task = {
      id: TASK_ID,
      short_id: "REMOTE-1",
      title: "Plan-linked task",
      status: "pending",
      priority: "medium",
      project_id: PROJECT_ID,
      task_list_id: null,
      plan_id: null,
      parent_id: null,
      assigned_to: null,
      created_by: "fixture-agent",
      tags: [],
      metadata: {},
      version: 1,
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}${url.search}`);
        if (url.pathname === `/v1/projects/${PROJECT_ID}` && request.method === "GET") {
          return Response.json({
            project: {
              id: PROJECT_ID,
              name: "Dubai Fraud",
              path: "/workspace/dubai-fraud",
            },
          });
        }
        if (url.pathname === "/v1/projects" && request.method === "GET") {
          return Response.json({
            projects: [{
              id: PROJECT_ID,
              name: "Dubai Fraud",
              path: "/workspace/dubai-fraud",
            }],
            count: 1,
          });
        }
        if (url.pathname === "/v1/plans" && request.method === "GET") {
          return Response.json({
            plans: [{
              id: PLAN_ID,
              name: "Dubai linkage",
              project_id: PROJECT_ID,
              status: "active",
            }],
            count: 1,
          });
        }
        if (url.pathname === "/v1/tasks" && request.method === "POST") {
          return Response.json({ task }, { status: 201 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
          return Response.json({ task });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-add-plan-durability-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);

    try {
      const result = await runCli(executable, [
        "--agent", "fixture-agent",
        "--json", "add", "Plan-linked task",
        "--project", PROJECT_ID,
        "--plan", PLAN_ID,
        "--unassigned",
      ], env, cwd);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        error: expect.stringContaining("TASK_CREATE_PERSISTENCE_UNVERIFIED"),
      });
      expect(result.stderr).toContain("TASK_CREATE_PERSISTENCE_UNVERIFIED");
      expect(requests).toContain(`GET /v1/tasks/${TASK_ID}`);
      expect(recursiveInventory(cwd)).toEqual(before);
      expectNoLocalDatabase(home, localDbPath);
    } finally {
      server.stop(true);
    }
  }, 45_000);

  test("built project/list/plan/task lifecycle stays on HTTP with a read-only TODOS_DB_PATH", async () => {
    const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
    const LIST_ID = "22222222-2222-4222-8222-222222222222";
    const PLAN_ID = "33333333-3333-4333-8333-333333333333";
    const TASK_IDS = [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ];
    const now = "2026-07-18T00:00:00.000Z";
    const projects: Array<Record<string, unknown>> = [];
    const taskLists: Array<Record<string, unknown>> = [];
    const plans: Array<Record<string, unknown>> = [];
    const tasks: Array<Record<string, unknown>> = [];
    const requests: string[] = [];
    let nextTaskId = 0;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const route = `${request.method} ${url.pathname}${url.search}`;
        requests.push(route);
        if (request.headers.get("authorization") !== "Bearer fixture-remote-key") {
          return Response.json({ error: "fixture auth required" }, { status: 401 });
        }
        const body = request.method === "GET" || request.method === "HEAD"
          ? {}
          : await request.json().catch(() => ({})) as Record<string, unknown>;
        // Mirror the fixed /v1 server: resolve an exact id, then a unique id
        // prefix, then an exact short_id — all case-insensitive. The CLI no longer
        // pages the whole task set client-side to expand a short reference.
        const find = (items: Array<Record<string, unknown>>, ref: string) => {
          const raw = String(ref).toLowerCase();
          const byId = items.find((item) => String(item.id).toLowerCase() === raw);
          if (byId) return byId;
          const byPrefix = items.filter((item) => String(item.id).toLowerCase().startsWith(raw));
          if (byPrefix.length === 1) return byPrefix[0];
          if (byPrefix.length > 1) return undefined;
          return items.find((item) => String(item.short_id ?? "").toLowerCase() === raw);
        };
        const remove = (items: Array<Record<string, unknown>>, id: string) => {
          const index = items.findIndex((item) => item.id === id);
          if (index < 0) return false;
          items.splice(index, 1);
          return true;
        };

        if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
          return Response.json({
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/refs": { get: {}, post: {} },
              "/v1/refs/{ref}": { get: {} },
            },
          });
        }
        if (url.pathname === "/v1/stats" && request.method === "GET") {
          return Response.json({ tasks: tasks.length, tasks_all: tasks.length, projects: projects.length });
        }
        if (url.pathname === "/v1/projects") {
          if (request.method === "GET") return Response.json({ projects, count: projects.length });
          if (request.method === "POST") {
            const project = { id: PROJECT_ID, name: body.name, path: body.path, description: body.description ?? null, task_list_id: null, created_at: now, updated_at: now };
            projects.push(project);
            return Response.json({ project }, { status: 201 });
          }
        }
        const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
        if (projectMatch) {
          const project = find(projects, projectMatch[1]!);
          if (!project) return Response.json({ error: "project not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ project });
          if (request.method === "PATCH") {
            Object.assign(project, body, { updated_at: now });
            return Response.json({ project });
          }
        }

        if (url.pathname === "/v1/task-lists") {
          if (request.method === "GET") {
            const projectId = url.searchParams.get("project_id");
            const items = projectId ? taskLists.filter((item) => item.project_id === projectId) : taskLists;
            return Response.json({ task_lists: items, count: items.length });
          }
          if (request.method === "POST") {
            const task_list = { id: LIST_ID, name: body.name, slug: body.slug ?? "work", description: body.description ?? null, project_id: body.project_id ?? null, metadata: {}, created_at: now, updated_at: now };
            taskLists.push(task_list);
            return Response.json({ task_list }, { status: 201 });
          }
        }
        const listMatch = url.pathname.match(/^\/v1\/task-lists\/([^/]+)$/);
        if (listMatch) {
          const task_list = find(taskLists, listMatch[1]!);
          if (!task_list) return Response.json({ error: "task list not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ task_list });
          if (request.method === "PATCH") {
            Object.assign(task_list, body, { updated_at: now });
            return Response.json({ task_list });
          }
          if (request.method === "DELETE") {
            remove(taskLists, listMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        if (url.pathname === "/v1/plans") {
          if (request.method === "GET") {
            const projectId = url.searchParams.get("project_id");
            const items = projectId ? plans.filter((item) => item.project_id === projectId) : plans;
            return Response.json({ plans: items, count: items.length });
          }
          if (request.method === "POST") {
            const plan = { id: PLAN_ID, name: body.name, slug: body.slug ?? "delivery", description: body.description ?? null, status: "active", project_id: body.project_id ?? null, task_list_id: null, created_at: now, updated_at: now };
            plans.push(plan);
            return Response.json({ plan }, { status: 201 });
          }
        }
        const planMatch = url.pathname.match(/^\/v1\/plans\/([^/]+)$/);
        if (planMatch) {
          const plan = find(plans, planMatch[1]!);
          if (!plan) return Response.json({ error: "plan not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ plan });
          if (request.method === "PATCH") {
            Object.assign(plan, body, { updated_at: now });
            return Response.json({ plan });
          }
          if (request.method === "DELETE") {
            remove(plans, planMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        if (url.pathname === "/v1/tasks/next/claim" && request.method === "POST") {
          const task = tasks.find((item) => item.status === "pending") ?? null;
          if (task) Object.assign(task, { status: "in_progress", assigned_to: body.agent_id, updated_at: now });
          return Response.json({ task });
        }
        if (url.pathname === "/v1/next" && request.method === "GET") {
          const task = tasks.find((item) => item.status === "pending") ?? null;
          return Response.json({ task });
        }
        if (url.pathname === "/v1/tasks/upsert" && request.method === "POST") {
          let task = tasks.find((item) => (item.metadata as Record<string, unknown> | undefined)?.fingerprint === body.fingerprint);
          const created = !task;
          if (!task) {
            const id = TASK_IDS[nextTaskId++]!;
            task = { id, short_id: `REMOTE-${nextTaskId}`, title: body.title, description: body.description ?? null, status: body.status ?? "pending", priority: body.priority ?? "medium", project_id: body.project_id ?? null, task_list_id: body.task_list_id ?? null, plan_id: body.plan_id ?? null, parent_id: null, assigned_to: body.assigned_to ?? null, tags: body.tags ?? [], metadata: { ...(body.metadata as object ?? {}), fingerprint: body.fingerprint }, version: 1, created_at: now, updated_at: now };
            tasks.push(task);
          } else {
            Object.assign(task, body, { updated_at: now, version: Number(task.version) + 1 });
          }
          return Response.json({ task, created }, { status: created ? 201 : 200 });
        }
        if (url.pathname === "/v1/tasks") {
          if (request.method === "GET") {
            let items = [...tasks];
            for (const key of ["status", "project_id", "task_list_id", "plan_id"] as const) {
              const value = url.searchParams.get(key);
              if (value) items = items.filter((item) => value.split(",").includes(String(item[key])));
            }
            const total = items.length;
            const limit = Number(url.searchParams.get("limit") ?? items.length);
            items = items.slice(0, Number.isFinite(limit) ? limit : items.length);
            return Response.json({ tasks: items, count: items.length, total });
          }
          if (request.method === "POST") {
            const id = TASK_IDS[nextTaskId++]!;
            const task = { id, short_id: `REMOTE-${nextTaskId}`, title: body.title, description: body.description ?? null, status: body.status ?? "pending", priority: body.priority ?? "medium", project_id: body.project_id ?? null, task_list_id: body.task_list_id ?? null, plan_id: body.plan_id ?? null, parent_id: body.parent_id ?? null, assigned_to: body.assigned_to ?? null, tags: body.tags ?? [], metadata: {}, version: 1, created_at: now, updated_at: now };
            tasks.push(task);
            return Response.json({ task }, { status: 201 });
          }
        }
        const commentMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/comments$/);
        if (commentMatch && request.method === "POST") {
          if (!find(tasks, commentMatch[1]!)) return Response.json({ error: "task not found" }, { status: 404 });
          return Response.json({
            comment: {
              id: "comment-1",
              task_id: commentMatch[1],
              content: body.content,
              agent_id: body.agent_id ?? null,
              session_id: body.session_id ?? null,
              type: body.type ?? "comment",
              progress_pct: body.progress_pct ?? null,
              created_at: now,
            },
          }, { status: 201 });
        }
        if (commentMatch && request.method === "GET") {
          return Response.json({ comments: [], count: 0, has_more: false, next_cursor: null });
        }
        const refMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/refs$/);
        if (refMatch && request.method === "GET") {
          if (!find(tasks, refMatch[1]!)) return Response.json({ error: "task not found" }, { status: 404 });
          return Response.json({ refs: [], count: 0 });
        }
        const actionMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/(start|complete)$/);
        if (actionMatch && request.method === "POST") {
          const task = find(tasks, actionMatch[1]!);
          if (!task) return Response.json({ error: "task not found" }, { status: 404 });
          Object.assign(task, { status: actionMatch[2] === "start" ? "in_progress" : "completed", updated_at: now, version: Number(task.version) + 1 });
          return Response.json({ task });
        }
        const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
        if (taskMatch) {
          const task = find(tasks, taskMatch[1]!);
          if (!task) return Response.json({ error: "task not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ task });
          if (request.method === "PATCH") {
            Object.assign(task, body, { updated_at: now, version: Number(task.version) + 1 });
            return Response.json({ task });
          }
          if (request.method === "DELETE") {
            remove(tasks, taskMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        // `assign`/`update --assign` validate the assignee against the agent
        // roster before writing (todos 056f3597), so the remote path now reads
        // this route. Serving it keeps the NON-degraded validation path under
        // test: the guard falls back to an empty roster when the fetch fails,
        // so a fixture that 404'd here would silently exercise only the
        // degraded branch and prove nothing about the real one.
        if (url.pathname === "/v1/agents" && request.method === "GET") {
          return Response.json({
            agents: [{ id: "fixture-agent", name: "fixture-agent" }],
            count: 1,
          });
        }

        return Response.json({ error: `fixture route not present: ${route}` }, { status: 404 });
      },
    });

    const root = createBunPackageIsolatedTempDir("todos-remote-lifecycle-");
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    mkdirSync(cwd);
    const readOnlyParent = join(root, "read-only-db-parent");
    mkdirSync(readOnlyParent);
    chmodSync(readOnlyParent, 0o555);
    const localDbPath = join(readOnlyParent, "todos.db");
    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
});
    const before = recursiveInventory(cwd);

    try {
      const invocations: string[][] = [
        ["--json", "projects", "--add", "/workspace/remote", "--name", "Remote"],
        ["--json", "projects"],
        ["--json", "projects", "--show", PROJECT_ID],
        ["--json", "projects", "--update", PROJECT_ID, "--description", "updated"],
        ["--project", PROJECT_ID, "--json", "lists", "--add", "Work", "--slug", "work"],
        ["--project", PROJECT_ID, "--json", "lists"],
        ["--project", PROJECT_ID, "--json", "lists", "--show", LIST_ID],
        ["--project", PROJECT_ID, "--json", "lists", "--update", LIST_ID, "--description", "updated"],
        ["--project", PROJECT_ID, "--json", "plans", "--add", "Delivery", "--slug", "delivery"],
        ["--project", PROJECT_ID, "--json", "plans"],
        ["--project", PROJECT_ID, "--json", "plans", "--show", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "plans", "--complete", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "status"],
        ["--json", "health"],
        // `doctor` is asserted separately below: it is the one read-only command
        // whose exit code is a VERDICT, not just "the call succeeded".
        ["--json", "add", "Remote task", "--project", PROJECT_ID, "--list", LIST_ID, "--plan", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "list", "--list", LIST_ID],
        ["--json", "show", "REMOTE-1"],
        ["--json", "inspect", "REMOTE-1"],
        ["--json", "update", "REMOTE-1", "--title", "Moved task", "--list", LIST_ID, "--plan", PLAN_ID],
        ["--json", "assign", "REMOTE-1", "fixture-agent"],
        ["--json", "tag", "REMOTE-1", "urgent"],
        ["--json", "untag", "REMOTE-1", "urgent"],
        ["--json", "comment", "REMOTE-1", "remote comment"],
        // `--agent` is required on a claim verb (todos cf995f20): `start` used to
        // fall back to the literal "cli", which every unidentified session on a
        // station shared as a lock holder. This case asserts that the BUILT CLI
        // keeps the whole lifecycle on HTTP, not anything about identity, so it
        // simply supplies one. `done` also releases the named live lock, so it
        // must carry the same process-bound holder identity.
        ["--agent", "fixture-agent", "--json", "start", "REMOTE-1"],
        ["--agent", "fixture-agent", "--json", "done", "REMOTE-1"],
        ["--project", PROJECT_ID, "--json", "next"],
        ["--json", "claim", "fixture-worker"],
      ];
      const teardownInvocations: string[][] = [
        ["--json", "delete", "REMOTE-1"],
        ["--json", "remove", "REMOTE-2"],
        ["--project", PROJECT_ID, "--json", "plans", "--delete", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "lists", "--delete", LIST_ID],
      ];

      const runRemoteOk = async (invocation: string[]): Promise<string> => {
        const result = await runCli(executable, invocation, env, cwd);
        expect({ invocation, exitCode: result.exitCode, stderr: stderrWithoutAttributionWarning(result.stderr) }).toEqual({
          invocation,
          exitCode: 0,
          stderr: "",
        });
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(root, localDbPath);
        return result.stdout;
      };

      for (const invocation of invocations) {
        await runRemoteOk(invocation);
      }

      // health/doctor JSON label the transport with the canonical token: the
      // retired "remote-http" mode vocabulary is gone from user-visible output
      // (k_ms5wv466_u0jidq). The `mode` key stays, so existing field readers
      // keep working; only the value changed.
      const healthReport = JSON.parse(await runRemoteOk(["--json", "health"])) as {
        ok: boolean;
        mode: string;
        checks: unknown[];
      };
      expect(healthReport).toMatchObject({ ok: true, mode: "http" });

      const upserted = JSON.parse(await runRemoteOk([
        "--json", "task", "upsert",
        "--fingerprint", "incident-593127",
        "--title", "Upserted task",
        "--project", PROJECT_ID,
        "--list", LIST_ID,
        "--plan", PLAN_ID,
      ]));
      expect(upserted).toMatchObject({
        created: true,
        task: { plan_id: PLAN_ID, project_id: PROJECT_ID, task_list_id: LIST_ID },
      });

      // `doctor` must NOT report a clean bill of health it did not establish.
      // This fixture authority exposes no GET /v1/integrity aggregate, so the four
      // task-level referential conditions cannot be counted: doctor reports them as
      // NOT CHECKED and exits 2 (incomplete). It used to return a hardcoded
      // `ok: true` and exit 0 here, which is how a dataset carrying five figures of
      // orphaned rows passed as healthy.
      const doctorIncomplete = await runCli(executable, ["--json", "doctor"], env, cwd);
      expect({ exitCode: doctorIncomplete.exitCode, stderr: doctorIncomplete.stderr }).toEqual({ exitCode: 2, stderr: "" });
      const doctorReport = JSON.parse(doctorIncomplete.stdout) as {
        ok: boolean;
        mode: string;
        exit_code: number;
        integrity: { summary: { ok: boolean; findings: number; unverified: number; complete: boolean } };
      };
      expect(doctorReport).toMatchObject({ ok: false, mode: "http", exit_code: 2 });
      expect(doctorReport.integrity.summary).toMatchObject({ ok: false, findings: 0, unverified: 4, complete: false });
      expectNoLocalDatabase(root, localDbPath);

      // `bulk plan|move-plan` must reassign plans through the shared dataset:
      // the plan ref is resolved remotely (no local sqlite) and each task is
      // PATCHed, so a bulk move round-trips and an unknown plan fails closed.
      const bulkTaskId = JSON.parse(
        await runRemoteOk(["--json", "add", "Bulk plan task", "--project", PROJECT_ID, "--list", LIST_ID]),
      ).id as string;
      expect(JSON.parse(await runRemoteOk(["--json", "bulk", "plan", bulkTaskId, "--plan", PLAN_ID])))
        .toMatchObject({ succeeded: 1, failed: 0 });
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBe(PLAN_ID);
      expect(JSON.parse(await runRemoteOk(["--json", "bulk", "move-plan", bulkTaskId, "--clear-plan"])))
        .toMatchObject({ succeeded: 1, failed: 0 });
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBeNull();
      // A non-UUID plan ref resolves remotely too, scoped by `--project` the
      // same way `add --plan` scopes it.
      expect(JSON.parse(await runRemoteOk(
        ["--project", PROJECT_ID, "--json", "bulk", "plan", bulkTaskId, "--plan", "delivery"],
      ))).toMatchObject({ succeeded: 1, failed: 0 });
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBe(PLAN_ID);

      const unknownPlan = await runCli(
        executable,
        ["--json", "bulk", "plan", bulkTaskId, "--plan", "plan-that-does-not-exist"],
        env,
        cwd,
      );
      expect(unknownPlan.exitCode).toBe(1);
      expect(unknownPlan.stderr).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
      expect(unknownPlan.stderr).toContain("plan-that-does-not-exist");
      // Fail closed: an unresolvable plan must not have moved (or detached) the task.
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBe(PLAN_ID);
      expectNoLocalDatabase(root, localDbPath);
      await runRemoteOk(["--json", "delete", bulkTaskId]);

      for (const invocation of teardownInvocations) {
        await runRemoteOk(invocation);
      }

      expect(requests.some((request) => request.startsWith("GET /v1/projects"))).toBe(true);
      expect(requests.some((request) => request.startsWith("GET /v1/task-lists?project_id="))).toBe(true);
      expect(requests.some((request) => request.startsWith("GET /v1/plans?project_id="))).toBe(true);
      expect(requests.some((request) => request.startsWith("POST /v1/tasks/upsert"))).toBe(true);
      expect(requests.some((request) => request.startsWith("POST /v1/tasks/next/claim"))).toBe(true);
      expectNoLocalDatabase(root, localDbPath);

      // Retired storage-mode variables are inert: the CLI keeps routing on the
      // API pair and never reads them.
      const inertMode = await runCli(executable, ["--json", "projects"], {
        ...env,
        HASNA_TODOS_STORAGE_MODE: "remote",
      }, cwd);
      expect(inertMode.exitCode).toBe(0);
      expectNoLocalDatabase(root, localDbPath);

      const blankLegacyMode = await runCli(executable, ["--json", "projects"], {
        ...env,
        TODOS_STORAGE_MODE: "",
      }, cwd);
      expect(blankLegacyMode.exitCode).toBe(0);
      expectNoLocalDatabase(root, localDbPath);

      for (const unsupported of [
        ["--json", "doctor", "--apply"],
        ["--project", PROJECT_ID, "--json", "plans", "--artifact", PLAN_ID],
        [`--project=${PROJECT_ID}`, "--json", "plans", `--artifact=${PLAN_ID}`],
        ["--project", PROJECT_ID, "--json", "claim", "fixture-worker"],
        [`--project=${PROJECT_ID}`, "--json", "claim", "fixture-worker"],
      ]) {
        const requestCount = requests.length;
        const result = await runCli(executable, unsupported, env, cwd);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
        expect(requests).toHaveLength(requestCount);
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(root, localDbPath);
      }
    } finally {
      chmodSync(readOnlyParent, 0o755);
      server.stop(true);
    }
  }, 300_000);
});
