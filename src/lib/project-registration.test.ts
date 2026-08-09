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
  mutateProjectResourceLinks,
  mutateProjectResourceLinksForRegistration,
} from "../db/workspaces.js";
import { canonicalJson, sha256 } from "./guarded-project-mutation.js";
import { buildProjectContextBundle } from "./project-context-bundle.js";
import {
  normalizeProjectResourceLinks,
  projectResourceLinkCollection,
  projectResourceLinkId,
  projectResourceLinksDigest,
} from "./project-resource-links.js";
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
  type ProjectRegistrationAuthorityTransport,
  type ProjectRegistrationResourceKind,
} from "./project-registration.js";
import { PROJECT_MARKER_FILENAME } from "./workspace-runtime.js";
import type { ProjectStore } from "../store/project-store.js";
import type {
  CreateWorkspaceInput,
  ProjectResourceLink,
  ProjectResourceLinkMutationRequest,
  ProjectResourceLinkMutationResult,
  ProjectResourceLinkReadRequest,
  ProjectResourceLinkReadResult,
  Workspace,
} from "../types/workspace.js";

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

function fakeAuthorityTargetId(
  authority: ProjectRegistrationAuthorityName,
  resourceKind: ProjectRegistrationResourceKind,
  desired: Record<string, unknown>,
): string {
  const selectorDigest = sha256(canonicalJson(desired));
  return authority === "conversations" && resourceKind === "channel"
    ? [
      selectorDigest.slice(0, 8),
      selectorDigest.slice(8, 12),
      `4${selectorDigest.slice(13, 16)}`,
      `8${selectorDigest.slice(17, 20)}`,
      selectorDigest.slice(20, 32),
    ].join("-")
    : `${authorityPrefix(authority)}_${resourceKind}_${selectorDigest.slice(0, 12)}`;
}

class FakeAuthority implements ProjectRegistrationAuthorityAdapter {
  readonly records = new Map<string, ProjectRegistrationAuthorityRecord>();
  readonly receiptByKey = new Map<string, ProjectRegistrationAuthorityReceipt>();
  readonly acceptedReceiptByTarget = new Map<string, ProjectRegistrationAuthorityReceipt>();
  readonly requests: ProjectRegistrationAuthorityRequest[] = [];
  readonly compensated: string[] = [];
  readonly inverseSelectors: string[] = [];
  readonly inverseVerifications: string[] = [];
  readonly inverseRequests: ProjectRegistrationAuthorityRequest[] = [];
  readonly inverseDuplicateSteps = new Set<string>();
  readonly invalidInverseDuplicateSteps = new Set<string>();
  readonly preexistingTerminalReasons = new Map<string, "preexisting_equivalent" | "preexisting_conflict">();
  readonly validatedAdoptionTargets = new Set<string>();
  strictInverseDesired = false;
  allowExistingAdoption = false;
  beforeCreate: ((request: ProjectRegistrationAuthorityRequest) => void | Promise<void>) | null = null;
  channelTargetIdFactory: ((selectorDigest: string) => string) | null = null;
  packageVersion = "test-1.0.0";
  capabilityCalls = 0;

  constructor(
    readonly authority: ProjectRegistrationAuthorityName,
    readonly resources: ProjectRegistrationResourceKind[],
    readonly transport: ProjectRegistrationAuthorityTransport | undefined,
    readonly failSteps: Set<string> = new Set(),
    readonly readbackMismatchKinds: Set<ProjectRegistrationResourceKind> = new Set(),
    readonly disconnectAfterCreateSteps: Set<string> = new Set(),
    readonly failLookupSteps: Set<string> = new Set(),
    readonly driftDirectoryOnFailSteps: Set<string> = new Set(),
  ) {}

  async capability(): Promise<ProjectRegistrationAuthorityCapability> {
    this.capabilityCalls += 1;
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

    const selectorDigest = sha256(canonicalJson(request.desired));
    const targetId = this.authority === "conversations" && request.resource_kind === "channel"
      ? this.channelTargetIdFactory?.(selectorDigest)
        ?? fakeAuthorityTargetId(this.authority, request.resource_kind, request.desired)
      : fakeAuthorityTargetId(this.authority, request.resource_kind, request.desired);
    const existingRecord = this.records.get(targetId);
    const preexistingReason = this.preexistingTerminalReasons.get(targetId);
    if (existingRecord && preexistingReason) {
      const rejected = this.makeReceipt(request, {
        outcome: "terminal_nonacceptance",
        target_id: targetId,
        result_revision: existingRecord.revision,
        result_digest: existingRecord.digest,
        reason: preexistingReason,
        created_by_operation: false,
      });
      this.receiptByKey.set(request.idempotency_key, rejected);
      return rejected;
    }
    if (existingRecord && this.allowExistingAdoption) {
      const original = this.acceptedReceiptByTarget.get(targetId);
      if (!original) throw new Error("existing record lacks its accepted receipt");
      const adopted = this.makeReceipt(request, {
        outcome: "duplicate_of_accepted",
        target_id: targetId,
        result_revision: existingRecord.revision,
        result_digest: existingRecord.digest,
        reason: null,
        created_by_operation: false,
        duplicate_of_receipt_id: original.receipt_id,
      });
      this.receiptByKey.set(request.idempotency_key, adopted);
      return adopted;
    }
    if (existingRecord) {
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
    this.acceptedReceiptByTarget.set(targetId, receipt);
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

  async validateExistingAdoption(
    _request: ProjectRegistrationAuthorityRequest,
    receipt: ProjectRegistrationAuthorityReceipt,
  ): Promise<boolean> {
    return receipt.target_id !== null && this.validatedAdoptionTargets.has(receipt.target_id);
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

type FakeAuthoritySet = {
  authorities: ProjectRegistrationAuthorities;
  todos: FakeAuthority;
  mementos: FakeAuthority;
  conversations: FakeAuthority;
};

function buildFakeAuthorities(
  transports: Record<ProjectRegistrationAuthorityName, ProjectRegistrationAuthorityTransport | undefined>,
  failSteps: string[] = [],
  readbackMismatchKinds: Partial<Record<ProjectRegistrationAuthorityName, ProjectRegistrationResourceKind[]>> = {},
  disconnectAfterCreateSteps: string[] = [],
  failLookupSteps: string[] = [],
  driftDirectoryOnFailSteps: string[] = [],
): FakeAuthoritySet {
  const failures = new Set(failSteps);
  const disconnects = new Set(disconnectAfterCreateSteps);
  const lookupFailures = new Set(failLookupSteps);
  const directoryDriftFailures = new Set(driftDirectoryOnFailSteps);
  const todos = new FakeAuthority(
    "todos",
    ["project", "task_list"],
    transports.todos,
    failures,
    new Set(readbackMismatchKinds.todos ?? []),
    disconnects,
    lookupFailures,
    directoryDriftFailures,
  );
  const mementos = new FakeAuthority(
    "mementos",
    ["project"],
    transports.mementos,
    failures,
    new Set(readbackMismatchKinds.mementos ?? []),
    disconnects,
    lookupFailures,
    directoryDriftFailures,
  );
  const conversations = new FakeAuthority(
    "conversations",
    ["channel"],
    transports.conversations,
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

function fakeAuthorities(
  failSteps: string[] = [],
  readbackMismatchKinds: Partial<Record<ProjectRegistrationAuthorityName, ProjectRegistrationResourceKind[]>> = {},
  disconnectAfterCreateSteps: string[] = [],
  failLookupSteps: string[] = [],
  driftDirectoryOnFailSteps: string[] = [],
): FakeAuthoritySet {
  return buildFakeAuthorities(
    { todos: "local", mementos: "local", conversations: "local" },
    failSteps,
    readbackMismatchKinds,
    disconnectAfterCreateSteps,
    failLookupSteps,
    driftDirectoryOnFailSteps,
  );
}

function fakeAuthoritiesWithTransports(
  transports: Record<ProjectRegistrationAuthorityName, ProjectRegistrationAuthorityTransport | undefined>,
  failSteps: string[] = [],
): FakeAuthoritySet {
  return buildFakeAuthorities(transports, failSteps);
}

class FakeCloudProjectAuthority {
  readonly mode = "api" as const;
  readonly baseUrl = "https://projects.example.test/v1";
  project: Workspace | null = null;
  links: ProjectResourceLink[] = [];
  readonly resourceLinkMutations: ProjectResourceLinkMutationRequest[] = [];
  creates = 0;
  deletes = 0;
  disconnectAfterCreate = false;

  async getProject(idOrSlug: string): Promise<Workspace | null> {
    return this.project && (this.project.id === idOrSlug || this.project.slug === idOrSlug)
      ? this.project
      : null;
  }

  async createProject(create: CreateWorkspaceInput): Promise<Workspace> {
    this.creates += 1;
    const createdAt = "2026-08-09T00:00:00.000Z";
    this.project = {
      id: create.id!,
      slug: create.slug!,
      name: create.name,
      description: create.description ?? null,
      kind: create.kind ?? "generic",
      status: "active",
      root_id: create.root_id ?? null,
      recipe_id: create.recipe_id ?? null,
      canonical_machine: null,
      primary_path: create.primary_path ?? null,
      git_remote: create.git_remote ?? null,
      s3_bucket: create.s3_bucket ?? null,
      s3_prefix: create.s3_prefix ?? null,
      tags: create.tags ?? [],
      integrations: create.integrations ?? {},
      metadata: create.metadata ?? {},
      last_opened_at: null,
      created_at: createdAt,
      updated_at: createdAt,
      synced_at: null,
    };
    if (this.disconnectAfterCreate) {
      throw new Error("connection closed after hosted project commit");
    }
    return this.project;
  }

  async deleteProject(id: string, opts: { hard?: boolean }) {
    const project = await this.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    this.deletes += 1;
    this.project = null;
    return { workspace: project, hard: Boolean(opts.hard), id: project.id };
  }

  async readProjectResourceLinks(input: ProjectResourceLinkReadRequest): Promise<ProjectResourceLinkReadResult> {
    const project = await this.getProject(input.project_id);
    if (!project) throw new Error(`Project not found: ${input.project_id}`);
    return {
      ok: true,
      project_id: project.id,
      project,
      current_revision: project.updated_at,
      links: this.links,
      link_count: this.links.length,
      max_items: input.max_items,
      collection_digest: projectResourceLinksDigest(this.links),
      complete: true,
      truncated: false,
      contract: projectResourceLinkCollection(
        project.id,
        project.updated_at,
        this.links,
        input.max_items,
      ),
      response_control: {
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
        response_bytes: 1,
        elapsed_ms: 0,
        complete: true,
        truncated: false,
      },
    };
  }

  async mutateProjectResourceLinks(
    input: ProjectResourceLinkMutationRequest,
  ): Promise<ProjectResourceLinkMutationResult> {
    const project = await this.getProject(input.project_id);
    if (!project) throw new Error(`Project not found: ${input.project_id}`);
    if (project.updated_at !== input.expected_revision) throw new Error("stale fake hosted revision");
    this.resourceLinkMutations.push(input);
    const before = {
      project,
      links: this.links,
      collection_digest: projectResourceLinksDigest(this.links),
    };
    const normalized = normalizeProjectResourceLinks(input.links);
    const nextRevision = `2026-08-09T00:00:00.${String(this.resourceLinkMutations.length).padStart(3, "0")}Z`;
    this.links = normalized.map((link) => {
      const id = projectResourceLinkId(project.id, link);
      const existing = before.links.find((item) => item.id === id);
      return {
        ...link,
        id,
        project_id: project.id,
        labels: link.labels ?? {},
        created_at: existing?.created_at ?? nextRevision,
        updated_at: nextRevision,
      } as ProjectResourceLink;
    });
    this.project = {
      ...project,
      integrations: input.integrations ?? project.integrations,
      updated_at: nextRevision,
    };
    const after = {
      project: this.project,
      links: this.links,
      collection_digest: projectResourceLinksDigest(this.links),
    };
    return {
      ok: true,
      dry_run: false,
      outcome: "accepted",
      mode: input.mode,
      idempotency_key: `fake-${input.operation_id}-${input.step_id}`,
      request_digest: sha256(canonicalJson(input.links)),
      precondition_digest: sha256(input.expected_revision),
      project_id: project.id,
      expected_revision: input.expected_revision,
      current_revision: this.project.updated_at,
      before,
      after,
      receipt: {
        receipt_id: `grc_fake_${this.resourceLinkMutations.length}`,
        operation_id: input.operation_id,
        step_id: input.step_id,
        direction: "forward",
        idempotency_key: `fake-${input.operation_id}-${input.step_id}`,
        target_id: project.id,
        request_digest: sha256(canonicalJson(input.links)),
        precondition_digest: sha256(input.expected_revision),
        expected_revision: input.expected_revision,
        outcome: "accepted",
        reason: null,
        result_project_id: project.id,
        duplicate_of_receipt_id: null,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        post_revision: this.project.updated_at,
        created_at: nextRevision,
      },
      response_control: {
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
        response_bytes: 1,
        elapsed_ms: 0,
        complete: true,
        truncated: false,
      },
    };
  }

  asStore(): ProjectStore {
    return this as unknown as ProjectStore;
  }
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
  test("rejects incomplete finance metadata before any authority or filesystem mutation", async () => {
    const db = makeDb();
    const target = tempTarget("finance-metadata-rejected");
    try {
      await expect(registerFullProject(
        input("op-finance-metadata-rejected", target.target, {
          metadata: {
            business_area: "finance",
            ledger_authority: "@hasna/accounting",
          },
        }),
        { db, authorities: unavailableProjectRegistrationAuthorities() },
      )).rejects.toThrow(/missing required fields/i);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

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

  test("rejects all undeclared authority transports before local Projects can probe or mutate", async () => {
    const db = makeDb();
    const target = tempTarget("undeclared-local-authorities");
    const fakes = fakeAuthoritiesWithTransports({
      todos: undefined,
      mementos: undefined,
      conversations: undefined,
    });
    try {
      const result = await registerFullProject(
        input("op-undeclared-local-authorities", target.target),
        { db, authorities: fakes.authorities },
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
      expect(fakes.todos.capabilityCalls + fakes.mementos.capabilityCalls + fakes.conversations.capabilityCalls).toBe(0);
      expect(fakes.todos.requests.length + fakes.mementos.requests.length + fakes.conversations.requests.length).toBe(0);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("rejects all undeclared authority transports before hosted Projects can probe or mutate", async () => {
    const db = makeDb();
    const target = tempTarget("undeclared-hosted-authorities");
    const fakes = fakeAuthoritiesWithTransports({
      todos: undefined,
      mementos: undefined,
      conversations: undefined,
    });
    const projects = new FakeCloudProjectAuthority();
    try {
      const result = await registerFullProject(
        input("op-undeclared-hosted-authorities", target.target, { id: "wks_undeclaredhosted01" }),
        { db, authorities: fakes.authorities, projectStore: projects.asStore() },
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
      expect(fakes.todos.capabilityCalls + fakes.mementos.capabilityCalls + fakes.conversations.capabilityCalls).toBe(0);
      expect(fakes.todos.requests.length + fakes.mementos.requests.length + fakes.conversations.requests.length).toBe(0);
      expect(projects.creates).toBe(0);
      expect(projects.project).toBeNull();
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });

  test("rejects a partially undeclared authority set before any adapter is probed", async () => {
    const db = makeDb();
    const target = tempTarget("partially-undeclared-authorities");
    const fakes = fakeAuthoritiesWithTransports({
      todos: "local",
      mementos: undefined,
      conversations: "local",
    });
    try {
      const result = await registerFullProject(
        input("op-partially-undeclared-authorities", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result).toMatchObject({
        ok: false,
        outcome: "no_go",
        failed_step: "authority_preflight",
        reason_code: "authority_transport_mismatch",
      });
      expect(result.dependencies.map((blocker) => blocker.authority)).toEqual(["mementos"]);
      expect(fakes.todos.capabilityCalls + fakes.mementos.capabilityCalls + fakes.conversations.capabilityCalls).toBe(0);
      expect(fakes.todos.requests.length + fakes.mementos.requests.length + fakes.conversations.requests.length).toBe(0);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("full project registration transaction", () => {
  test("hosted Projects authority never creates a local shadow row and rolls its exact row back on failure", async () => {
    const db = makeDb();
    const target = tempTarget("hosted-no-shadow");
    const fakes = fakeAuthoritiesWithTransports(
      { todos: "api", mementos: "api", conversations: "api" },
      ["conversations_channel"],
    );
    const projects = new FakeCloudProjectAuthority();
    projects.disconnectAfterCreate = true;
    try {
      const result = await registerFullProject(
        input("op-hosted-no-shadow", target.target, { id: "wks_hostednoshadow01" }),
        { db, authorities: fakes.authorities, projectStore: projects.asStore() },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("rolled_back");
      expect(projects.creates).toBe(1);
      expect(projects.deletes).toBe(1);
      expect(projects.project).toBeNull();
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
      expect(JSON.stringify(result)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

  test("removes a hosted project when its local immutable receipt cannot persist", async () => {
    const db = makeDb();
    const target = tempTarget("hosted-receipt-failure");
    const fakes = fakeAuthoritiesWithTransports(
      { todos: "api", mementos: "api", conversations: "api" },
    );
    const projects = new FakeCloudProjectAuthority();
    db.run(`
      CREATE TRIGGER fail_hosted_project_receipt
      BEFORE INSERT ON project_registration_receipts
      WHEN NEW.step_id = 'projects_project'
      BEGIN
        SELECT RAISE(ABORT, 'injected hosted project receipt failure');
      END
    `);
    try {
      const result = await registerFullProject(
        input("op-hosted-receipt-failure", target.target, { id: "wks_hostedreceipt0001" }),
        { db, authorities: fakes.authorities, projectStore: projects.asStore() },
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("projects_project");
      expect(projects.creates).toBe(1);
      expect(projects.deletes).toBe(1);
      expect(projects.project).toBeNull();
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
      expect(JSON.stringify(result)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

  test("retrofits an exact existing project row without recreating it and reruns idempotently", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-existing");
    const fakes = fakeAuthorities();
    const projectId = "wks_retrofitexisting01";
    try {
      expect(fakes.todos.transport).toBe("local");
      expect(fakes.mementos.transport).toBe("local");
      expect(fakes.conversations.transport).toBe("local");
      const existing = createWorkspace({
        id: projectId,
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
        primary_path: target.path,
        integrations: { github_repo: "hasna/projects" },
        metadata: { owner: "quintilian" },
        require_exact_identity: true,
      }, db);
      const seeded = mutateProjectResourceLinks({
        project_id: projectId,
        operation_id: "op-retrofit-existing-link-seed",
        step_id: "seed-unrelated-contact",
        mode: "add",
        expected_revision: existing.updated_at,
        links: [{
          authority: "contacts",
          service_instance: "https://contacts.example.test/v1",
          source_package: "@hasna/contacts",
          target_kind: "contact",
          locator: {
            kind: "external_uuid",
            value: "11111111-1111-4111-8111-111111111111",
          },
          scope: "resource",
          labels: { name: "Existing contact" },
        }],
        max_items: 32,
        response_byte_limit: 1_000_000,
        time_budget_ms: 10_000,
        source: "system",
        command: "seed unrelated resource link",
      }, db);
      expect(seeded.ok).toBe(true);
      const seededProject = getWorkspace(projectId, db)!;
      const financeMetadata = {
        owner: "quintilian",
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: ["Example Alpha SRL"],
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        retention_policy: "knowledge:finance-retention-v1",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
        approver: "role:finance-controller",
        external_recipient_policy: "@hasna/invoices:approved-recipient-only",
      };
      const request: FullProjectRegistrationInput = {
        ...input("op-retrofit-existing", target.target, {
          id: projectId,
          metadata: financeMetadata,
        }),
        mode: "retrofit",
        expected_project_revision: seededProject.updated_at,
      };

      const first = await registerFullProject(request, { db, authorities: fakes.authorities });
      expect(first.ok).toBe(true);
      expect(first.outcome).toBe("accepted");
      expect(getWorkspace(projectId, db)?.integrations).toEqual({
        conversations_channel: "fleet-resources",
        github_repo: "hasna/projects",
        todos_project_id: expect.any(String),
        todos_task_list_id: expect.any(String),
        mementos_project_id: expect.any(String),
      });
      expect(existsSync(join(target.path, PROJECT_REGISTRATION_GOALS_FILENAME))).toBe(true);
      expect(existsSync(join(target.path, PROJECT_MARKER_FILENAME))).toBe(true);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces WHERE id = ?").get(projectId)).toEqual({ n: 1 });
      expect(db.query(
        "SELECT COUNT(*) AS n FROM project_resource_links WHERE project_id = ? AND authority = 'contacts'",
      ).get(projectId)).toEqual({ n: 1 });
      const appliedProject = getWorkspace(projectId, db)!;
      expect(appliedProject.metadata).toEqual(financeMetadata);
      const context = await buildProjectContextBundle({
        mode: "local",
        getProject: async (id: string) => getWorkspace(id, db),
      } as ProjectStore, projectId, {
        generatedAt: new Date("2026-08-09T00:00:00.000Z"),
        env: { HASNA_MACHINE_ID: "station02-test" },
        hostname: "station02",
      });
      expect(context.project.finance).toEqual({
        schema: "hasna.projects.finance_project_metadata.v1",
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: ["Example Alpha SRL"],
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        retention_policy: "knowledge:finance-retention-v1",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
        approver: "role:finance-controller",
        external_recipient_policy: "@hasna/invoices:approved-recipient-only",
      });
      expect(JSON.stringify(first)).not.toContain(target.path);

      const requestCounts = {
        todos: fakes.todos.requests.length,
        mementos: fakes.mementos.requests.length,
        conversations: fakes.conversations.requests.length,
      };
      const second = await registerFullProject(request, { db, authorities: fakes.authorities });
      expect(second.ok).toBe(true);
      expect(second.outcome).toBe("duplicate_of_accepted");
      expect(fakes.todos.requests.length).toBe(requestCounts.todos);
      expect(fakes.mementos.requests.length).toBe(requestCounts.mementos);
      expect(fakes.conversations.requests.length).toBe(requestCounts.conversations);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces WHERE id = ?").get(projectId)).toEqual({ n: 1 });
      expect(db.query(
        "SELECT COUNT(*) AS n FROM project_resource_links WHERE project_id = ? AND authority = 'contacts'",
      ).get(projectId)).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  test("adopts explicitly linked pre-existing authority resources during retrofit without owning rollback", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-linked-authorities");
    const fakes = fakeAuthorities();
    const projectId = "wks_retrofitlinked001";
    const projectSlug = "fleet-resources";
    const projectName = "Fleet Resources";
    const conversationsDesired = {
      channel: projectSlug,
      project_id: projectId,
      project_slug: projectSlug,
      project_kind: "project",
    };
    const todosProjectDesired = {
      source_project_id: projectId,
      source_project_slug: projectSlug,
      name: projectName,
    };
    const conversationsId = fakeAuthorityTargetId("conversations", "channel", conversationsDesired);
    const todosProjectId = fakeAuthorityTargetId("todos", "project", todosProjectDesired);
    const todosTaskListDesired = {
      todos_project_id: todosProjectId,
      source_project_id: projectId,
      name: projectName,
    };
    const todosTaskListId = fakeAuthorityTargetId("todos", "task_list", todosTaskListDesired);
    const mementosDesired = {
      source_project_id: projectId,
      source_project_slug: projectSlug,
      name: projectName,
      target_path_digest: target.target.digest,
    };
    const mementosProjectId = fakeAuthorityTargetId("mementos", "project", mementosDesired);
    const seed = (
      authority: FakeAuthority,
      targetId: string,
      label: string,
    ) => {
      const record = {
        target_id: targetId,
        revision: `rev_preexisting_${label}`,
        digest: sha256(`preexisting:${label}:${targetId}`),
      };
      authority.records.set(targetId, record);
      authority.preexistingTerminalReasons.set(targetId, "preexisting_conflict");
      authority.validatedAdoptionTargets.add(targetId);
    };
    seed(fakes.conversations, conversationsId, "conversations");
    seed(fakes.todos, todosProjectId, "todos_project");
    seed(fakes.todos, todosTaskListId, "todos_task_list");
    seed(fakes.mementos, mementosProjectId, "mementos_project");
    const unrelatedLinks = [
      {
        authority: "conversations" as const,
        service_instance: "urn:hasna:conversations:service:unrelated",
        source_package: "@hasna/conversations" as const,
        target_kind: "channel" as const,
        locator: {
          kind: "external_uuid" as const,
          value: "33333333-3333-4333-8333-333333333333",
        },
        scope: "collection" as const,
        labels: { channel_name: "unrelated-project-channel" },
      },
      {
        authority: "todos" as const,
        service_instance: "urn:hasna:todos:service:unrelated",
        source_package: "@hasna/todos" as const,
        target_kind: "project" as const,
        locator: {
          kind: "canonical_uri" as const,
          value: "urn:hasna:todos:project:unrelated-project",
        },
        scope: "collection" as const,
        labels: { name: "Unrelated Todos project" },
      },
      {
        authority: "todos" as const,
        service_instance: "urn:hasna:todos:service:unrelated",
        source_package: "@hasna/todos" as const,
        target_kind: "task_list" as const,
        locator: {
          kind: "canonical_uri" as const,
          value: "urn:hasna:todos:task_list:unrelated-list",
        },
        scope: "collection" as const,
        labels: { name: "Unrelated Todos task list" },
      },
      {
        authority: "mementos" as const,
        service_instance: "urn:hasna:mementos:service:unrelated",
        source_package: "@hasna/mementos" as const,
        target_kind: "project" as const,
        locator: {
          kind: "canonical_uri" as const,
          value: "urn:hasna:mementos:project:unrelated-project",
        },
        scope: "collection" as const,
        labels: { name: "Unrelated Mementos project" },
      },
    ];
    const unrelatedLinkIds = unrelatedLinks
      .map((link) => projectResourceLinkId(projectId, link))
      .sort();
    const persistedUnrelatedLinkIds = (): string[] => (
      db.query(
        `SELECT id
         FROM project_resource_links
         WHERE project_id = ? AND id IN (?, ?, ?, ?)
         ORDER BY id`,
      ).all(projectId, ...unrelatedLinkIds) as Array<{ id: string }>
    ).map((row) => row.id);
    try {
      const existing = createWorkspace({
        id: projectId,
        name: projectName,
        slug: projectSlug,
        kind: "project",
        primary_path: target.path,
        integrations: {
          conversations_channel: projectSlug,
          todos_project_id: todosProjectId,
          todos_task_list_id: todosTaskListId,
          mementos_project_id: mementosProjectId,
          github_repo: "hasna/projects",
        },
        require_exact_identity: true,
      }, db);
      const seededLinks = mutateProjectResourceLinksForRegistration({
        project_id: projectId,
        operation_id: "op-retrofit-linked-authorities-extra-links",
        step_id: "seed-unrelated-same-kind-links",
        mode: "add",
        expected_revision: existing.updated_at,
        links: unrelatedLinks,
        max_items: 32,
        response_byte_limit: 1_000_000,
        time_budget_ms: 10_000,
        source: "system",
        command: "seed unrelated same-kind links",
      }, existing.integrations, db);
      expect(seededLinks.ok).toBe(true);
      const request: FullProjectRegistrationInput = {
        ...input("op-retrofit-linked-authorities", target.target, { id: projectId }),
        mode: "retrofit",
        expected_project_revision: getWorkspace(projectId, db)!.updated_at,
      };

      const first = await registerFullProject(request, { db, authorities: fakes.authorities });

      expect(first).toMatchObject({ ok: true, outcome: "accepted" });
      for (const stepId of [
        "conversations_channel",
        "todos_project",
        "todos_task_list",
        "mementos_project",
      ]) {
        expect(first.receipts.find((receipt) => receipt.step_id === stepId)).toMatchObject({
          outcome: "accepted",
          reason: "adopted_preexisting",
          rollback: [],
          artifacts: [expect.objectContaining({ adopted: true, created_by_operation: false })],
          authority_receipt: expect.objectContaining({
            outcome: "terminal_nonacceptance",
            reason: "preexisting_conflict",
            created_by_operation: false,
          }),
        });
      }
      expect(fakes.conversations.compensated).toEqual([]);
      expect(fakes.todos.compensated).toEqual([]);
      expect(fakes.mementos.compensated).toEqual([]);
      expect(getWorkspace(projectId, db)?.integrations).toEqual({
        conversations_channel: projectSlug,
        todos_project_id: todosProjectId,
        todos_task_list_id: todosTaskListId,
        mementos_project_id: mementosProjectId,
        github_repo: "hasna/projects",
      });
      expect(db.query(
        "SELECT COUNT(*) AS n FROM project_resource_links WHERE project_id = ?",
      ).get(projectId)).toEqual({ n: 8 });
      expect(persistedUnrelatedLinkIds()).toEqual(unrelatedLinkIds);
      expect(existsSync(target.path)).toBe(true);

      const requestCount = fakes.conversations.requests.length
        + fakes.todos.requests.length
        + fakes.mementos.requests.length;
      const retry = await registerFullProject(request, { db, authorities: fakes.authorities });
      expect(retry).toMatchObject({ ok: true, outcome: "duplicate_of_accepted" });
      expect(
        fakes.conversations.requests.length + fakes.todos.requests.length + fakes.mementos.requests.length,
      ).toBe(requestCount);
      expect(db.query(
        "SELECT COUNT(*) AS n FROM project_resource_links WHERE project_id = ?",
      ).get(projectId)).toEqual({ n: 8 });
      expect(persistedUnrelatedLinkIds()).toEqual(unrelatedLinkIds);

      writeFileSync(join(target.path, PROJECT_REGISTRATION_GOALS_FILENAME), "# Foreign goals\n");
      const rollbackProbe = await registerFullProject({
        ...input("op-retrofit-linked-authorities-rollback", target.target, { id: projectId }),
        mode: "retrofit",
        expected_project_revision: getWorkspace(projectId, db)!.updated_at,
      }, { db, authorities: fakes.authorities });
      expect(rollbackProbe).toMatchObject({
        ok: false,
        outcome: "rolled_back",
        failed_step: "projects_goals",
        reason_code: "retrofit_existing_file_conflict",
      });
      expect(fakes.conversations.compensated).toEqual([]);
      expect(fakes.todos.compensated).toEqual([]);
      expect(fakes.mementos.compensated).toEqual([]);
      expect(fakes.conversations.records.has(conversationsId)).toBe(true);
      expect(fakes.todos.records.has(todosProjectId)).toBe(true);
      expect(fakes.todos.records.has(todosTaskListId)).toBe(true);
      expect(fakes.mementos.records.has(mementosProjectId)).toBe(true);
      expect(db.query(
        "SELECT COUNT(*) AS n FROM project_resource_links WHERE project_id = ?",
      ).get(projectId)).toEqual({ n: 8 });
      expect(persistedUnrelatedLinkIds()).toEqual(unrelatedLinkIds);
    } finally {
      db.close();
    }
  });

  test("does not adopt an unlinked pre-existing authority conflict during retrofit", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-unlinked-authority");
    const fakes = fakeAuthorities();
    const projectId = "wks_retrofitunlinked1";
    const desired = {
      channel: "fleet-resources",
      project_id: projectId,
      project_slug: "fleet-resources",
      project_kind: "project",
    };
    const targetId = fakeAuthorityTargetId("conversations", "channel", desired);
    fakes.conversations.records.set(targetId, {
      target_id: targetId,
      revision: "rev_preexisting_unlinked",
      digest: sha256(`preexisting:unlinked:${targetId}`),
    });
    fakes.conversations.preexistingTerminalReasons.set(targetId, "preexisting_equivalent");
    try {
      const existing = createWorkspace({
        id: projectId,
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
        primary_path: target.path,
        integrations: {},
        require_exact_identity: true,
      }, db);

      const result = await registerFullProject({
        ...input("op-retrofit-unlinked-authority", target.target, { id: projectId }),
        mode: "retrofit",
        expected_project_revision: existing.updated_at,
      }, { db, authorities: fakes.authorities });

      expect(result).toMatchObject({
        ok: false,
        outcome: "rolled_back",
        failed_step: "conversations_channel",
        reason_code: "preexisting_equivalent",
      });
      expect(existsSync(target.path)).toBe(false);
      expect(getWorkspace(projectId, db)?.integrations).toEqual({});
    } finally {
      db.close();
    }
  });

  test("preserves unrelated hosted integrations and typed links during accepted retrofit", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-hosted-preserves-unrelated");
    const fakes = fakeAuthoritiesWithTransports(
      { todos: "api", mementos: "api", conversations: "api" },
    );
    const projects = new FakeCloudProjectAuthority();
    const projectId = "wks_retrofithosted001";
    const revision = "2026-08-09T00:00:00.000Z";
    projects.project = {
      id: projectId,
      slug: "fleet-resources",
      name: "Fleet Resources",
      description: null,
      kind: "project",
      status: "active",
      root_id: null,
      recipe_id: null,
      canonical_machine: null,
      primary_path: target.path,
      git_remote: null,
      s3_bucket: null,
      s3_prefix: null,
      tags: [],
      integrations: { github_repo: "hasna/projects" },
      metadata: { owner: "quintilian" },
      last_opened_at: null,
      created_at: revision,
      updated_at: revision,
      synced_at: null,
    };
    const contactInput = {
      authority: "contacts" as const,
      service_instance: "https://contacts.example.test/v1",
      source_package: "@hasna/contacts" as const,
      target_kind: "contact" as const,
      locator: {
        kind: "external_uuid" as const,
        value: "22222222-2222-4222-8222-222222222222",
      },
      scope: "resource" as const,
      labels: { name: "Hosted contact" },
    };
    projects.links = [{
      ...contactInput,
      id: projectResourceLinkId(projectId, contactInput),
      project_id: projectId,
      created_at: revision,
      updated_at: revision,
    }];
    try {
      expect(fakes.todos.transport).toBe("api");
      expect(fakes.mementos.transport).toBe("api");
      expect(fakes.conversations.transport).toBe("api");
      const result = await registerFullProject({
        ...input("op-retrofit-hosted-preserve", target.target, { id: projectId }),
        mode: "retrofit",
        expected_project_revision: revision,
      }, { db, authorities: fakes.authorities, projectStore: projects.asStore() });

      expect(result).toMatchObject({ ok: true, outcome: "accepted" });
      expect(projects.project?.integrations).toMatchObject({
        github_repo: "hasna/projects",
        conversations_channel: "fleet-resources",
        todos_project_id: expect.any(String),
        todos_task_list_id: expect.any(String),
        mementos_project_id: expect.any(String),
      });
      expect(projects.links.filter((link) => link.authority === "contacts")).toHaveLength(1);
      expect(projects.resourceLinkMutations).toHaveLength(1);
      expect(projects.resourceLinkMutations[0]?.integrations?.github_repo).toBe("hasna/projects");
      expect(projects.resourceLinkMutations[0]?.links.some((link) =>
        link.authority === "contacts" && link.target_kind === "contact"
      )).toBe(true);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
      expect(JSON.stringify(result)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

  test("guardedly adopts compatible existing authorities, GOALS, and marker under a new retrofit operation", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-compatible-adoption");
    const fakes = fakeAuthorities();
    try {
      const initial = await registerFullProject(
        input("op-retrofit-compatible-seed", target.target),
        { db, authorities: fakes.authorities },
      );
      expect(initial.ok).toBe(true);
      const project = getWorkspace(initial.project_id, db)!;
      fakes.todos.allowExistingAdoption = true;
      fakes.mementos.allowExistingAdoption = true;
      fakes.conversations.allowExistingAdoption = true;

      const adopted = await registerFullProject({
        ...input("op-retrofit-compatible-adopt", target.target, { id: project.id }),
        mode: "retrofit",
        expected_project_revision: project.updated_at,
      }, { db, authorities: fakes.authorities });

      expect(adopted).toMatchObject({ ok: true, outcome: "accepted" });
      expect(adopted.receipts.find((receipt) => receipt.step_id === "projects_project")?.rollback).toEqual([]);
      expect(adopted.receipts.find((receipt) => receipt.step_id === "projects_directory")?.rollback).toEqual([]);
      expect(adopted.receipts.find((receipt) => receipt.step_id === "projects_goals")?.artifacts).toEqual([
        expect.objectContaining({ adopted: true }),
      ]);
      expect(adopted.receipts.find((receipt) => receipt.step_id === "projects_marker")?.artifacts).toEqual([
        expect.objectContaining({ adopted: true }),
      ]);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces WHERE id = ?").get(project.id)).toEqual({ n: 1 });
      expect(JSON.stringify(adopted)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

  test("refuses a stale retrofit revision before manifests, external calls, or filesystem mutation", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-stale-revision");
    const fakes = fakeAuthorities();
    const projectId = "wks_retrofitstale0001";
    try {
      createWorkspace({
        id: projectId,
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
        primary_path: target.path,
        metadata: { owner: "quintilian" },
        require_exact_identity: true,
      }, db);
      const result = await registerFullProject({
        ...input("op-retrofit-stale", target.target, { id: projectId }),
        mode: "retrofit",
        expected_project_revision: "stale-revision",
      }, { db, authorities: fakes.authorities });

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("no_go");
      expect(result.reason_code).toBe("retrofit_project_revision_mismatch");
      expect(fakes.todos.requests).toHaveLength(0);
      expect(fakes.mementos.requests).toHaveLength(0);
      expect(fakes.conversations.requests).toHaveLength(0);
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(existsSync(target.path)).toBe(false);
      expect(JSON.stringify(result)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

  test("rolls back every attempted authority when an existing retrofit file conflicts", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-file-conflict");
    const fakes = fakeAuthorities();
    const projectId = "wks_retrofitfile00001";
    const financeMetadata = {
      owner: "quintilian",
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: ["Example Alpha SRL"],
      fiscal_cycle: "monthly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    };
    mkdirSync(target.path);
    writeFileSync(join(target.path, PROJECT_REGISTRATION_GOALS_FILENAME), "# Foreign goals\n");
    try {
      const existing = createWorkspace({
        id: projectId,
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
        primary_path: target.path,
        integrations: { github_repo: "hasna/projects" },
        metadata: { owner: "quintilian" },
        require_exact_identity: true,
      }, db);
      const seeded = mutateProjectResourceLinks({
        project_id: projectId,
        operation_id: "op-retrofit-conflict-link-seed",
        step_id: "seed-unrelated-contact",
        mode: "add",
        expected_revision: existing.updated_at,
        links: [{
          authority: "contacts",
          service_instance: "https://contacts.example.test/v1",
          source_package: "@hasna/contacts",
          target_kind: "contact",
          locator: {
            kind: "external_uuid",
            value: "44444444-4444-4444-8444-444444444444",
          },
          scope: "resource",
          labels: { name: "Rollback contact" },
        }],
        max_items: 32,
        response_byte_limit: 1_000_000,
        time_budget_ms: 10_000,
        source: "system",
        command: "seed unrelated rollback resource link",
      }, db);
      expect(seeded.ok).toBe(true);
      const result = await registerFullProject({
        ...input("op-retrofit-file-conflict", target.target, {
          id: projectId,
          metadata: financeMetadata,
        }),
        mode: "retrofit",
        expected_project_revision: getWorkspace(projectId, db)!.updated_at,
      }, { db, authorities: fakes.authorities });

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("projects_goals");
      expect(result.reason_code).toBe("retrofit_existing_file_conflict");
      expect(fakes.todos.records.size).toBe(0);
      expect(fakes.mementos.records.size).toBe(0);
      expect(fakes.conversations.records.size).toBe(0);
      expect(getWorkspace(projectId, db)?.integrations).toEqual({ github_repo: "hasna/projects" });
      expect(getWorkspace(projectId, db)?.metadata).toEqual({ owner: "quintilian" });
      expect(result.rollback).toEqual(expect.arrayContaining([
        expect.objectContaining({
          step_id: "projects_metadata",
          status: "completed",
        }),
      ]));
      expect(db.query(
        "SELECT COUNT(*) AS n FROM project_resource_links WHERE project_id = ? AND authority = 'contacts'",
      ).get(projectId)).toEqual({ n: 1 });
      expect(readFileSync(join(target.path, PROJECT_REGISTRATION_GOALS_FILENAME), "utf8"))
        .toBe("# Foreign goals\n");
      expect(existsSync(join(target.path, PROJECT_MARKER_FILENAME))).toBe(false);
      expect(db.query("SELECT COUNT(*) AS n FROM workspaces WHERE id = ?").get(projectId)).toEqual({ n: 1 });
      expect(JSON.stringify(result)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

  test("refuses an unclaimed existing-row retrofit before external or filesystem mutation", async () => {
    const db = makeDb();
    const target = tempTarget("retrofit-unclaimed");
    const fakes = fakeAuthorities();
    const projectId = "wks_retrofitunclaimed1";
    mkdirSync(target.path);
    writeFileSync(join(target.path, "foreign.txt"), "not owned by the project row\n");
    try {
      const existing = createWorkspace({
        id: projectId,
        name: "Fleet Resources",
        slug: "fleet-resources",
        kind: "project",
        metadata: { owner: "quintilian" },
        require_exact_identity: true,
      }, db);
      const result = await registerFullProject({
        ...input("op-retrofit-unclaimed", target.target, { id: projectId }),
        mode: "retrofit",
        expected_project_revision: existing.updated_at,
      }, { db, authorities: fakes.authorities });

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("no_go");
      expect(result.failed_step).toBe("projects_project");
      expect(result.reason_code).toBe("retrofit_primary_path_unclaimed");
      expect(fakes.todos.requests).toHaveLength(0);
      expect(fakes.mementos.requests).toHaveLength(0);
      expect(fakes.conversations.requests).toHaveLength(0);
      expect(readFileSync(join(target.path, "foreign.txt"), "utf8")).toBe("not owned by the project row\n");
      expect(existsSync(join(target.path, PROJECT_REGISTRATION_GOALS_FILENAME))).toBe(false);
      expect(existsSync(join(target.path, PROJECT_MARKER_FILENAME))).toBe(false);
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_manifests").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM project_registration_receipts").get()).toEqual({ n: 0 });
      expect(JSON.stringify(result)).not.toContain(target.path);
    } finally {
      db.close();
    }
  });

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
      expect(db.query(
        `SELECT locator_kind, locator_value
         FROM project_resource_links
         WHERE project_id = ? AND authority = 'conversations' AND target_kind = 'channel'`,
      ).get(result.project_id)).toEqual({
        locator_kind: "external_uuid",
        locator_value: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      });

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

  test("links a real immutable Conversations channel ID without relabeling it as a UUID", async () => {
    const db = makeDb();
    const target = tempTarget("immutable-channel-id");
    const fakes = fakeAuthorities();
    fakes.conversations.channelTargetIdFactory = (selectorDigest) =>
      `chn_${selectorDigest.slice(0, 32)}`;
    try {
      const result = await registerFullProject(
        input("op-full-immutable-channel-id", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("accepted");
      const channelReceipt = result.receipts.find((receipt) =>
        receipt.step_id === "conversations_channel" && receipt.direction === "forward"
      );
      expect(channelReceipt?.target_id).toMatch(/^chn_[0-9a-f]{32}$/);
      expect(db.query(
        `SELECT locator_kind, locator_value, labels_json
         FROM project_resource_links
         WHERE project_id = ? AND authority = 'conversations' AND target_kind = 'channel'`,
      ).get(result.project_id)).toEqual({
        locator_kind: "conversations_channel_id",
        locator_value: channelReceipt!.target_id,
        labels_json: JSON.stringify({ channel_name: "fleet-resources" }),
      });
      expect(getWorkspace(result.project_id, db)?.integrations.conversations_channel)
        .toBe("fleet-resources");
    } finally {
      db.close();
    }
  });

  for (const malformedChannelId of [
    {
      label: "uppercase prefix",
      path: "uppercase-channel-id-prefix",
      operationId: "op-full-uppercase-channel-id-prefix",
      value: "CHN_79fa9c68937a1d020d6031dcaa3dd8d7",
    },
    {
      label: "uppercase hex",
      path: "uppercase-channel-id-hex",
      operationId: "op-full-uppercase-channel-id-hex",
      value: "chn_79FA9C68937A1D020D6031DCAA3DD8D7",
    },
  ]) {
    test(`fails closed when a Conversations channel receipt uses ${malformedChannelId.label}`, async () => {
      const db = makeDb();
      const target = tempTarget(malformedChannelId.path);
      const fakes = fakeAuthorities();
      fakes.conversations.channelTargetIdFactory = () => malformedChannelId.value;
      try {
        const result = await registerFullProject(
          input(malformedChannelId.operationId, target.target),
          { db, authorities: fakes.authorities },
        );

        expect(result.outcome).toBe("rolled_back");
        expect(result.failed_step).toBe("conversations_channel");
        expect(result.reason_code).toBe("channel_immutable_uuid_missing");
        expect(fakes.todos.records.size).toBe(0);
        expect(fakes.mementos.records.size).toBe(0);
        expect(fakes.conversations.records.size).toBe(0);
        expect(getWorkspace(result.project_id, db)).toBeNull();
        expect(db.query("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 0 });
        expect(db.query("SELECT COUNT(*) AS n FROM project_resource_links").get()).toEqual({ n: 0 });
        expect(existsSync(join(target.path, PROJECT_MARKER_FILENAME))).toBe(false);
        expect(existsSync(target.path)).toBe(false);
      } finally {
        db.close();
      }
    });
  }

  test("fails closed when a Conversations channel receipt uses a malformed immutable ID", async () => {
    const db = makeDb();
    const target = tempTarget("malformed-channel-id");
    const fakes = fakeAuthorities();
    fakes.conversations.channelTargetIdFactory = () => "chn_not-a-complete-id";
    try {
      const result = await registerFullProject(
        input("op-full-malformed-channel-id", target.target),
        { db, authorities: fakes.authorities },
      );

      expect(result.outcome).toBe("rolled_back");
      expect(result.failed_step).toBe("conversations_channel");
      expect(result.reason_code).toBe("channel_immutable_uuid_missing");
      expect(fakes.conversations.records.size).toBe(0);
      expect(getWorkspace(result.project_id, db)).toBeNull();
      expect(existsSync(target.path)).toBe(false);
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

  test("rejects a changed payload under an existing operation id without new writes", async () => {
    const db = makeDb();
    const target = tempTarget("operation-payload-conflict");
    const fakes = fakeAuthorities();
    try {
      const request = input("op-payload-conflict", target.target);
      const first = await registerFullProject(request, { db, authorities: fakes.authorities });
      expect(first.ok).toBe(true);
      const counts = {
        todos: fakes.todos.requests.length,
        mementos: fakes.mementos.requests.length,
        conversations: fakes.conversations.requests.length,
        receipts: (db.query(
          "SELECT COUNT(*) AS n FROM project_registration_receipts WHERE operation_id = ?",
        ).get(request.operation_id) as { n: number }).n,
      };

      const conflict = await registerFullProject({
        ...request,
        goals_markdown: "# Different goals\n\n- This payload must not reuse the operation.\n",
      }, { db, authorities: fakes.authorities });

      expect(conflict.ok).toBe(false);
      expect(conflict.outcome).toBe("no_go");
      expect(conflict.failed_step).toBe("registration_manifest");
      expect(conflict.reason_code).toBe("operation_semantics_conflict");
      expect(fakes.todos.requests).toHaveLength(counts.todos);
      expect(fakes.mementos.requests).toHaveLength(counts.mementos);
      expect(fakes.conversations.requests).toHaveLength(counts.conversations);
      expect((db.query(
        "SELECT COUNT(*) AS n FROM project_registration_receipts WHERE operation_id = ?",
      ).get(request.operation_id) as { n: number }).n).toBe(counts.receipts);
      expect(readFileSync(join(target.path, PROJECT_REGISTRATION_GOALS_FILENAME), "utf8"))
        .toBe(request.goals_markdown);
      expect(JSON.stringify(conflict)).not.toContain(target.path);
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
