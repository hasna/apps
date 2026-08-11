import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { getDatabase } from "../../db/database.js";
import {
  createLocalTodosProjectRegistrationAuthority,
  TodosProjectRegistrationError,
  type TodosProjectRegistrationAuthority,
  type TodosProjectRegistrationLookupRequest,
  type TodosProjectRegistrationRequest,
  type TodosProjectRegistrationResourceKind,
  type TodosProjectResourcePage,
  type TodosProjectResourcePageRequest,
} from "../../project-registration/index.js";
import {
  cloudCompensateProjectRegistration,
  cloudCreateProjectRegistration,
  cloudListProjectResources,
  cloudLookupProjectRegistrationReceipt,
  cloudProjectRegistrationCapability,
  cloudReadExactProjectRegistration,
  cloudVerifyInverseProjectRegistration,
  getTodosCloudClient,
} from "../cloud-router.js";
import { handleError, output } from "../helpers.js";

type CloudClient = NonNullable<ReturnType<typeof getTodosCloudClient>>;
const PROJECT_RESOURCE_MAX_RESTARTS = 3;

function globalOptions(program: Command): Record<string, unknown> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, unknown> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function jsonRequested(program: Command, opts: { json?: boolean }): boolean {
  return opts.json === true || globalOptions(program)["json"] === true;
}

function parseJsonFile<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `${label} must be a readable JSON file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseInteger(value: string, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function localAuthority(): TodosProjectRegistrationAuthority {
  return createLocalTodosProjectRegistrationAuthority(getDatabase());
}

function parseLookupRequest(path: string): TodosProjectRegistrationLookupRequest {
  const value = parseJsonFile<unknown>(path, "project-registration lookup");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("project-registration lookup must contain one JSON object");
  }
  return value as TodosProjectRegistrationLookupRequest;
}

async function lookupRegistrationReceipt(
  request: TodosProjectRegistrationLookupRequest,
) {
  const remote = getTodosCloudClient();
  return remote
    ? cloudLookupProjectRegistrationReceipt(remote, request)
    : localAuthority().lookupReceipt(request);
}

async function readResourcePage(
  remote: CloudClient | null,
  authority: TodosProjectRegistrationAuthority | null,
  request: TodosProjectResourcePageRequest,
): Promise<TodosProjectResourcePage> {
  return remote
    ? cloudListProjectResources(remote, request)
    : authority!.listProjectResources(request);
}

function isProjectResourceCollectionChanged(error: unknown): boolean {
  if (
    error instanceof TodosProjectRegistrationError
    && error.code === "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED"
  ) {
    return true;
  }
  if (!error || typeof error !== "object") return false;
  const body = (error as { body?: unknown }).body;
  return Boolean(
    body
    && typeof body === "object"
    && !Array.isArray(body)
    && (body as { code?: unknown }).code === "TODOS_PROJECT_REGISTRATION_COLLECTION_CHANGED",
  );
}

export async function collectAllProjectResources(
  readPage: (request: TodosProjectResourcePageRequest) => Promise<TodosProjectResourcePage>,
  firstRequest: TodosProjectResourcePageRequest,
  maxRestarts = PROJECT_RESOURCE_MAX_RESTARTS,
): Promise<Record<string, unknown>> {
  for (let restarts = 0; ; restarts += 1) {
    const resources: TodosProjectResourcePage["resources"] = [];
    const resourceKeys = new Set<string>();
    const cursors = new Set<string>();
    let request = firstRequest;
    let identity: Pick<
      TodosProjectResourcePage,
      | "authority"
      | "route"
      | "package_version"
      | "authority_id"
      | "tenant_id"
      | "corpus_id"
      | "source_project_id"
      | "todos_project_id"
      | "task_list_id"
      | "include_anchors"
      | "collection_revision"
    > | null = null;
    let pages = 0;
    try {
      for (;;) {
        if (pages >= 10_000) {
          throw new Error("project-resources exceeded the 10000-page safety bound");
        }
        const page = await readPage(request);
        pages += 1;
        const nextIdentity = {
          authority: page.authority,
          route: page.route,
          package_version: page.package_version,
          authority_id: page.authority_id,
          tenant_id: page.tenant_id,
          corpus_id: page.corpus_id,
          source_project_id: page.source_project_id,
          todos_project_id: page.todos_project_id,
          task_list_id: page.task_list_id,
          include_anchors: page.include_anchors,
          collection_revision: page.collection_revision,
        };
        if (identity && JSON.stringify(identity) !== JSON.stringify(nextIdentity)) {
          throw new Error("project-resources authority identity changed during pagination");
        }
        identity ??= nextIdentity;
        for (const resource of page.resources) {
          const key = `${resource.kind}:${resource.target_id}`;
          if (resourceKeys.has(key)) {
            throw new Error(`project-resources producer returned duplicate ${key}`);
          }
          resourceKeys.add(key);
          resources.push(resource);
        }
        if (!page.has_more) {
          return {
            ...identity,
            limit: firstRequest.limit,
            count: resources.length,
            resources,
            pages,
            restarts,
            has_more: false,
            next_cursor: null,
            complete: true,
            truncated: false,
          };
        }
        if (!page.next_cursor || cursors.has(page.next_cursor)) {
          throw new Error("project-resources producer returned a missing or repeated cursor");
        }
        cursors.add(page.next_cursor);
        request = { ...firstRequest, cursor: page.next_cursor };
      }
    } catch (error) {
      if (
        firstRequest.cursor
        || !isProjectResourceCollectionChanged(error)
        || restarts >= maxRestarts
      ) {
        throw error;
      }
    }
  }
}

export function registerProjectRegistrationCommands(program: Command): void {
  const registration = program
    .command("project-registration")
    .description("Use the package-owned Projects to Todos registration authority");

  registration
    .command("capability")
    .description("Show the live registration capability identity")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const remote = getTodosCloudClient();
        const capability = remote
          ? await cloudProjectRegistrationCapability(remote)
          : await localAuthority().capability();
        output({ capability }, jsonRequested(program, opts));
      } catch (error) {
        handleError(error);
      }
    });

  registration
    .command("create")
    .description("Create or deterministically bind an existing project-registration resource")
    .requiredOption("--file <path>", "Registration request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { file: string; json?: boolean }) => {
      try {
        const request = parseJsonFile<TodosProjectRegistrationRequest>(
          opts.file,
          "project-registration request",
        );
        const remote = getTodosCloudClient();
        const receipt = remote
          ? await cloudCreateProjectRegistration(remote, request)
          : await localAuthority().create(request);
        output({ receipt }, jsonRequested(program, opts));
      } catch (error) {
        handleError(error);
      }
    });

  registration
    .command("read-exact <resource-kind> <target-id>")
    .description("Read one registered project or task list by its exact UUID")
    .option("--response-byte-limit <n>", "Maximum response bytes", "65536")
    .option("--time-budget-ms <n>", "Maximum producer time in milliseconds", "5000")
    .option("-j, --json", "Output as JSON")
    .action(async (
      resourceKind: TodosProjectRegistrationResourceKind,
      targetId: string,
      opts: { responseByteLimit: string; timeBudgetMs: string; json?: boolean },
    ) => {
      try {
        const request = {
          resource_kind: resourceKind,
          target_id: targetId,
          target: null,
          response_byte_limit: parseInteger(
            opts.responseByteLimit,
            "--response-byte-limit",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
          time_budget_ms: parseInteger(
            opts.timeBudgetMs,
            "--time-budget-ms",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
        };
        const remote = getTodosCloudClient();
        const record = remote
          ? await cloudReadExactProjectRegistration(remote, request)
          : await localAuthority().readExact(request);
        output({ record }, jsonRequested(program, opts));
      } catch (error) {
        handleError(error);
      }
    });

  registration
    .command("lookup")
    .description("Recover one exact immutable registration receipt")
    .requiredOption("--file <path>", "Receipt lookup request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { file: string; json?: boolean }) => {
      try {
        const request = parseLookupRequest(opts.file);
        const result = await lookupRegistrationReceipt(request);
        output(result, jsonRequested(program, opts));
      } catch (error) {
        handleError(error);
      }
    });

  registration
    .command("receipt-lookup <request-file>")
    .description("Look up one immutable registration receipt by exact stored source identity")
    .option("-j, --json", "Output as JSON")
    .action(async (requestFile: string, opts: { json?: boolean }) => {
      try {
        const result = await lookupRegistrationReceipt(parseLookupRequest(requestFile));
        output(result, jsonRequested(program, opts));
      } catch (error) {
        handleError(error);
      }
    });

  for (const action of ["compensate", "verify-inverse"] as const) {
    registration
      .command(action)
      .description(
        action === "compensate"
          ? "Conditionally remove an unchanged resource owned by an accepted receipt"
          : "Verify the exact accepted resource is absent after compensation",
      )
      .requiredOption("--file <path>", "Inverse registration request JSON file")
      .option("-j, --json", "Output as JSON")
      .action(async (opts: { file: string; json?: boolean }) => {
        try {
          const request = parseJsonFile<TodosProjectRegistrationRequest>(
            opts.file,
            "project-registration inverse request",
          );
          const remote = getTodosCloudClient();
          const result = action === "compensate"
            ? {
              receipt: remote
                ? await cloudCompensateProjectRegistration(remote, request)
                : await localAuthority().compensate(request),
            }
            : {
              verification: remote
                ? await cloudVerifyInverseProjectRegistration(remote, request)
                : await localAuthority().verifyInverse(request),
            };
          output(result, jsonRequested(program, opts));
        } catch (error) {
          handleError(error);
        }
      });
  }

  program
    .command("project-resources <source-project-id>")
    .description("List stable Todos identities bound to one exact Projects workspace id")
    .option("--anchors", "Include plan and task resource anchors")
    .option("--limit <n>", "Producer page size", "100")
    .option("--cursor <cursor>", "Continue from one producer cursor")
    .option("--all", "Page to producer completion with duplicate and cursor-cycle guards")
    .option("-j, --json", "Output as JSON")
    .action(async (
      sourceProjectId: string,
      opts: {
        anchors?: boolean;
        limit: string;
        cursor?: string;
        all?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        const limit = parseInteger(opts.limit, "--limit", 1, 500);
        const remote = getTodosCloudClient();
        const authority = remote ? null : localAuthority();
        const firstRequest: TodosProjectResourcePageRequest = {
          source_project_id: sourceProjectId,
          include_anchors: opts.anchors === true,
          limit,
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
        };
        if (!opts.all) {
          const page = await readResourcePage(remote, authority, firstRequest);
          output({ page }, jsonRequested(program, opts));
          return;
        }

        const collected = await collectAllProjectResources(
          (request) => readResourcePage(remote, authority, request),
          firstRequest,
        );
        output(collected, jsonRequested(program, opts));
      } catch (error) {
        handleError(error);
      }
    });
}
