import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import {
  ProjectRegistrationPathHandle,
  preflightProjectRegistrationAuthorities,
  registerFullProject,
  type FullProjectRegistrationInput,
  type ProjectRegistrationAuthorityAdapter,
  type ProjectRegistrationAuthorityCapability,
  type ProjectRegistrationAuthorityInverseVerification,
  type ProjectRegistrationAuthorityLookupRequest,
  type ProjectRegistrationAuthorityLookupResult,
  type ProjectRegistrationAuthorityName,
  type ProjectRegistrationAuthorityReceipt,
  type ProjectRegistrationAuthorityRecord,
  type ProjectRegistrationAuthorityRequest,
  type ProjectRegistrationResourceKind,
} from "./project-registration.js";
import { productionProjectRegistrationAuthorities } from "./production-project-registration-authorities.js";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function targetId(authority: ProjectRegistrationAuthorityName, request: ProjectRegistrationAuthorityRequest): string {
  const suffix = digest(`${authority}:${request.resource_kind}:${request.target_selector}`).slice(0, 32);
  if (authority === "conversations") return `chn_${suffix}`;
  if (authority === "todos") return request.resource_kind === "project"
    ? `td_project_${suffix}`
    : `td_task_list_${suffix}`;
  return `mm_project_${suffix}`;
}

class MemoryAuthority implements ProjectRegistrationAuthorityAdapter {
  readonly records = new Map<string, ProjectRegistrationAuthorityRecord>();
  readonly receipts = new Map<string, ProjectRegistrationAuthorityReceipt>();
  readonly createRequests: ProjectRegistrationAuthorityRequest[] = [];
  readonly inverseRequests: ProjectRegistrationAuthorityRequest[] = [];
  terminalStep: string | null = null;
  ambiguousStep: string | null = null;
  duplicateForward = false;

  constructor(readonly authority: ProjectRegistrationAuthorityName) {}

  async capability(): Promise<ProjectRegistrationAuthorityCapability> {
    return {
      authority: this.authority,
      route: this.authority === "conversations"
        ? "/v1/project-registration/channels"
        : `${this.authority}.project-registration.v1`,
      package_version: "fixture-1.0.0",
      authority_id: `${this.authority}-fixture`,
      tenant_id: "tenant-fixture",
      corpus_id: `${this.authority}-corpus`,
      supported_resources: this.authority === "todos"
        ? ["project", "task_list"]
        : this.authority === "mementos"
          ? ["project"]
          : ["channel"],
      conditional_create: true,
      immutable_receipts: true,
      exact_terminal_lookup: true,
      exact_readback: true,
      conditional_inverse: true,
      ambiguous_outcome_reconciliation: true,
    };
  }

  private receipt(
    request: ProjectRegistrationAuthorityRequest,
    values: Partial<ProjectRegistrationAuthorityReceipt> = {},
  ): ProjectRegistrationAuthorityReceipt {
    const capability = {
      route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
    };
    const id = targetId(this.authority, request);
    const record = {
      target_id: id,
      revision: `revision:${id}`,
      digest: digest({ id, desired: request.desired }),
    };
    return {
      receipt_id: `receipt_${digest(`${request.idempotency_key}:${values.outcome ?? "accepted"}`).slice(0, 32)}`,
      authority: this.authority,
      ...capability,
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      idempotency_key: request.idempotency_key,
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
      outcome: "accepted",
      reason: null,
      target_id: record.target_id,
      result_revision: record.revision,
      result_digest: record.digest,
      duplicate_of_receipt_id: null,
      accepted_receipt_id: request.accepted_receipt?.receipt_id ?? null,
      created_by_operation: true,
      created_at: "2026-08-09T12:00:00.000Z",
      ...values,
    };
  }

  async create(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    this.createRequests.push(request);
    if (this.terminalStep === request.step_id) {
      const refused = this.receipt(request, {
        outcome: "terminal_nonacceptance",
        reason: "fixture_terminal_nonacceptance",
        target_id: null,
        result_revision: null,
        result_digest: null,
        created_by_operation: false,
      });
      this.receipts.set(request.idempotency_key, refused);
      return refused;
    }
    const record: ProjectRegistrationAuthorityRecord = {
      target_id: targetId(this.authority, request),
      revision: `revision:${targetId(this.authority, request)}`,
      digest: digest({ id: targetId(this.authority, request), desired: request.desired }),
    };
    this.records.set(record.target_id, record);
    const accepted = this.receipt(request, this.duplicateForward
      ? {
          outcome: "duplicate_of_accepted",
          duplicate_of_receipt_id: `accepted_${digest(request.target_selector).slice(0, 24)}`,
          created_by_operation: false,
        }
      : {});
    this.receipts.set(request.idempotency_key, accepted);
    if (this.ambiguousStep === request.step_id) {
      this.ambiguousStep = null;
      throw new Error("fixture transport failed after commit");
    }
    return accepted;
  }

  async readExact(request: {
    resource_kind: ProjectRegistrationResourceKind;
    target_id: string;
    target: ProjectRegistrationAuthorityRequest["target"];
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<ProjectRegistrationAuthorityRecord> {
    const record = this.records.get(request.target_id);
    if (!record) throw new Error("fixture record not found");
    return record;
  }

  async lookupReceipt(
    request: ProjectRegistrationAuthorityLookupRequest,
  ): Promise<ProjectRegistrationAuthorityLookupResult> {
    const receipt = this.receipts.get(request.idempotency_key);
    if (!receipt) throw new Error("fixture receipt not found");
    return {
      receipt,
      response_control: {
        response_byte_limit: request.response_byte_limit,
        time_budget_ms: request.time_budget_ms,
        response_bytes: JSON.stringify(receipt).length,
        elapsed_ms: 1,
        complete: true,
        truncated: false,
      },
    };
  }

  async compensate(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    this.inverseRequests.push(request);
    const target = request.accepted_receipt?.target_id;
    if (!target) throw new Error("fixture accepted target missing");
    this.records.delete(target);
    const resultDigest = digest({ target_id: target, absent: true });
    const inverse = this.receipt(request, {
      accepted_receipt_id: request.accepted_receipt!.receipt_id,
      target_id: target,
      result_revision: `inverse:${target}`,
      result_digest: resultDigest,
    });
    this.receipts.set(request.idempotency_key, inverse);
    return inverse;
  }

  async verifyInverse(
    request: ProjectRegistrationAuthorityRequest,
  ): Promise<ProjectRegistrationAuthorityInverseVerification> {
    const target = request.accepted_receipt?.target_id;
    if (!target || this.records.has(target)) throw new Error("fixture inverse not complete");
    return {
      target_id: target,
      accepted_receipt_id: request.accepted_receipt!.receipt_id,
      absent: true,
      digest: digest({ target_id: target, absent: true }),
    };
  }
}

function memorySet() {
  return {
    todos: new MemoryAuthority("todos"),
    mementos: new MemoryAuthority("mementos"),
    conversations: new MemoryAuthority("conversations"),
  };
}

function localImporter(fakes: ReturnType<typeof memorySet>) {
  return async (specifier: string): Promise<unknown> => {
    if (specifier === "@hasna/todos") {
      return {
        getDatabase: () => ({ fixture: "todos" }),
        createLocalTodosProjectRegistrationAuthority: () => fakes.todos,
      };
    }
    if (specifier === "@hasna/mementos") {
      return {
        getDatabase: () => ({ fixture: "mementos" }),
        createLocalMementosProjectRegistrationAuthority: () => fakes.mementos,
      };
    }
    if (specifier === "@hasna/conversations") {
      return {
        createProjectChannelRegistrationAuthority: () => fakes.conversations,
      };
    }
    throw new Error(`unexpected fixture import: ${specifier}`);
  };
}

function registrationInput(root: string, operationId: string): FullProjectRegistrationInput {
  return {
    operation_id: operationId,
    project: {
      name: "Authority Fixture",
      slug: `authority-${operationId.replace(/[^a-z0-9]+/g, "-")}`,
      kind: "project",
    },
    target: ProjectRegistrationPathHandle.fromPath(join(root, "project")),
    goals_markdown: "# Goals\n\n- Exercise every shipped registration authority.\n",
    response_byte_limit: 512_000,
    time_budget_ms: 10_000,
  };
}

function projectDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

describe("production project registration authorities", () => {
  test("the register-full CLI injects production authorities, not unavailable stubs", () => {
    const source = readFileSync("src/cli/commands/workspaces.ts", "utf8");
    expect(source).toContain("authorities: productionProjectRegistrationAuthorities()");
    expect(source).not.toContain("authorities: unavailableProjectRegistrationAuthorities()");
  });

  test("fails closed before imports when neither an API authority nor an explicit local database is configured", async () => {
    let imported = false;
    const report = await preflightProjectRegistrationAuthorities(
      productionProjectRegistrationAuthorities({
        env: {},
        importModule: async () => {
          imported = true;
          throw new Error("unreachable fixture import");
        },
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.blockers.map((blocker) => blocker.authority).sort()).toEqual([
      "conversations",
      "mementos",
      "todos",
    ]);
    expect(report.blockers.every((blocker) => blocker.missing.includes("capability_probe"))).toBe(true);
    expect(imported).toBe(false);
  });

  test("selects every shipped HTTP client, normalizes /v1 roots, and preflights all authorities", async () => {
    const fakes = memorySet();
    const options: Record<string, Record<string, unknown>> = {};
    const imported: string[] = [];
    class ConversationsClientFixture {
      constructor(input: Record<string, unknown>) {
        options.conversations = input;
      }
      async getProjectChannelRegistrationCapability() {
        return fakes.conversations.capability();
      }
    }
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_API_URL: "https://todos.example.test",
        HASNA_TODOS_API_KEY: "fixture-auth",
        HASNA_MEMENTOS_API_URL: "https://mementos.example.test/v1",
        HASNA_MEMENTOS_API_KEY: "fixture-auth",
        HASNA_CONVERSATIONS_API_URL: "https://conversations.example.test/v1",
        HASNA_CONVERSATIONS_API_KEY: "fixture-auth",
      },
      fetch: (() => Promise.reject(new Error(
        "fixture fetch must stay behind shipped clients",
      ))) as unknown as typeof fetch,
      importModule: async (specifier) => {
        imported.push(specifier);
        if (specifier === "@hasna/todos/project-registration") {
          return {
            createTodosProjectRegistrationHttpClient: (input: Record<string, unknown>) => {
              options.todos = input;
              return fakes.todos;
            },
          };
        }
        if (specifier === "@hasna/mementos/project-registration") {
          return {
            createMementosProjectRegistrationHttpClient: (input: Record<string, unknown>) => {
              options.mementos = input;
              return fakes.mementos;
            },
          };
        }
        if (specifier === "@hasna/conversations/sdk") {
          return { ConversationsClient: ConversationsClientFixture };
        }
        throw new Error(`unexpected fixture import: ${specifier}`);
      },
    });

    const report = await preflightProjectRegistrationAuthorities(authorities);
    expect(report.ok).toBe(true);
    expect(report.capabilities.map((capability) => capability.authority).sort()).toEqual([
      "conversations",
      "mementos",
      "todos",
    ]);
    expect(imported.sort()).toEqual([
      "@hasna/conversations/sdk",
      "@hasna/mementos/project-registration",
      "@hasna/todos/project-registration",
    ]);
    expect(options.todos?.baseUrl).toBe("https://todos.example.test");
    expect(options.mementos?.baseUrl).toBe("https://mementos.example.test");
    expect(options.conversations?.baseUrl).toBe("https://conversations.example.test");
  });

  test("validates hosted Conversations adoption only for the exact channel and an unclaimed or matching project", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-adoption-"));
    const fakes = memorySet();
    let channel: Record<string, unknown> | null = {
      id: "chn_existing",
      name: "authority-adoption",
      project_id: null,
      description: "Preserved project channel",
      metadata: { class: "project" },
    };
    class ConversationsClientFixture {
      async getProjectChannelRegistrationCapability() {
        return fakes.conversations.capability();
      }
      async getChannel() {
        return channel;
      }
    }
    const authority = productionProjectRegistrationAuthorities({
      env: {
        HASNA_CONVERSATIONS_API_URL: "https://conversations.example.test/v1",
        HASNA_CONVERSATIONS_API_KEY: "fixture-auth",
      },
      importModule: async (specifier) => {
        if (specifier === "@hasna/conversations/sdk") {
          return { ConversationsClient: ConversationsClientFixture };
        }
        throw new Error(`unexpected fixture import: ${specifier}`);
      },
    }).conversations;
    const request: ProjectRegistrationAuthorityRequest = {
      operation_id: "op-authority-adoption",
      step_id: "conversations_channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: "/v1/project-registration/channels",
      package_version: "fixture-1.0.0",
      authority_id: "conversations-fixture",
      tenant_id: "tenant-fixture",
      corpus_id: "conversations-corpus",
      target_selector: "authority-adoption",
      idempotency_key: "fixture-idempotency-key",
      request_digest: digest("request"),
      precondition_digest: digest("precondition"),
      project_id: "wks_authorityadoption1",
      project_slug: "authority-adoption",
      project_name: "Authority Adoption",
      desired: {
        channel: "authority-adoption",
        project_id: "wks_authorityadoption1",
      },
      target: ProjectRegistrationPathHandle.fromPath(join(root, "project")),
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    const receipt: ProjectRegistrationAuthorityReceipt = {
      receipt_id: "receipt_existing",
      authority: "conversations",
      route: request.authority_route,
      package_version: request.package_version,
      authority_id: request.authority_id,
      tenant_id: request.tenant_id,
      corpus_id: request.corpus_id,
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      idempotency_key: request.idempotency_key,
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
      outcome: "terminal_nonacceptance",
      reason: "preexisting_conflict",
      target_id: "chn_existing",
      result_revision: digest("revision"),
      result_digest: digest("record"),
      duplicate_of_receipt_id: null,
      accepted_receipt_id: null,
      created_by_operation: false,
      created_at: "2026-08-09T12:00:00.000Z",
    };
    try {
      expect(await authority.validateExistingAdoption?.(request, receipt)).toBe(true);
      channel = { ...channel!, project_id: request.project_id };
      expect(await authority.validateExistingAdoption?.(request, receipt)).toBe(true);
      channel = { ...channel!, project_id: "wks_otherproject00001" };
      expect(await authority.validateExistingAdoption?.(request, receipt)).toBe(false);
      channel = { ...channel!, project_id: null, id: "chn_other" };
      expect(await authority.validateExistingAdoption?.(request, receipt)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("runs every shipped local authority and replays exact external IDs", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-production-"));
    const db = projectDb();
    const fakes = memorySet();
    const input = registrationInput(root, "op-production-success");
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_DB_PATH: join(root, "todos.db"),
        HASNA_MEMENTOS_DB_PATH: join(root, "mementos.db"),
        HASNA_CONVERSATIONS_DB_PATH: join(root, "conversations.db"),
      },
      importModule: localImporter(fakes),
    });
    try {
      const accepted = await registerFullProject(input, { db, authorities });
      expect(accepted.ok).toBe(true);
      expect(accepted.outcome).toBe("accepted");
      expect(accepted.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ authority: "todos", kind: "project" }),
        expect.objectContaining({ authority: "todos", kind: "task_list" }),
        expect.objectContaining({ authority: "mementos", kind: "project" }),
        expect.objectContaining({
          authority: "conversations",
          kind: "channel",
          target_id: expect.stringMatching(/^chn_[0-9a-f]{32}$/),
        }),
      ]));
      expect(existsSync(join(root, "project", "GOALS.md"))).toBe(true);
      expect(existsSync(join(root, "project", ".project.json"))).toBe(true);

      const duplicate = await registerFullProject(input, { db, authorities });
      expect(duplicate.ok).toBe(true);
      expect(duplicate.outcome).toBe("duplicate_of_accepted");
      expect(duplicate.project_id).toBe(accepted.project_id);
      const externalIds = (value: typeof accepted) => value.artifacts
        .filter((artifact) => ["todos", "mementos", "conversations"].includes(artifact.authority))
        .map((artifact) => `${artifact.authority}:${artifact.kind}:${artifact.target_id}`)
        .sort();
      expect(externalIds(duplicate)).toEqual(externalIds(accepted));
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reconciles an ambiguous committed outcome through the exact receipt lookup", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-ambiguous-"));
    const db = projectDb();
    const fakes = memorySet();
    fakes.todos.ambiguousStep = "todos_project";
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_DB_PATH: join(root, "todos.db"),
        HASNA_MEMENTOS_DB_PATH: join(root, "mementos.db"),
        HASNA_CONVERSATIONS_DB_PATH: join(root, "conversations.db"),
      },
      importModule: localImporter(fakes),
    });
    try {
      const result = await registerFullProject(registrationInput(root, "op-production-ambiguous"), {
        db,
        authorities,
      });
      expect(result.ok).toBe(true);
      expect(result.outcome).toBe("accepted");
      expect(fakes.todos.createRequests.filter((request) => request.step_id === "todos_project")).toHaveLength(1);
      expect(result.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ authority: "todos", kind: "project" }),
      ]));
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rolls back only receipt-owned targets and leaves a pre-existing channel untouched", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-rollback-"));
    const db = projectDb();
    const fakes = memorySet();
    fakes.conversations.duplicateForward = true;
    fakes.mementos.terminalStep = "mementos_project";
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_DB_PATH: join(root, "todos.db"),
        HASNA_MEMENTOS_DB_PATH: join(root, "mementos.db"),
        HASNA_CONVERSATIONS_DB_PATH: join(root, "conversations.db"),
      },
      importModule: localImporter(fakes),
    });
    try {
      const result = await registerFullProject(registrationInput(root, "op-production-rollback"), {
        db,
        authorities,
      });
      expect(result.ok).toBe(false);
      expect(result.failed_step).toBe("mementos_project");
      expect(fakes.todos.inverseRequests).toHaveLength(2);
      expect(fakes.conversations.inverseRequests).toHaveLength(0);
      expect(fakes.conversations.records.size).toBe(1);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(existsSync(join(root, "project"))).toBe(false);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
