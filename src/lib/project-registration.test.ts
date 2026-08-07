import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import {
  createWorkspace,
  getWorkspace,
  getWorkspaceBySlug,
} from "../db/workspaces.js";
import { canonicalJson, sha256 } from "./guarded-project-mutation.js";
import {
  PROJECT_REGISTRATION_DEPENDENCY_TASKS,
  PROJECT_REGISTRATION_GOALS_FILENAME,
  ProjectRegistrationPathHandle,
  assertCurrentProjectRegistrationSlug,
  lookupProjectRegistrationReceipt,
  registerFullProject,
  unavailableProjectRegistrationAuthorities,
  type FullProjectRegistrationInput,
  type ProjectRegistrationAuthorities,
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
import { PROJECT_MARKER_FILENAME } from "./workspace-runtime.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function tempTarget(name: string): { root: string; path: string; target: ProjectRegistrationPathHandle } {
  const root = mkdtempSync(join(tmpdir(), "projects-full-registration-"));
  tempRoots.push(root);
  const path = join(root, name);
  return { root, path, target: ProjectRegistrationPathHandle.fromPath(path) };
}

function input(
  operationId: string,
  target: ProjectRegistrationPathHandle,
  overrides: Partial<FullProjectRegistrationInput["project"]> = {},
): FullProjectRegistrationInput {
  return {
    operation_id: operationId,
    project: {
      name: "Fleet Resources",
      slug: "fleet-resources",
      kind: "project",
      metadata: { owner: "quintilian" },
      ...overrides,
    },
    target,
    goals_markdown: "# Goals\n\n- Register every authority safely.\n",
    response_byte_limit: 1_000_000,
    time_budget_ms: 10_000,
  };
}

function authorityPrefix(authority: ProjectRegistrationAuthorityName): string {
  if (authority === "todos") return "td";
  if (authority === "mementos") return "mm";
  return "cv";
}

class FakeAuthority implements ProjectRegistrationAuthorityAdapter {
  readonly records = new Map<string, ProjectRegistrationAuthorityRecord>();
  readonly receiptByKey = new Map<string, ProjectRegistrationAuthorityReceipt>();
  readonly requests: ProjectRegistrationAuthorityRequest[] = [];
  readonly compensated: string[] = [];
  readonly inverseSelectors: string[] = [];
  readonly inverseVerifications: string[] = [];
  readonly inverseRequests: ProjectRegistrationAuthorityRequest[] = [];
  readonly inverseDuplicateSteps = new Set<string>();
  readonly invalidInverseDuplicateSteps = new Set<string>();
  strictInverseDesired = false;
  beforeCreate: ((request: ProjectRegistrationAuthorityRequest) => void | Promise<void>) | null = null;
  packageVersion = "test-1.0.0";

  constructor(
    readonly authority: ProjectRegistrationAuthorityName,
    readonly resources: ProjectRegistrationResourceKind[],
    readonly failSteps: Set<string> = new Set(),
    readonly readbackMismatchKinds: Set<ProjectRegistrationResourceKind> = new Set(),
    readonly disconnectAfterCreateSteps: Set<string> = new Set(),
    readonly failLookupSteps: Set<string> = new Set(),
    readonly driftDirectoryOnFailSteps: Set<string> = new Set(),
  ) {}

  async capability(): Promise<ProjectRegistrationAuthorityCapability> {
    return {
      authority: this.authority,
      route: `${this.authority}.project-registration.v1`,
      package_version: this.packageVersion,
      authority_id: `${this.authority}-authority`,
      tenant_id: "tenant-test",
      corpus_id: `${this.authority}-test-corpus`,
      supported_resources: this.resources,
      conditional_create: true,
      immutable_receipts: true,
      exact_terminal_lookup: true,
      exact_readback: true,
      conditional_inverse: true,
      ambiguous_outcome_reconciliation: true,
    };
  }

  async create(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    this.requests.push(request);
    await this.beforeCreate?.(request);
    const existing = this.receiptByKey.get(request.idempotency_key);
    if (existing) return existing;

    if (this.failSteps.has(request.step_id)) {
      if (this.driftDirectoryOnFailSteps.has(request.step_id)) {
        request.target.withOwnedPath((path) => {
          writeFileSync(join(path, "foreign.txt"), "not created by registration\n");
        });
      }
      const rejected = this.makeReceipt(request, {
        outcome: "terminal_nonacceptance",
        target_id: null,
        result_revision: null,
        result_digest: null,
        reason: "injected_authority_failure",
        created_by_operation: false,
      });
      this.receiptByKey.set(request.idempotency_key, rejected);
      throw new Error("injected authority failure");
    }

    const selector = canonicalJson(request.desired);
    const targetId = `${authorityPrefix(this.authority)}_${request.resource_kind}_${sha256(selector).slice(0, 12)}`;
    if (this.records.has(targetId)) {
      return this.makeReceipt(request, {
        outcome: "terminal_nonacceptance",
        target_id: null,
        result_revision: null,
        result_digest: null,
        reason: "target_exists",
        created_by_operation: false,
      });
    }
    const revision = `rev_${sha256(`${request.operation_id}:${request.step_id}`).slice(0, 12)}`;
    const digest = sha256(canonicalJson({
      target_id: targetId,
      revision,
      desired: request.desired,
    }));
    this.records.set(targetId, { target_id: targetId, revision, digest });
    const receipt = this.makeReceipt(request, {
      outcome: "accepted",
      target_id: targetId,
      result_revision: revision,
      result_digest: digest,
      reason: null,
      created_by_operation: true,
    });
    this.receiptByKey.set(request.idempotency_key, receipt);
    if (this.disconnectAfterCreateSteps.has(request.step_id)) {
      throw new Error("injected disconnect after authority commit");
    }
    return receipt;
  }

  async readExact(request: {
    resource_kind: ProjectRegistrationResourceKind;
    target_id: string;
  }): Promise<ProjectRegistrationAuthorityRecord> {
    const record = this.records.get(request.target_id);
    if (!record) throw new Error("record not found");
    if (this.readbackMismatchKinds.has(request.resource_kind)) {
      return { ...record, digest: sha256(`${record.digest}:injected-mismatch`) };
    }
    return record;
  }

  async lookupReceipt(
    request: ProjectRegistrationAuthorityLookupRequest,
  ): Promise<ProjectRegistrationAuthorityLookupResult> {
    if (request.max_items !== 1) throw new Error("max_items must be one");
    if (
      request.authority !== this.authority
      || request.authority_route !== `${this.authority}.project-registration.v1`
      || request.package_version !== this.packageVersion
      || request.authority_id !== `${this.authority}-authority`
      || request.tenant_id !== "tenant-test"
      || request.corpus_id !== `${this.authority}-test-corpus`
      || !request.target_selector
    ) {
      throw new Error("lookup identity selector mismatch");
    }
    if (this.failLookupSteps.has(request.step_id)) throw new Error("injected terminal lookup failure");
    const receipt = this.receiptByKey.get(request.idempotency_key);
    if (!receipt) throw new Error("receipt not found");
    return {
      receipt,
      response_control: {
        response_byte_limit: request.response_byte_limit,
        time_budget_ms: request.time_budget_ms,
        response_bytes: Buffer.byteLength(JSON.stringify(receipt)),
        elapsed_ms: 0,
        complete: true,
        truncated: false,
      },
    };
  }

  async compensate(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    this.inverseRequests.push(request);
    const accepted = request.accepted_receipt;
    if (!accepted?.target_id || !accepted.result_revision || !accepted.result_digest) {
      throw new Error("accepted receipt required");
    }
    if (request.target_selector !== accepted.target_id) {
      throw new Error("inverse selector must match accepted target");
    }
    const expectedDesired = {
      accepted_receipt_id: accepted.receipt_id,
      target_id: accepted.target_id,
    };
    if (
      this.strictInverseDesired
      && (
        canonicalJson(request.desired) !== canonicalJson(expectedDesired)
        || request.request_digest !== sha256(canonicalJson(expectedDesired))
      )
    ) {
      throw new Error("inverse desired payload must match its request digest");
    }
    this.inverseSelectors.push(request.target_selector);
    const current = this.records.get(accepted.target_id);
    if (
      !current
      || current.revision !== accepted.result_revision
      || current.digest !== accepted.result_digest
    ) {
      throw new Error("drift refuses inverse");
    }
    this.records.delete(accepted.target_id);
    this.compensated.push(accepted.target_id);
    const absenceDigest = sha256(canonicalJson({
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
    }));
    const duplicate = this.inverseDuplicateSteps.has(request.step_id)
      || this.invalidInverseDuplicateSteps.has(request.step_id);
    const acceptedInverseReceipt = this.makeReceipt(request, {
      outcome: "accepted",
      target_id: accepted.target_id,
      result_revision: "absent",
      result_digest: absenceDigest,
      reason: null,
      created_by_operation: false,
      accepted_receipt_id: accepted.receipt_id,
    });
    const receipt = this.makeReceipt(request, {
      outcome: duplicate ? "duplicate_of_accepted" : "accepted",
      target_id: accepted.target_id,
      result_revision: "absent",
      result_digest: absenceDigest,
      reason: null,
      created_by_operation: false,
      accepted_receipt_id: accepted.receipt_id,
      duplicate_of_receipt_id: duplicate && !this.invalidInverseDuplicateSteps.has(request.step_id)
        ? acceptedInverseReceipt.receipt_id
        : null,
    });
    this.receiptByKey.set(request.idempotency_key, receipt);
    return receipt;
  }

  async verifyInverse(
    request: ProjectRegistrationAuthorityRequest,
  ): Promise<ProjectRegistrationAuthorityInverseVerification> {
    const accepted = request.accepted_receipt;
    if (!accepted?.target_id || this.records.has(accepted.target_id)) {
      throw new Error("inverse target still exists");
    }
    const digest = sha256(canonicalJson({
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
    }));
    this.inverseVerifications.push(accepted.target_id);
    return {
      target_id: accepted.target_id,
      accepted_receipt_id: accepted.receipt_id,
      absent: true,
      digest,
    };
  }

  private makeReceipt(
    request: ProjectRegistrationAuthorityRequest,
    result: {
      outcome: ProjectRegistrationAuthorityReceipt["outcome"];
      target_id: string | null;
      result_revision: string | null;
      result_digest: string | null;
      reason: string | null;
      created_by_operation: boolean;
      accepted_receipt_id?: string | null;
      duplicate_of_receipt_id?: string | null;
    },
  ): ProjectRegistrationAuthorityReceipt {
    return {
      receipt_id: `${authorityPrefix(this.authority)}r_${sha256(canonicalJson({
        key: request.idempotency_key,
        direction: request.direction,
        outcome: result.outcome,
      })).slice(0, 20)}`,
      authority: this.authority,
      route: `${this.authority}.project-registration.v1`,
      package_version: this.packageVersion,
      authority_id: `${this.authority}-authority`,
      tenant_id: "tenant-test",
      corpus_id: `${this.authority}-test-corpus`,
      operation_id: request.operation_id,
      step_id: request.step_id,
      resource_kind: request.resource_kind,
      direction: request.direction,
      idempotency_key: request.idempotency_key,
      request_digest: request.request_digest,
      precondition_digest: request.precondition_digest,
      outcome: result.outcome,
      reason: result.reason,
      target_id: result.target_id,
      result_revision: result.result_revision,
      result_digest: result.result_digest,
      duplicate_of_receipt_id: result.duplicate_of_receipt_id ?? null,
      accepted_receipt_id: result.accepted_receipt_id ?? null,
      created_by_operation: result.created_by_operation,
      created_at: "2026-08-07T00:00:00.000Z",
    };
  }
}

function fakeAuthorities(
  failSteps: string[] = [],
  readbackMismatchKinds: Partial<Record<ProjectRegistrationAuthorityName, ProjectRegistrationResourceKind[]>> = {},
  disconnectAfterCreateSteps: string[] = [],
  failLookupSteps: string[] = [],
  driftDirectoryOnFailSteps: string[] = [],
): {
  authorities: ProjectRegistrationAuthorities;
  todos: FakeAuthority;
  mementos: FakeAuthority;
  conversations: FakeAuthority;
} {
  const failures = new Set(failSteps);
  const disconnects = new Set(disconnectAfterCreateSteps);
  const lookupFailures = new Set(failLookupSteps);
  const directoryDriftFailures = new Set(driftDirectoryOnFailSteps);
  const todos = new FakeAuthority(
    "todos",
    ["project", "task_list"],
    failures,
    new Set(readbackMismatchKinds.todos ?? []),
    disconnects,
    lookupFailures,
    directoryDriftFailures,
  );
  const mementos = new FakeAuthority(
    "mementos",
    ["project"],
    failures,
    new Set(readbackMismatchKinds.mementos ?? []),
    disconnects,
    lookupFailures,
    directoryDriftFailures,
  );
  const conversations = new FakeAuthority(
    "conversations",
    ["channel"],
    failures,
    new Set(readbackMismatchKinds.conversations ?? []),
    disconnects,
    lookupFailures,
    directoryDriftFailures,
  );
  return {
    authorities: { todos, mementos, conversations },
    todos,
    mementos,
    conversations,
  };
}

describe("full project registration naming policy", () => {
  test("rejects only retired leading project prefixes", () => {
    expect(() => assertCurrentProjectRegistrationSlug("iproj-legacy")).toThrow(/retired leading/);
    expect(() => assertCurrentProjectRegistrationSlug("internal-iproj-legacy")).toThrow(/retired leading/);

    expect(() => assertCurrentProjectRegistrationSlug("fleet-resources")).not.toThrow();
    expect(() => assertCurrentProjectRegistrationSlug("iapp-dispatch")).not.toThrow();
    expect(() => assertCurrentProjectRegistrationSlug("code-iproj-parser")).not.toThrow();
    expect(() => assertCurrentProjectRegistrationSlug("internal-iapp-console")).not.toThrow();
  });
});

describe("full project registration capability gate", () => {
  test("returns the exact dependency contract before any project or filesystem mutation", async () => {
    const db = makeDb();
    const target = tempTarget("no-go");
    try {
      const result = await registerFullProject(
        input("op-capability-no-go", target.target),
        { db, authorities: unavailableProjectRegistrationAuthorities() },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("no_go");
      expect(result.dependencies.map((item) => item.dependency_task_id).sort()).toEqual(
        Object.values(PROJECT_REGISTRATION_DEPENDENCY_TASKS).sort(),
      );
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
      expect(JSON.stringify(result)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });
});

describe("full project registration transaction", () => {
  test("registers every authority, writes GOALS then the final marker, and returns exact stable IDs", async () => {
    const db = makeDb();
    const target = tempTarget("success");
    const fakes = fakeAuthorities();
    try {
      const result = await registerFullProject(
        input("op-full-success", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.ok).toBe(true);
      expect(result.outcome).toBe("accepted");
      expect(result.response_control.complete).toBe(true);
      expect(result.response_control.truncated).toBe(false);
      const project = getWorkspace(result.project_id, db);
      expect(project?.slug).toBe("fleet-resources");
      expect(project?.integrations.todos_project_id).toMatch(/^td_project_/);
      expect(project?.integrations.todos_task_list_id).toMatch(/^td_task_list_/);
      expect(project?.integrations.mementos_project_id).toMatch(/^mm_project_/);
      expect(project?.integrations.conversations_channel).toBe("fleet-resources");

      const taskListRequest = fakes.todos.requests.find((request) => request.step_id === "todos_task_list");
      expect(taskListRequest?.desired.todos_project_id).toBe(project?.integrations.todos_project_id);

      const goalsPath = join(target.path, PROJECT_REGISTRATION_GOALS_FILENAME);
      const markerPath = join(target.path, PROJECT_MARKER_FILENAME);
      expect(readFileSync(goalsPath, "utf8")).toContain("Register every authority safely");
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
        id: string;
        integrations: Record<string, string>;
      };
      expect(marker.id).toBe(result.project_id);
      expect(marker.integrations.todos_task_list_id).toBe(project!.integrations.todos_task_list_id!);

      const goalsReceipt = result.receipts.find((receipt) => receipt.step_id === "projects_goals");
      const markerReceipt = result.receipts.find((receipt) => receipt.step_id === "projects_marker");
      expect(goalsReceipt?.sequence).toBeLessThan(markerReceipt!.sequence);
      expect(result.receipts.at(-1)?.step_id).toBe("registration_terminal");
      expect(JSON.stringify(result.receipts)).not.toContain(target.path);
      expect(result.artifacts.map((artifact) => artifact.target_id)).toContain(result.project_id);
      expect(result.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "project_directory",
          authority: "projects-files",
          target_id: result.project_id,
        }),
      ]));

      const manifestRow = db.query(
        "SELECT plan_json FROM project_registration_manifests WHERE operation_id = ?",
      ).get(result.operation_id) as { plan_json: string };
      const manifest = JSON.parse(manifestRow.plan_json) as {
        authorities: Array<Record<string, unknown>>;
        steps: Array<Record<string, unknown>>;
      };
      expect(manifest.authorities).toHaveLength(3);
      expect(manifest.authorities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          authority: "todos",
          route: "todos.project-registration.v1",
          package_version: "test-1.0.0",
          authority_id: "todos-authority",
          tenant_id: "tenant-test",
          corpus_id: "todos-test-corpus",
          ambiguous_outcome_reconciliation: true,
        }),
      ]));
      expect(manifest.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "todos_task_list:readback",
          authority: "todos",
          resource_kind: "task_list_readback",
        }),
        expect.objectContaining({
          step_id: "projects_goals",
          depends_on: ["projects_integrations"],
        }),
        expect.objectContaining({
          step_id: "projects_marker",
          depends_on: ["projects_goals"],
        }),
      ]));
      expect(JSON.stringify(manifest)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

  test("retries the same completed operation idempotently without re-running external writes", async () => {
    const db = makeDb();
    const target = tempTarget("retry");
    const fakes = fakeAuthorities();
    try {
      const request = input("op-full-retry", target.target);
      const first = await registerFullProject(request, { db, authorities: fakes.authorities });
      const requestCount = fakes.todos.requests.length + fakes.mementos.requests.length + fakes.conversations.requests.length;
      const second = await registerFullProject(request, { db, authorities: fakes.authorities });

      expect(first.outcome).toBe("accepted");
      expect(second.outcome).toBe("duplicate_of_accepted");
      expect(second.project_id).toBe(first.project_id);
      expect(fakes.todos.requests.length + fakes.mementos.requests.length + fakes.conversations.requests.length)
        .toBe(requestCount);
      const terminal = second.receipts.filter((receipt) => receipt.step_id === "registration_terminal");
      expect(terminal.map((receipt) => receipt.outcome)).toEqual([
        "accepted",
        "duplicate_of_accepted",
      ]);
    } finally {
      db.close();
    }
  });

  test("rejects an idempotent retry when a bound authority identity changes", async () => {
    const db = makeDb();
    const target = tempTarget("authority-identity-conflict");
    const fakes = fakeAuthorities();
    try {
      const request = input("op-authority-identity-conflict", target.target);
      const first = await registerFullProject(request, { db, authorities: fakes.authorities });
      const requestCount = fakes.todos.requests.length + fakes.mementos.requests.length + fakes.conversations.requests.length;
      fakes.todos.packageVersion = "test-2.0.0";
      const second = await registerFullProject(request, { db, authorities: fakes.authorities });

      expect(first.outcome).toBe("accepted");
      expect(second.outcome).toBe("no_go");
      expect(second.failed_step).toBe("registration_manifest");
      expect(second.reason_code).toBe("operation_semantics_conflict");
      expect(fakes.todos.requests.length + fakes.mementos.requests.length + fakes.conversations.requests.length)
        .toBe(requestCount);
      expect(getWorkspace(first.project_id, db)?.slug).toBe("fleet-resources");
    } finally {
      db.close();
    }
  });

  test("does not clobber an existing exact project slug or call external authorities", async () => {
    const db = makeDb();
    const target = tempTarget("local-conflict");
    const existing = createWorkspace({
      name: "Existing Fleet Resources",
      slug: "fleet-resources",
      primary_path: join(target.root, "existing"),
    }, db);
    const fakes = fakeAuthorities();
    try {
      const result = await registerFullProject(
        input("op-full-project-conflict", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("rolled_back");
      expect(getWorkspaceBySlug("fleet-resources", db)?.id).toBe(existing.id);
      expect(getWorkspaceBySlug("fleet-resources", db)?.name).toBe("Existing Fleet Resources");
      expect(fakes.todos.requests).toHaveLength(0);
      expect(fakes.mementos.requests).toHaveLength(0);
      expect(fakes.conversations.requests).toHaveLength(0);
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("refuses a pre-existing directory and compensates only the attempt-created project row", async () => {
    const db = makeDb();
    const target = tempTarget("directory-conflict");
    mkdirSync(target.path);
    writeFileSync(join(target.path, "owner.txt"), "pre-existing\n");
    const fakes = fakeAuthorities();
    try {
      const result = await registerFullProject(
        input("op-full-directory-conflict", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("rolled_back");
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(readFileSync(join(target.path, "owner.txt"), "utf8")).toBe("pre-existing\n");
      expect(fakes.todos.requests).toHaveLength(0);
      expect(result.rollback.find((item) => item.step_id === "projects_project")).toBeUndefined();
      expect(result.receipts.some((receipt) => receipt.step_id === "projects_project")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("records a terminal no-go when project planning rejects a missing root before resource mutation", async () => {
    const db = makeDb();
    const target = tempTarget("planning-rejection");
    const fakes = fakeAuthorities();
    try {
      const result = await registerFullProject(
        input("op-full-planning-rejection", target.target, { root_id: "root_missing" }),
        { db, authorities: fakes.authorities },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("no_go");
      expect(result.failed_step).toBe("projects_project");
      expect(result.reason_code).toBe("creation_plan_rejected");
      expect(result.receipts.at(-1)).toEqual(expect.objectContaining({
        step_id: "registration_terminal",
        outcome: "terminal_nonacceptance",
        reason: "creation_plan_rejected",
      }));
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
      expect(fakes.todos.requests).toHaveLength(0);
      expect(fakes.mementos.requests).toHaveLength(0);
      expect(fakes.conversations.requests).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  test("compensates an authority create after its immutable receipt when exact readback fails", async () => {
    const db = makeDb();
    const target = tempTarget("channel-readback-failure");
    const fakes = fakeAuthorities([], { conversations: ["channel"] });
    try {
      const result = await registerFullProject(
        input("op-full-channel-readback-failure", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("conversations_channel");
      expect(result.reason_code).toBe("authority_exact_readback_mismatch");
      expect(fakes.conversations.records.size).toBe(0);
      expect(fakes.conversations.compensated).toHaveLength(1);
      expect(result.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "conversations_channel",
          direction: "forward",
          outcome: "accepted",
        }),
        expect.objectContaining({
          step_id: "conversations_channel",
          direction: "inverse",
          outcome: "accepted",
        }),
        expect.objectContaining({
          step_id: "conversations_channel:readback",
          direction: "inverse",
          outcome: "accepted",
        }),
      ]));
      expect(result.rollback).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "conversations_channel",
          status: "completed",
          accepted_receipt_id: expect.stringMatching(/^cvr_/),
        }),
      ]));
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("reconciles an accepted authority create after a response disconnect without retrying the mutation", async () => {
    const db = makeDb();
    const target = tempTarget("channel-disconnect");
    const fakes = fakeAuthorities([], {}, ["conversations_channel"]);
    try {
      const result = await registerFullProject(
        input("op-full-channel-disconnect", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("accepted");
      expect(fakes.conversations.requests.filter((request) => request.step_id === "conversations_channel"))
        .toHaveLength(1);
      expect(fakes.conversations.records.size).toBe(1);
      expect(result.receipts.find((receipt) => receipt.step_id === "conversations_channel"))
        .toEqual(expect.objectContaining({ outcome: "accepted" }));
    } finally {
      db.close();
    }
  });

  test("reports split state when an authority mutation terminal outcome cannot be resolved exactly", async () => {
    const db = makeDb();
    const target = tempTarget("channel-ambiguous");
    const fakes = fakeAuthorities([], {}, [], ["conversations_channel"]);
    try {
      const result = await registerFullProject(
        input("op-full-channel-ambiguous", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("split_state");
      expect(result.failed_step).toBe("conversations_channel");
      expect(result.reason_code).toBe("authority_terminal_outcome_unresolved");
      expect(result.rollback).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "conversations_channel",
          status: "failed",
          reason_code: "authority_terminal_outcome_unresolved",
        }),
      ]));
      expect(fakes.conversations.records.size).toBe(1);
      expect(fakes.conversations.compensated).toHaveLength(0);
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("compensates channel and exact Todos project/task-list after an injected Mementos failure", async () => {
    const db = makeDb();
    const target = tempTarget("mementos-failure");
    const fakes = fakeAuthorities(["mementos_project"]);
    try {
      const result = await registerFullProject(
        input("op-full-mementos-failure", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("mementos_project");
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
      expect(fakes.todos.records.size).toBe(0);
      expect(fakes.conversations.records.size).toBe(0);
      expect(fakes.todos.compensated).toHaveLength(2);
      expect(fakes.conversations.compensated).toHaveLength(1);
      expect(fakes.todos.inverseSelectors).toEqual(fakes.todos.compensated);
      expect(fakes.conversations.inverseSelectors).toEqual(fakes.conversations.compensated);
      expect(fakes.todos.inverseVerifications).toHaveLength(2);
      expect(fakes.conversations.inverseVerifications).toHaveLength(1);
      const inverseSteps = result.receipts
        .filter((receipt) => receipt.direction === "inverse")
        .map((receipt) => receipt.step_id);
      expect(inverseSteps).toContain("projects_directory");
      expect(inverseSteps).toContain("projects_project");
      expect(inverseSteps).toContain("todos_task_list");
      expect(inverseSteps).toContain("todos_project");
      expect(inverseSteps).toContain("conversations_channel");
      expect(result.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "mementos_project",
          direction: "forward",
          outcome: "terminal_nonacceptance",
          reason: "injected_authority_failure",
        }),
      ]));
      expect(db.query("SELECT COUNT(*) AS n FROM workspace_events").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  test("compensates an accepted channel write when its local receipt cannot persist", async () => {
    const db = makeDb();
    const target = tempTarget("channel-receipt-failure");
    const fakes = fakeAuthorities();
    db.run(`
      CREATE TRIGGER inject_channel_receipt_failure
      BEFORE INSERT ON project_registration_receipts
      WHEN NEW.step_id = 'conversations_channel' AND NEW.direction = 'forward'
      BEGIN
        SELECT RAISE(ABORT, 'injected channel receipt failure');
      END
    `);
    try {
      const result = await registerFullProject(
        input("op-full-channel-receipt-failure", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("conversations_channel");
      expect(fakes.conversations.records.size).toBe(0);
      expect(fakes.conversations.compensated).toHaveLength(1);
      expect(result.rollback).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "conversations_channel",
          status: "completed",
        }),
      ]));
      expect(result.receipts.some((receipt) =>
        receipt.step_id === "conversations_channel" && receipt.direction === "forward"
      )).toBe(false);
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("binds inverse desired content to its request digest during compensation", async () => {
    const db = makeDb();
    const target = tempTarget("inverse-desired");
    const fakes = fakeAuthorities(["mementos_project"]);
    fakes.conversations.strictInverseDesired = true;
    try {
      const result = await registerFullProject(
        input("op-full-inverse-desired", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("rolled_back");
      const inverse = fakes.conversations.inverseRequests[0]!;
      expect(inverse.desired).toEqual({
        accepted_receipt_id: inverse.accepted_receipt?.receipt_id,
        target_id: inverse.accepted_receipt?.target_id,
      });
      expect(inverse.request_digest).toBe(sha256(canonicalJson(inverse.desired)));
    } finally {
      db.close();
    }
  });

  test("accepts a correctly linked duplicate inverse receipt during rollback retry", async () => {
    const db = makeDb();
    const target = tempTarget("inverse-duplicate");
    const fakes = fakeAuthorities(["mementos_project"]);
    fakes.conversations.inverseDuplicateSteps.add("conversations_channel");
    try {
      const result = await registerFullProject(
        input("op-full-inverse-duplicate", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("rolled_back");
      expect(result.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "conversations_channel",
          direction: "inverse",
          outcome: "duplicate_of_accepted",
          duplicate_of_receipt_id: expect.any(String),
        }),
      ]));
      expect(fakes.conversations.records.size).toBe(0);
    } finally {
      db.close();
    }
  });

  test("rejects an inverse duplicate receipt without its accepted inverse link", async () => {
    const db = makeDb();
    const target = tempTarget("inverse-duplicate-unlinked");
    const fakes = fakeAuthorities(["mementos_project"]);
    fakes.conversations.invalidInverseDuplicateSteps.add("conversations_channel");
    try {
      const result = await registerFullProject(
        input("op-full-inverse-duplicate-unlinked", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("split_state");
      expect(result.rollback).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "conversations_channel",
          status: "failed",
          reason_code: "authority_inverse_failed",
        }),
      ]));
      expect(result.receipts.some((receipt) =>
        receipt.step_id === "conversations_channel"
        && receipt.direction === "inverse"
        && receipt.outcome === "duplicate_of_accepted"
      )).toBe(false);
    } finally {
      db.close();
    }
  });

  test("refuses project cleanup when canonical machine changes during rollback", async () => {
    const db = makeDb();
    const target = tempTarget("project-state-drift");
    const fakes = fakeAuthorities(["mementos_project"]);
    fakes.mementos.beforeCreate = (request) => {
      db.run(
        "UPDATE workspaces SET canonical_machine = ? WHERE id = ?",
        ["spark02", request.project_id],
      );
    };
    try {
      const result = await registerFullProject(
        input("op-full-project-state-drift", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("split_state");
      expect(getWorkspace(result.project_id, db)?.canonical_machine).toBe("spark02");
      expect(result.rollback).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "projects_project",
          status: "failed",
          reason_code: "project_drift_refuses_cleanup",
        }),
      ]));
      expect(existsSync(target.path)).toBe(true);
    } finally {
      db.close();
    }
  });

  test("refuses local cleanup when foreign directory content appears during authority failure", async () => {
    const db = makeDb();
    const target = tempTarget("directory-drift");
    const fakes = fakeAuthorities(
      ["mementos_project"],
      {},
      [],
      [],
      ["mementos_project"],
    );
    try {
      const result = await registerFullProject(
        input("op-full-directory-drift", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("split_state");
      expect(result.failed_step).toBe("mementos_project");
      expect(result.reason_code).toBe("injected_authority_failure");
      expect(readFileSync(join(target.path, "foreign.txt"), "utf8"))
        .toBe("not created by registration\n");
      expect(getWorkspace(result.project_id, db)?.slug).toBe("fleet-resources");
      expect(fakes.todos.records.size).toBe(0);
      expect(fakes.conversations.records.size).toBe(0);
      expect(result.rollback).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "projects_directory",
          status: "failed",
          reason_code: "directory_content_drift_refuses_cleanup",
        }),
        expect.objectContaining({
          step_id: "projects_project",
          status: "failed",
          reason_code: "directory_content_drift_refuses_cleanup",
        }),
      ]));
      expect(result.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "project",
          authority: "projects",
          target_id: result.project_id,
        }),
        expect.objectContaining({
          kind: "project_directory",
          authority: "projects-files",
          target_id: result.project_id,
        }),
      ]));
      expect(result.artifacts.some((artifact) =>
        ["todos", "mementos", "conversations"].includes(artifact.authority)
      )).toBe(false);
    } finally {
      db.close();
    }
  });

  test("removes an attempt-created GOALS file when immutable receipt persistence fails", async () => {
    const db = makeDb();
    const target = tempTarget("goals-receipt-failure");
    const fakes = fakeAuthorities();
    db.run(`
      CREATE TRIGGER inject_goals_receipt_failure
      BEFORE INSERT ON project_registration_receipts
      WHEN NEW.step_id = 'projects_goals' AND NEW.direction = 'forward'
      BEGIN
        SELECT RAISE(ABORT, 'injected goals receipt failure');
      END
    `);
    try {
      const result = await registerFullProject(
        input("op-full-goals-receipt-failure", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("projects_goals");
      expect(result.receipts.some((receipt) => receipt.step_id === "projects_goals")).toBe(false);
      expect(fakes.todos.records.size).toBe(0);
      expect(fakes.mementos.records.size).toBe(0);
      expect(fakes.conversations.records.size).toBe(0);
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("compensates the channel when exact Todos task-list creation fails", async () => {
    const db = makeDb();
    const target = tempTarget("task-list-failure");
    const fakes = fakeAuthorities(["todos_task_list"]);
    try {
      const result = await registerFullProject(
        input("op-full-task-list-failure", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("todos_task_list");
      expect(fakes.todos.records.size).toBe(0);
      expect(fakes.conversations.records.size).toBe(0);
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("keeps manifests and receipts immutable and rejects ambiguous bounded lookup", async () => {
    const db = makeDb();
    const target = tempTarget("receipts");
    const fakes = fakeAuthorities();
    try {
      const result = await registerFullProject(
        input("op-full-receipts", target.target),
        { db, authorities: fakes.authorities },
      );
      const accepted = result.receipts.find((receipt) => receipt.step_id === "registration_terminal")!;
      const lookup = lookupProjectRegistrationReceipt({
        operation_id: result.operation_id,
        step_id: "registration_terminal",
        direction: "forward",
        idempotency_key: accepted.idempotency_key,
        max_items: 1,
        response_byte_limit: 100_000,
        time_budget_ms: 2_000,
      }, db);
      expect(lookup.receipt.receipt_id).toBe(accepted.receipt_id);
      expect(lookup.response_control.complete).toBe(true);
      expect(lookup.response_control.truncated).toBe(false);
      expect(lookup.receipt.artifacts.length).toBeGreaterThanOrEqual(7);
      expect(lookup.receipt.preconditions).toEqual(expect.arrayContaining([
        expect.objectContaining({ bounded_lookup: true, exact_readback: true }),
      ]));
      expect(lookup.receipt.rollback.length).toBeGreaterThanOrEqual(7);

      expect(() => db.run(
        "UPDATE project_registration_receipts SET reason = 'changed' WHERE receipt_id = ?",
        [accepted.receipt_id],
      )).toThrow(/immutable/);
      expect(() => db.run(
        "DELETE FROM project_registration_manifests WHERE operation_id = ?",
        [result.operation_id],
      )).toThrow(/immutable/);

      db.run(
        `INSERT INTO project_registration_receipts (
          receipt_id, operation_id, sequence, step_id, authority, resource_kind,
          direction, idempotency_key, target_id, request_digest,
          precondition_digest, outcome, reason, result_revision, result_digest,
          duplicate_of_receipt_id, authority_receipt_json, artifacts_json,
          preconditions_json, rollback_json, created_at
        ) SELECT ?, operation_id, sequence + 100, step_id, authority, resource_kind,
          direction, idempotency_key, target_id, request_digest,
          precondition_digest, 'terminal_nonacceptance', 'corrupt-second-terminal',
          result_revision, result_digest, NULL, authority_receipt_json, artifacts_json,
          preconditions_json, rollback_json, created_at
        FROM project_registration_receipts WHERE receipt_id = ?`,
        ["prr_corrupt_terminal", accepted.receipt_id],
      );
      expect(() => lookupProjectRegistrationReceipt({
        operation_id: result.operation_id,
        step_id: "registration_terminal",
        direction: "forward",
        idempotency_key: accepted.idempotency_key,
        max_items: 1,
        response_byte_limit: 100_000,
        time_budget_ms: 2_000,
      }, db)).toThrow(/exactly one terminal result, found 2/);
    } finally {
      db.close();
    }
  });
});
