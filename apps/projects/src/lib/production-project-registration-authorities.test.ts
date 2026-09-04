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
  type ProjectRegistrationAuthorityPathRepairReceipt,
  type ProjectRegistrationAuthorityReceipt,
  type ProjectRegistrationAuthorityRecord,
  type ProjectRegistrationAuthorityRequest,
  type ProjectRegistrationGuardedProjectReceiptLookupRequest,
  type ProjectRegistrationGuardedProjectReceiptLookupResult,
  type ProjectRegistrationGuardedProjectRollbackRequest,
  type ProjectRegistrationGuardedProjectUpdateRequest,
  type ProjectRegistrationGuardedProjectUpdateResult,
  type ProjectRegistrationResourceKind,
} from "./project-registration.js";
import { productionProjectRegistrationAuthorities } from "./production-project-registration-authorities.js";
import type { ProjectStore } from "../store/project-store.js";

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
  readonly priorRegistrationAdoptionValidations: Array<{
    request: ProjectRegistrationAuthorityRequest;
    receipt: ProjectRegistrationAuthorityReceipt;
    current_record: ProjectRegistrationAuthorityRecord;
  }> = [];
  priorRegistrationAdoptionValidation = false;
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

  async validatePriorRegistrationAdoption(
    request: ProjectRegistrationAuthorityRequest,
    receipt: ProjectRegistrationAuthorityReceipt,
    currentRecord: ProjectRegistrationAuthorityRecord,
  ): Promise<boolean> {
    this.priorRegistrationAdoptionValidations.push({
      request,
      receipt,
      current_record: currentRecord,
    });
    return this.priorRegistrationAdoptionValidation;
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
    worklog_markdown: "# Worklog\n\n- Exercise every shipped registration authority.\n",
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

  test("routes pre-bound channel adoption through the shipped Conversations SDK method", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-prebound-sdk-"));
    const calls: Record<string, unknown>[] = [];
    const channelId = "chn_1012ddb87c8f033cb40fdead018cdfc8";
    const projectId = "wks_preboundchannel0001";
    const zeroDigest = "0".repeat(64);
    class ConversationsClientFixture {
      async adoptExistingProjectChannel(body: Record<string, unknown>) {
        calls.push(body);
        return {
          receipt_id: "receipt_prebound_sdk",
          authority: "conversations",
          route: "/v1/project-registration/channels",
          package_version: "fixture-1.0.0",
          authority_id: "conversations-fixture",
          tenant_id: "tenant-fixture",
          corpus_id: "conversations-corpus",
          operation_id: "op-authority-prebound-sdk",
          step_id: "conversations_channel",
          resource_kind: "channel",
          direction: "forward",
          idempotency_key: "op-authority-prebound-sdk:forward",
          request_digest: digest("request"),
          precondition_digest: digest("precondition"),
          outcome: "accepted",
          reason: "adopted_preexisting",
          target_id: channelId,
          result_revision: "rev_prebound_channel_001",
          result_digest: zeroDigest,
          duplicate_of_receipt_id: null,
          accepted_receipt_id: null,
          created_by_operation: false,
          prior_state: {
            adoption: true,
            target_id: channelId,
            project_id: projectId,
            revision: "rev_prebound_channel_001",
            digest: zeroDigest,
            message_ownership: ownership,
          },
          created_at: "2026-08-19T00:00:00.000Z",
        };
      }
      async registerProjectChannel() {
        throw new Error("create route must not receive pre-bound adoption");
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
    const ownership = {
      message_count: 0,
      first_message_id: null,
      last_message_id: null,
      message_ids_digest: zeroDigest,
      message_project_digest: zeroDigest,
      digest: zeroDigest,
      preserved_digest: zeroDigest,
    };
    const request: ProjectRegistrationAuthorityRequest = {
      operation_intent: "adopt_existing",
      operation_id: "op-authority-prebound-sdk",
      step_id: "conversations_channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: "/v1/project-registration/channels",
      package_version: "fixture-1.0.0",
      authority_id: "conversations-fixture",
      tenant_id: "tenant-fixture",
      corpus_id: "conversations-corpus",
      target_selector: "fleet-resources",
      idempotency_key: "op-authority-prebound-sdk:forward",
      request_digest: digest("request"),
      precondition_digest: digest("precondition"),
      project_id: projectId,
      project_slug: "fleet-resources",
      project_name: "Fleet Resources",
      desired: {
        channel: "fleet-resources",
        project_id: projectId,
        project_slug: "fleet-resources",
        project_kind: "work",
        registration_mode: "adopt_existing",
        target_id: channelId,
        expected_project_id: projectId,
        expected_revision: "rev_prebound_channel_001",
        expected_digest: zeroDigest,
        expected_message_ownership: ownership,
      },
      adopt_existing: {
        target_id: channelId,
        expected_project_id: projectId,
        expected_revision: "rev_prebound_channel_001",
        expected_digest: zeroDigest,
        expected_message_ownership: ownership,
      },
      target: ProjectRegistrationPathHandle.fromPath(join(root, "project")),
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    try {
      await expect(authority.create(request)).resolves.toMatchObject({
        outcome: "accepted",
        reason: "adopted_preexisting",
        target_id: channelId,
        created_by_operation: false,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        operation_intent: "adopt_existing",
        adopt_existing: request.adopt_existing,
        target_digest: request.target.digest,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    expect(authorities.todos.transport).toBe("api");
    expect(authorities.mementos.transport).toBe("api");
    expect(authorities.conversations.transport).toBe("api");
  });

  test("keeps the gateway path prefix on the authority base URL (#1601)", async () => {
    const fakes = memorySet();
    const options: Record<string, Record<string, unknown>> = {};
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
        // The station wrappers configure the gateway form without /v1; the
        // /v1 form must resolve to the same root, not to /v1/v1.
        HASNA_TODOS_API_URL: "https://api.hasna.com/todos",
        HASNA_TODOS_API_KEY: "fixture-auth",
        HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos/v1",
        HASNA_MEMENTOS_API_KEY: "fixture-auth",
        HASNA_CONVERSATIONS_API_URL: "https://api.hasna.com/conversations/",
        HASNA_CONVERSATIONS_API_KEY: "fixture-auth",
      },
      fetch: (() => Promise.reject(new Error(
        "fixture fetch must stay behind shipped clients",
      ))) as unknown as typeof fetch,
      importModule: async (specifier) => {
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
    // The path prefix survives: url.origin here was the #1601 defect.
    expect(options.todos?.baseUrl).toBe("https://api.hasna.com/todos");
    expect(options.mementos?.baseUrl).toBe("https://api.hasna.com/mementos");
    expect(options.conversations?.baseUrl).toBe("https://api.hasna.com/conversations");
  });

  test("still rejects an authority base URL carrying credential material (#1601)", async () => {
    for (const raw of [
      "https://user:pass@api.hasna.com/todos",
      "https://api.hasna.com/todos?token=abc",
      "https://api.hasna.com/todos#frag",
      "ftp://api.hasna.com/todos",
      "not a url",
    ]) {
      const authorities = productionProjectRegistrationAuthorities({
        env: { HASNA_TODOS_API_URL: raw, HASNA_TODOS_API_KEY: "fixture-auth" },
        fetch: (() => Promise.reject(new Error("unused"))) as unknown as typeof fetch,
        importModule: async () => ({}),
      });
      // Resolution is lazy, so the refusal surfaces on first use.
      await expect(authorities.todos.capability()).rejects.toThrow(/HASNA_TODOS_API_URL/);
    }
  });


  test("forwards the package-owned guarded update, exact receipt lookup, and rollback methods", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-guarded-forwarding-"));
    const fakes = memorySet();
    const requestedPath = join(root, "requested");
    const forwardRequest: ProjectRegistrationGuardedProjectUpdateRequest = {
      authority: "mementos",
      authority_route: "mementos.project-guarded-update.v1",
      package_version: "fixture-1.0.0",
      operation_id: "op-guarded-forwarding",
      step_id: "mementos_project_path_repair",
      authority_id: "mementos-fixture",
      tenant_id: "tenant-fixture",
      corpus_id: "mementos-corpus",
      idempotency_key: "forward-idempotency",
      expected_revision: "revision-before",
      updates: { path: ProjectRegistrationPathHandle.fromPath(requestedPath) },
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    const lookupRequest: ProjectRegistrationGuardedProjectReceiptLookupRequest = {
      authority: "mementos",
      authority_route: forwardRequest.authority_route,
      package_version: forwardRequest.package_version,
      authority_id: forwardRequest.authority_id,
      tenant_id: forwardRequest.tenant_id,
      corpus_id: forwardRequest.corpus_id,
      response_byte_limit: forwardRequest.response_byte_limit,
      time_budget_ms: forwardRequest.time_budget_ms,
    };
    const rollbackIdempotencyKey = "rollback-idempotency";
    const receipt = (
      direction: "forward" | "rollback",
      id: string,
      acceptedReceiptId: string | null,
    ): ProjectRegistrationAuthorityPathRepairReceipt => ({
      receipt_id: id,
      authority: "mementos",
      route: "mementos.project-guarded-update.v1",
      package_version: "fixture-1.0.0",
      authority_id: forwardRequest.authority_id,
      tenant_id: forwardRequest.tenant_id,
      corpus_id: forwardRequest.corpus_id,
      operation_id: forwardRequest.operation_id,
      step_id: forwardRequest.step_id,
      direction,
      idempotency_key: direction === "forward"
        ? forwardRequest.idempotency_key
        : rollbackIdempotencyKey,
      request_digest: digest(`${direction}:request`),
      outcome: "accepted",
      target_id: "mm_project_guarded",
      expected_revision: direction === "forward" ? "revision-before" : "revision-after",
      result_revision: direction === "forward" ? "revision-after" : "revision-restored",
      result_digest: digest(`${direction}:result`),
      accepted_receipt_id: acceptedReceiptId,
      created_at: "2026-08-10T00:00:00.000Z",
    });
    const forwardReceipt = receipt("forward", "receipt-forward", null);
    const rollbackReceipt = receipt("rollback", "receipt-rollback", forwardReceipt.receipt_id);
    const rollbackRequest: ProjectRegistrationGuardedProjectRollbackRequest = {
      authority: "mementos",
      authority_route: forwardRequest.authority_route,
      package_version: forwardRequest.package_version,
      operation_id: forwardRequest.operation_id,
      step_id: forwardRequest.step_id,
      authority_id: forwardRequest.authority_id,
      tenant_id: forwardRequest.tenant_id,
      corpus_id: forwardRequest.corpus_id,
      idempotency_key: rollbackIdempotencyKey,
      expected_revision: "revision-after",
      accepted_receipt: forwardReceipt,
      response_byte_limit: forwardRequest.response_byte_limit,
      time_budget_ms: forwardRequest.time_budget_ms,
    };
    const responseControl = {
      response_byte_limit: forwardRequest.response_byte_limit,
      time_budget_ms: forwardRequest.time_budget_ms,
      response_bytes: 512,
      elapsed_ms: 1,
      complete: true as const,
      truncated: false as const,
    };
    const forwardResult: ProjectRegistrationGuardedProjectUpdateResult = {
      dry_run: false,
      applied: true,
      record: {
        target_id: forwardReceipt.target_id,
        revision: forwardReceipt.result_revision,
        digest: forwardReceipt.result_digest,
      },
      receipt: forwardReceipt,
      response_control: responseControl,
    };
    const rollbackResult: ProjectRegistrationGuardedProjectUpdateResult = {
      ...forwardResult,
      record: {
        target_id: rollbackReceipt.target_id,
        revision: rollbackReceipt.result_revision,
        digest: rollbackReceipt.result_digest,
      },
      receipt: rollbackReceipt,
    };
    const forwardLookup: ProjectRegistrationGuardedProjectReceiptLookupResult = {
      receipt: forwardReceipt,
      response_control: responseControl,
    };
    const rollbackLookup: ProjectRegistrationGuardedProjectReceiptLookupResult = {
      receipt: rollbackReceipt,
      response_control: responseControl,
    };
    const calls: unknown[][] = [];
    Object.assign(fakes.mementos, {
      guardedUpdateProject: async (...args: unknown[]) => {
        calls.push(["forward", ...args]);
        return forwardResult;
      },
      getGuardedProjectUpdateReceipt: async (...args: unknown[]) => {
        calls.push(["lookup", ...args]);
        return args[1] === rollbackReceipt.receipt_id ? rollbackLookup : forwardLookup;
      },
      rollbackGuardedProjectUpdate: async (...args: unknown[]) => {
        calls.push(["rollback", ...args]);
        return rollbackResult;
      },
    });
    const authority = productionProjectRegistrationAuthorities({
      env: { HASNA_MEMENTOS_DB_PATH: join(root, "mementos.db") },
      importModule: localImporter(fakes),
    }).mementos;
    try {
      expect(await authority.guardedUpdateProject?.(forwardReceipt.target_id, forwardRequest)).toBe(forwardResult);
      expect(await authority.getGuardedProjectUpdateReceipt?.(
        forwardReceipt.target_id,
        forwardReceipt.receipt_id,
        lookupRequest,
      )).toBe(forwardLookup);
      expect(await authority.rollbackGuardedProjectUpdate?.(
        forwardReceipt.target_id,
        rollbackRequest,
      )).toBe(rollbackResult);
      expect(calls).toEqual([
        ["forward", forwardReceipt.target_id, forwardRequest],
        ["lookup", forwardReceipt.target_id, forwardReceipt.receipt_id, lookupRequest],
        ["rollback", forwardReceipt.target_id, rollbackRequest],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("hosted Projects refuses local external authorities before imports or mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-hosted-local-mismatch-"));
    const db = projectDb();
    let imports = 0;
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_DB_PATH: join(root, "todos.db"),
        HASNA_MEMENTOS_API_URL: "https://mementos.example.test/v1",
        HASNA_MEMENTOS_API_KEY: "fixture-auth",
        HASNA_CONVERSATIONS_API_URL: "https://conversations.example.test/v1",
        HASNA_CONVERSATIONS_API_KEY: "fixture-auth",
      },
      importModule: async () => {
        imports += 1;
        throw new Error("authority import must not run for incompatible transports");
      },
    });
    try {
      const result = await registerFullProject(
        registrationInput(root, "op-hosted-projects-local-authorities"),
        {
          db,
          authorities,
          projectStore: { transport: "http" } as unknown as ProjectStore,
        },
      );
      expect(result).toMatchObject({
        ok: false,
        outcome: "no_go",
        failed_step: "authority_preflight",
        reason_code: "authority_transport_mismatch",
      });
      expect(result.dependencies.map((blocker) => blocker.authority)).toEqual(["todos"]);
      expect(imports).toBe(0);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(join(root, "project"))).toBe(false);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local Projects refuses hosted external authorities before imports or mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-local-hosted-mismatch-"));
    const db = projectDb();
    let imports = 0;
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_DB_PATH: join(root, "todos.db"),
        HASNA_MEMENTOS_DB_PATH: join(root, "mementos.db"),
        HASNA_CONVERSATIONS_API_URL: "https://conversations.example.test/v1",
        HASNA_CONVERSATIONS_API_KEY: "fixture-auth",
      },
      importModule: async () => {
        imports += 1;
        throw new Error("authority import must not run for incompatible transports");
      },
    });
    try {
      const result = await registerFullProject(
        registrationInput(root, "op-local-projects-hosted-authorities"),
        { db, authorities },
      );
      expect(result).toMatchObject({
        ok: false,
        outcome: "no_go",
        failed_step: "authority_preflight",
        reason_code: "authority_transport_mismatch",
      });
      expect(result.dependencies.map((blocker) => blocker.authority)).toEqual(["conversations"]);
      expect(imports).toBe(0);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(join(root, "project"))).toBe(false);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("hosted Projects rejects all undeclared production adapters before imports, requests, or mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-hosted-undeclared-"));
    const db = projectDb();
    let imports = 0;
    let requests = 0;
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_API_URL: "https://todos.example.test/v1",
        HASNA_TODOS_API_KEY: "fixture-auth",
        HASNA_MEMENTOS_API_URL: "https://mementos.example.test/v1",
        HASNA_MEMENTOS_API_KEY: "fixture-auth",
        HASNA_CONVERSATIONS_API_URL: "https://conversations.example.test/v1",
        HASNA_CONVERSATIONS_API_KEY: "fixture-auth",
      },
      fetch: (async () => {
        requests += 1;
        throw new Error("authority request must not run without transport provenance");
      }) as unknown as typeof fetch,
      importModule: async () => {
        imports += 1;
        throw new Error("authority import must not run without transport provenance");
      },
    });
    for (const authority of [authorities.todos, authorities.mementos, authorities.conversations]) {
      Object.defineProperty(authority, "transport", { value: undefined });
    }
    try {
      const result = await registerFullProject(
        registrationInput(root, "op-hosted-projects-undeclared-authorities"),
        {
          db,
          authorities,
          projectStore: { transport: "http" } as unknown as ProjectStore,
        },
      );
      expect(result).toMatchObject({
        ok: false,
        outcome: "no_go",
        failed_step: "authority_preflight",
        reason_code: "authority_transport_mismatch",
      });
      expect(result.dependencies.map((blocker) => blocker.authority).sort()).toEqual([
        "conversations",
        "mementos",
        "todos",
      ]);
      expect(imports).toBe(0);
      expect(requests).toBe(0);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(join(root, "project"))).toBe(false);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local Projects rejects all undeclared production adapters before imports, requests, or mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-local-undeclared-"));
    const db = projectDb();
    let imports = 0;
    let requests = 0;
    const databasePaths = {
      todos: join(root, "todos.db"),
      mementos: join(root, "mementos.db"),
      conversations: join(root, "conversations.db"),
    };
    const authorities = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_DB_PATH: databasePaths.todos,
        HASNA_MEMENTOS_DB_PATH: databasePaths.mementos,
        HASNA_CONVERSATIONS_DB_PATH: databasePaths.conversations,
      },
      fetch: (async () => {
        requests += 1;
        throw new Error("authority request must not run without transport provenance");
      }) as unknown as typeof fetch,
      importModule: async () => {
        imports += 1;
        throw new Error("authority import must not run without transport provenance");
      },
    });
    for (const authority of [authorities.todos, authorities.mementos, authorities.conversations]) {
      Object.defineProperty(authority, "transport", { value: undefined });
    }
    try {
      const result = await registerFullProject(
        registrationInput(root, "op-local-projects-undeclared-authorities"),
        { db, authorities },
      );
      expect(result).toMatchObject({
        ok: false,
        outcome: "no_go",
        failed_step: "authority_preflight",
        reason_code: "authority_transport_mismatch",
      });
      expect(result.dependencies.map((blocker) => blocker.authority).sort()).toEqual([
        "conversations",
        "mementos",
        "todos",
      ]);
      expect(imports).toBe(0);
      expect(requests).toBe(0);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(join(root, "project"))).toBe(false);
      expect(existsSync(databasePaths.todos)).toBe(false);
      expect(existsSync(databasePaths.mementos)).toBe(false);
      expect(existsSync(databasePaths.conversations)).toBe(false);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
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
        return { channel };
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
      expect(authorities.todos.transport).toBe("local");
      expect(authorities.mementos.transport).toBe("local");
      expect(authorities.conversations.transport).toBe("local");
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

  test("forwards prior registration adoption validation through the production lazy authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-authority-prior-adoption-"));
    const fakes = memorySet();
    fakes.todos.priorRegistrationAdoptionValidation = true;
    const authority = productionProjectRegistrationAuthorities({
      env: {
        HASNA_TODOS_DB_PATH: join(root, "todos.db"),
      },
      importModule: localImporter(fakes),
    }).todos;
    const request: ProjectRegistrationAuthorityRequest = {
      operation_id: "op-prior-adoption-source",
      step_id: "todos_project",
      resource_kind: "project",
      direction: "forward",
      authority_route: "todos.project-registration.v1",
      package_version: "fixture-1.0.0",
      authority_id: "todos-fixture",
      tenant_id: "tenant-fixture",
      corpus_id: "todos-corpus",
      target_selector: "wks_prioradoption01",
      idempotency_key: "fixture-prior-adoption-key",
      request_digest: digest("prior-adoption-request"),
      precondition_digest: digest("prior-adoption-precondition"),
      project_id: "wks_prioradoption01",
      project_slug: "prior-adoption",
      project_name: "Prior Adoption",
      desired: {
        source_project_id: "wks_prioradoption01",
        source_project_slug: "prior-adoption",
        name: "Prior Adoption",
      },
      target: ProjectRegistrationPathHandle.fromPath(join(root, "project")),
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    const receipt = await fakes.todos.create(request);
    const currentRecord: ProjectRegistrationAuthorityRecord = {
      target_id: receipt.target_id!,
      revision: "revision:current",
      digest: digest("current-record"),
    };
    try {
      expect(
        await authority.validatePriorRegistrationAdoption?.(request, receipt, currentRecord),
      ).toBe(true);
      expect(fakes.todos.priorRegistrationAdoptionValidations).toEqual([{
        request,
        receipt,
        current_record: currentRecord,
      }]);
    } finally {
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
