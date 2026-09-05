import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HasnaHttpError } from "@hasna/contracts/client";
import { closeDatabase } from "../db/database.js";
import {
  PROJECTS_HOME_ENV,
  ensureProjectStore,
  linkProjectLoop,
  type LoopsClientLike,
  type ProjectStoreProject,
} from "../db/project-store.js";
import { getWorkspace } from "../db/workspaces.js";
import {
  TEST_PRODUCER_VERIFIER_NOW,
  testConversationsProducerFixture,
} from "../lib/project-resource-link-producer-verifier.test-support.js";
import {
  resolveProjectStore,
  __resetProjectStore,
  __resetUnhostedModeNotice,
} from "./project-store.js";

/**
 * A caller-built env is HERMETIC in the shared @hasna/contracts seam: it never
 * reaches the machine's Keychain and, with no HOME/HASNA_HOME in it, reads no
 * credentials file either. So an empty object is a station where nothing at all
 * configures the fleet — the one input that selects the on-box registry.
 */
const UNHOSTED_ENV: Record<string, string | undefined> = {};

/** Swallow the one-line unhosted-mode notice in fixtures that expect local. */
const quiet = { notify: () => {} } as const;

function localFixtureStore() {
  return resolveProjectStore(UNHOSTED_ENV, undefined, quiet);
}

/** A `security find-generic-password` stand-in over a fixed item table. */
function fakeKeychain(items: Record<string, string>) {
  const calls: string[][] = [];
  const run = (argv: readonly string[]) => {
    calls.push([...argv]);
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    // 44 is errSecItemNotFound — an absent tier, not a failure.
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
  return { calls, options: { keychain: { platform: "darwin", enabled: true, run } } };
}

describe("projects store resolution (five-tier contracts resolver)", () => {
  test("nothing configured -> unhosted OSS mode on the on-box registry, announced in one line", () => {
    __resetProjectStore();
    __resetUnhostedModeNotice();
    const lines: string[] = [];
    const store = resolveProjectStore(UNHOSTED_ENV, undefined, { notify: (line) => lines.push(line) });
    expect((store as unknown as { transport?: string }).transport).toBe("local");
    expect(store.baseUrl).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toContain("projects: local mode");
    expect(lines[0]!).toContain("HASNA_PROJECTS_API_URL");
    expect(lines[0]!).toContain("hasna.credentials.projects.api-key");
  });

  test("the unhosted notice is printed once per process, not once per resolution", () => {
    __resetProjectStore();
    __resetUnhostedModeNotice();
    const lines: string[] = [];
    const notify = (line: string) => lines.push(line);
    resolveProjectStore(UNHOSTED_ENV, undefined, { notify });
    __resetProjectStore();
    resolveProjectStore(UNHOSTED_ENV, undefined, { notify });
    expect(lines).toHaveLength(1);
  });

  test("tier 5 alone (plain HASNA_PROJECTS_API_KEY) -> hosted on the default fleet gateway", () => {
    __resetProjectStore();
    // URLs never need configuring: a key from any tier is enough to reach the
    // path-prefixed gateway, and the client appends /v1.
    const store = resolveProjectStore({ HASNA_PROJECTS_API_KEY: "k" });
    expect((store as unknown as { transport?: string }).transport).toBe("http");
    expect(store.baseUrl).toBe("https://api.hasna.com/projects/v1");
  });

  test("the unprefixed PROJECTS_API_KEY alias still resolves, silently", () => {
    __resetProjectStore();
    const store = resolveProjectStore({ PROJECTS_API_KEY: "k" });
    expect((store as unknown as { transport?: string }).transport).toBe("http");
    expect(store.baseUrl).toBe("https://api.hasna.com/projects/v1");
  });

  test("url + key -> http store on the configured authority", () => {
    __resetProjectStore();
    const store = resolveProjectStore({
      HASNA_PROJECTS_API_URL: "https://projects.example.test",
      HASNA_PROJECTS_API_KEY: "k",
    });
    expect((store as unknown as { transport?: string }).transport).toBe("http");
    expect(store.baseUrl).toBe("https://projects.example.test/v1");
  });

  test("a declared authority with no resolvable key throws instead of using local", () => {
    __resetProjectStore();
    expect(() => resolveProjectStore({ HASNA_PROJECTS_API_URL: "https://projects.example.test" }))
      .toThrow(/no API key could be resolved/i);
    __resetProjectStore();
    expect(() => resolveProjectStore({ HASNA_PROJECTS_API_URL: "https://projects.example.test" }))
      .toThrow(/never fall back to SQLite/i);
  });

  test("tier 3: the Keychain supplies the key and the authority", () => {
    __resetProjectStore();
    const keychain = fakeKeychain({
      "hasna.credentials.projects.api-key": "keychain-key",
      "hasna.credentials.projects.api-url": "https://projects.keychain.test",
    });
    const store = resolveProjectStore(
      { HASNA_STATION: "station-fixture" },
      undefined,
      { credentials: keychain.options },
    );
    expect((store as unknown as { transport?: string }).transport).toBe("http");
    expect(store.baseUrl).toBe("https://projects.keychain.test/v1");
    expect(keychain.calls.some((argv) => argv.includes("station-fixture"))).toBe(true);
  });

  test("tier 3 outranks tier 5: a Keychain key beats a stale env export", () => {
    __resetProjectStore();
    const keychain = fakeKeychain({ "hasna.credentials.projects.api-key": "fresh" });
    const store = resolveProjectStore(
      { HASNA_STATION: "station-fixture", HASNA_PROJECTS_API_KEY: "stale" },
      undefined,
      { credentials: keychain.options },
    );
    // The value never leaves the seam; the observable proof is that the store
    // resolved hosted against the default gateway with the Keychain consulted.
    expect((store as unknown as { transport?: string }).transport).toBe("http");
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("tier 4: ~/.hasna/projects/config/credentials selects hosted and opens no local db", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-disk-credential-"));
    const dbPath = join(root, "never-created.db");
    const configDir = join(root, "hasna", "projects", "config");
    mkdirSync(configDir, { recursive: true });
    const file = join(configDir, "credentials");
    writeFileSync(file, "HASNA_PROJECTS_API_URL=https://projects.disk.test\nHASNA_PROJECTS_API_KEY=disk-key\n");
    chmodSync(file, 0o600);
    try {
      __resetProjectStore();
      const store = resolveProjectStore({
        HASNA_HOME: join(root, "hasna"),
        HASNA_PROJECTS_DB_PATH: dbPath,
      });
      expect((store as unknown as { transport?: string }).transport).toBe("http");
      expect(store.baseUrl).toBe("https://projects.disk.test/v1");
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a world-readable credentials file fails loud rather than falling through to local", () => {
    const root = mkdtempSync(join(tmpdir(), "projects-disk-credential-mode-"));
    const configDir = join(root, "hasna", "projects", "config");
    mkdirSync(configDir, { recursive: true });
    const file = join(configDir, "credentials");
    writeFileSync(file, "HASNA_PROJECTS_API_KEY=disk-key\n");
    chmodSync(file, 0o644);
    try {
      __resetProjectStore();
      expect(() => resolveProjectStore({ HASNA_HOME: join(root, "hasna") }))
        .toThrow(/0400 or 0600/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("retired locations are never inputs", () => {
    __resetProjectStore();
    __resetUnhostedModeNotice();
    const lines: string[] = [];
    // A fleet-env/cloud/XDG pointer is not a credential source any more: this
    // station still resolves as completely unconfigured.
    const store = resolveProjectStore(
      { XDG_CONFIG_HOME: "/tmp/xdg-should-be-ignored" },
      undefined,
      { notify: (line) => lines.push(line) },
    );
    expect((store as unknown as { transport?: string }).transport).toBe("local");
    expect(lines).toHaveLength(1);
  });

  test("a legacy *_STORAGE_MODE selector is inert — routing is URL + key only", () => {
    const legacySelector = ["HASNA_PROJECTS", "STORAGE", "MODE"].join("_");
    __resetProjectStore();
    __resetUnhostedModeNotice();
    const lines: string[] = [];
    const local = resolveProjectStore({ [legacySelector]: "api" }, undefined, { notify: (l) => lines.push(l) });
    expect((local as unknown as { transport?: string }).transport).toBe("local");
    __resetProjectStore();
    const hosted = resolveProjectStore({
      [legacySelector]: "local",
      HASNA_PROJECTS_API_URL: "https://projects.example.test",
      HASNA_PROJECTS_API_KEY: "k",
    });
    expect((hosted as unknown as { transport?: string }).transport).toBe("http");
  });

  test("baseUrl never embeds the api key", () => {
    __resetProjectStore();
    const store = resolveProjectStore({
      HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
      HASNA_PROJECTS_API_KEY: "super-secret-key",
    });
    expect(store.baseUrl).not.toContain("super-secret-key");
  });
});

describe("local Projects production producer verifier", () => {
  test("rejects a real project-A producer receipt replayed into project B", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-producer-replay-"));
    const previousHome = process.env[PROJECTS_HOME_ENV];
    process.env[PROJECTS_HOME_ENV] = root;
    closeDatabase();
    __resetProjectStore();
    try {
      const operationId = "local-cross-project-producer-replay";
      const stepId = "channel-link";
      const projectBName = "Local Producer Project B";
      const projectBSlug = "local-producer-project-b";
      const targetId = "chn_79fa9c68937a1d020d6031dcaa3dd8d7";
      const bootstrapStore = localFixtureStore();
      const projectB = await bootstrapStore.createProject({
        name: projectBName,
        slug: projectBSlug,
      });
      __resetProjectStore();
      const projectAReceipt = testConversationsProducerFixture({
        operationId,
        stepId,
        targetId,
        projectId: "wks_local_producer_project_a",
        projectSlug: "local-producer-project-a",
        projectName: "Local Producer Project A",
        projectKind: "generic",
      });
      const store = resolveProjectStore(UNHOSTED_ENV, undefined, {
        ...quiet,
        producerAuthorityOptions: projectAReceipt.authorityOptions,
        producerVerifierNow: () => TEST_PRODUCER_VERIFIER_NOW,
      });
      const link = {
        authority: "conversations" as const,
        service_instance: "urn:hasna:conversations:local-production-verifier",
        source_package: "@hasna/conversations" as const,
        target_kind: "channel" as const,
        locator: {
          kind: "conversations_channel_id" as const,
          value: targetId,
        },
        scope: "resource" as const,
        labels: { channel_name: projectB.slug },
      };
      const bounds = { response_byte_limit: 100_000, time_budget_ms: 5_000 };
      const planned = await store.planProjectResourceLinkMigration({
        project_id: projectB.id,
        operation_id: operationId,
        step_id: stepId,
        expected_project_revision: projectB.updated_at,
        links: [{
          link,
          producer_resource_kind: "conversations_channel",
          producer_binding: {
            authority_id: projectAReceipt.capability.authority_id,
            tenant_id: projectAReceipt.capability.tenant_id,
            corpus_id: projectAReceipt.capability.corpus_id,
            capability_digest: projectAReceipt.capabilityDigest,
          },
        }],
        max_items: 10,
        ...bounds,
      });
      const producerApplied = await store.advanceProjectResourceLinkMigration({
        project_id: projectB.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: planned.manifest.transition_version,
        next_state: "producer_applied",
        producer_evidence: projectAReceipt.producerEvidence("forward"),
        evidence: { producer: "accepted" },
        ...bounds,
      });
      const projectsWrite = await store.mutateProjectResourceLinks({
        project_id: projectB.id,
        operation_id: `${operationId}:projects`,
        step_id: stepId,
        mode: "add",
        expected_revision: projectB.updated_at,
        links: [link],
        max_items: 10,
        ...bounds,
      });
      const projectsApplied = await store.advanceProjectResourceLinkMigration({
        project_id: projectB.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: producerApplied.manifest.transition_version,
        next_state: "projects_applied",
        projects_forward_receipt_id: projectsWrite.receipt!.receipt_id,
        evidence: { projects: "accepted" },
        ...bounds,
      });
      const current = await store.readProjectResourceLinks({
        project_id: projectB.id,
        max_items: 10,
        ...bounds,
      });

      await expect(store.advanceProjectResourceLinkMigration({
        project_id: projectB.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: projectsApplied.manifest.transition_version,
        next_state: "verified",
        producer_evidence: projectAReceipt.producerEvidence("readback"),
        last_verified_projects_revision: current.current_revision,
        last_verified_projects_digest: current.collection_digest,
        evidence: projectAReceipt.verificationEvidence(planned.manifest.links[0]!.link_id),
        ...bounds,
      })).rejects.toThrow(/trusted project subject/i);
    } finally {
      closeDatabase();
      __resetProjectStore();
      if (previousHome === undefined) delete process.env[PROJECTS_HOME_ENV];
      else process.env[PROJECTS_HOME_ENV] = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("public resolver verifies live producer receipts/readback and inverse before terminal migration states", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-producer-verifier-"));
    const previousHome = process.env[PROJECTS_HOME_ENV];
    process.env[PROJECTS_HOME_ENV] = root;
    closeDatabase();
    __resetProjectStore();
    try {
      const operationId = "local-production-producer-verifier";
      const stepId = "channel-link";
      const projectName = "Local Producer Verifier";
      const projectSlug = "local-producer-verifier";
      const targetId = "chn_79fa9c68937a1d020d6031dcaa3dd8d7";
      const bootstrapStore = localFixtureStore();
      const project = await bootstrapStore.createProject({ name: projectName, slug: projectSlug });
      __resetProjectStore();
      const fixture = testConversationsProducerFixture({
        operationId,
        stepId,
        targetId,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
        projectKind: project.kind,
      });
      const store = resolveProjectStore(UNHOSTED_ENV, undefined, {
        ...quiet,
        producerAuthorityOptions: fixture.authorityOptions,
        producerVerifierNow: () => TEST_PRODUCER_VERIFIER_NOW,
      });
      const link = {
        authority: "conversations" as const,
        service_instance: "urn:hasna:conversations:local-production-verifier",
        source_package: "@hasna/conversations" as const,
        target_kind: "channel" as const,
        locator: {
          kind: "conversations_channel_id" as const,
          value: targetId,
        },
        scope: "resource" as const,
        labels: { channel_name: project.slug },
      };
      const bounds = { response_byte_limit: 100_000, time_budget_ms: 5_000 };
      const planned = await store.planProjectResourceLinkMigration({
        project_id: project.id,
        operation_id: operationId,
        step_id: stepId,
        expected_project_revision: project.updated_at,
        links: [{
          link,
          producer_resource_kind: "conversations_channel",
          producer_binding: {
            authority_id: fixture.capability.authority_id,
            tenant_id: fixture.capability.tenant_id,
            corpus_id: fixture.capability.corpus_id,
            capability_digest: fixture.capabilityDigest,
          },
        }],
        max_items: 10,
        ...bounds,
      });
      const producerApplied = await store.advanceProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: planned.manifest.transition_version,
        next_state: "producer_applied",
        producer_evidence: fixture.producerEvidence("forward"),
        evidence: { producer: "accepted" },
        ...bounds,
      });
      const projectsWrite = await store.mutateProjectResourceLinks({
        project_id: project.id,
        operation_id: `${operationId}:projects`,
        step_id: stepId,
        mode: "add",
        expected_revision: project.updated_at,
        links: [link],
        max_items: 10,
        ...bounds,
      });
      const projectsApplied = await store.advanceProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: producerApplied.manifest.transition_version,
        next_state: "projects_applied",
        projects_forward_receipt_id: projectsWrite.receipt!.receipt_id,
        evidence: { projects: "accepted" },
        ...bounds,
      });
      const current = await store.readProjectResourceLinks({
        project_id: project.id,
        max_items: 10,
        ...bounds,
      });
      const defaultStore = localFixtureStore();
      await expect(defaultStore.advanceProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: projectsApplied.manifest.transition_version,
        next_state: "verified",
        producer_evidence: fixture.producerEvidence("readback"),
        last_verified_projects_revision: current.current_revision,
        last_verified_projects_digest: current.collection_digest,
        evidence: {},
        ...bounds,
      })).rejects.toThrow(/producer verification evidence must be an object/i);
      await expect(defaultStore.advanceProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: projectsApplied.manifest.transition_version,
        next_state: "verified",
        producer_evidence: fixture.producerEvidence("readback"),
        last_verified_projects_revision: current.current_revision,
        last_verified_projects_digest: current.collection_digest,
        evidence: fixture.verificationEvidence(planned.manifest.links[0]!.link_id),
        ...bounds,
      })).rejects.toThrow(/conversations project registration requires/i);
      const forgedReceipt = {
        ...fixture.forwardReceipt,
        created_at: "2026-08-10T11:00:01.000Z",
      };
      await expect(store.advanceProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: projectsApplied.manifest.transition_version,
        next_state: "verified",
        producer_evidence: fixture.producerEvidence("readback"),
        last_verified_projects_revision: current.current_revision,
        last_verified_projects_digest: current.collection_digest,
        evidence: fixture.verificationEvidence(planned.manifest.links[0]!.link_id, {
          forwardReceipt: forgedReceipt,
        }),
        ...bounds,
      })).rejects.toThrow(/stored producer receipt/i);
      const verified = await store.advanceProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: projectsApplied.manifest.transition_version,
        next_state: "verified",
        producer_evidence: fixture.producerEvidence("readback"),
        last_verified_projects_revision: current.current_revision,
        last_verified_projects_digest: current.collection_digest,
        evidence: fixture.verificationEvidence(planned.manifest.links[0]!.link_id),
        ...bounds,
      });
      expect(verified.manifest.state).toBe("verified");
      expect(verified.events.at(-1)?.evidence.producer_attestation).toEqual(expect.objectContaining({
        verifier: "projects.production-producer-authority-readback.v1",
        verified_at: TEST_PRODUCER_VERIFIER_NOW,
      }));
      const rollbackInProgress = await store.rollbackProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: verified.manifest.transition_version,
        producer_outcome: "pending",
        evidence: { projects_reference_proof: "persisted" },
        max_items: 10,
        ...bounds,
      });
      const rolledBack = await store.rollbackProjectResourceLinkMigration({
        project_id: project.id,
        manifest_id: planned.manifest.manifest_id,
        expected_transition_version: rollbackInProgress.manifest.transition_version,
        producer_outcome: "complete",
        producer_evidence: fixture.producerEvidence("inverse"),
        evidence: fixture.verificationEvidence(planned.manifest.links[0]!.link_id, {
          inverse: true,
        }),
        max_items: 10,
        ...bounds,
      });
      expect(rolledBack.manifest.state).toBe("rolled_back");
      expect(fixture.calls).toEqual([
        "capability",
        "lookup:forward",
        "capability",
        "lookup:forward",
        "readExact",
        "capability",
        "lookup:forward",
        "lookup:inverse",
        "verifyInverse",
      ]);
    } finally {
      closeDatabase();
      __resetProjectStore();
      if (previousHome === undefined) delete process.env[PROJECTS_HOME_ENV];
      else process.env[PROJECTS_HOME_ENV] = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Regression for the split-brain the review flagged: in the hosted backend, roots, agents
// and recipes MUST route to `<url>/v1/...` over HTTP with the bearer key — never
// to local sqlite. These drive the ApiProjectStore through a stub fetch and
// assert both the request path and the response unwrapping.
describe("projects store api transport (roots/agents/recipes)", () => {
  const CLOUD_ENV = {
    HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
    HASNA_PROJECTS_API_KEY: "secret-key",
  };

  function stubStore(handler: (method: string, path: string, body: unknown) => unknown) {
    const calls: Array<{ method: string; path: string; auth: string | null; body?: unknown }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(input);
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, path: `${url.pathname}${url.search}`, auth: headers.get("authorization"), body });
      const result = handler(method, `${url.pathname}${url.search}`, body);
      return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { "content-type": "application/json" } });
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);
    return { store, calls };
  }

  test("listRoots unwraps { roots } from GET /v1/roots with bearer auth", async () => {
    const { store, calls } = stubStore(() => ({ roots: [{ id: "r1", slug: "ws" }], count: 1 }));
    const roots = await store.listRoots();
    expect(roots).toEqual([{ id: "r1", slug: "ws" } as never]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/roots", auth: "Bearer secret-key" });
  });

  test("listProjects omits include_fixtures by default and sends it only when fixtures are requested", async () => {
    const { store, calls } = stubStore(() => ({
      workspaces: [],
      count: 0,
      total: 0,
      offset: 0,
      limit: 100,
      has_more: false,
    }));
    await store.listProjects({});
    await store.listProjects({ exclude_registry_fixtures: false });
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0]!.path.startsWith("/v1/projects")).toBe(true);
    expect(calls[0]!.path).not.toContain("include_fixtures");
    expect(calls[1]).toMatchObject({ method: "GET" });
    expect(calls[1]!.path.startsWith("/v1/projects")).toBe(true);
    expect(calls[1]!.path).toContain("include_fixtures=true");
  });

  test("createRoot POSTs to /v1/roots", async () => {
    const { store, calls } = stubStore((_m, _p, body) => ({ id: "r2", slug: "new", ...(body as object) }));
    const created = await store.createRoot({ name: "New", base_path: "/tmp/new" });
    expect(created).toMatchObject({ id: "r2", slug: "new", name: "New" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v1/roots" });
  });

  test("matchRoots scores server-fetched roots (no local sqlite)", async () => {
    const { store, calls } = stubStore(() => ({
      roots: [
        { id: "a", slug: "a", name: "a", base_path: "/code/a", tags: [], default_kind: null, github_org: "acme" },
        { id: "b", slug: "b", name: "b", base_path: "/code/b", tags: [], default_kind: null, github_org: "other" },
      ],
    }));
    const matches = await store.matchRoots({ github_org: "acme" });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.root.id).toBe("a");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/roots" });
  });

  test("listAgents unwraps { agents } from GET /v1/agents", async () => {
    const { store, calls } = stubStore(() => ({ agents: [{ id: "ag1", slug: "cli" }], count: 1 }));
    const agents = await store.listAgents();
    expect(agents).toEqual([{ id: "ag1", slug: "cli" } as never]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/agents" });
  });

  test("listRecipes unwraps { recipes } from GET /v1/recipes", async () => {
    const { store, calls } = stubStore(() => ({ recipes: [{ id: "rc1", slug: "cli" }], count: 1 }));
    const recipes = await store.listRecipes();
    expect(recipes).toEqual([{ id: "rc1", slug: "cli" } as never]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/recipes" });
  });

  test("deleteRoot resolves the root then DELETEs /v1/roots/{id}?detach=true", async () => {
    const { store, calls } = stubStore((method) => {
      if (method === "GET") return { id: "r9", slug: "gone", name: "gone" };
      return { deleted: true, id: "r9", detached_workspaces: 3 };
    });
    const result = await store.deleteRoot("gone", { detachProjects: true });
    expect(result.root.id).toBe("r9");
    expect(result.detached_workspaces).toBe(3);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v1/roots/r9?detach=true" });
  });

  // Regression for the review's write findings: in the hosted backend an explicit event
  // record MUST POST to the server, and the on-box-only sub-resources (agent
  // assignment, extra locations, mutation locks) MUST NOT silently touch local
  // sqlite — they route through the Store and refuse rather than split-brain.
  test("recordEvent POSTs to /v1/projects/{id}/events and unwraps { event }", async () => {
    const { store, calls } = stubStore((method, _p, body) => {
      if (method === "POST") return { event: { id: "e1", event_type: (body as { event_type: string }).event_type } };
      return {};
    });
    const event = await store.recordEvent("proj1", { event_type: "note", source: "mcp", metadata: { k: 1 } });
    expect(event).toMatchObject({ id: "e1", event_type: "note" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/projects/proj1/events", auth: "Bearer secret-key" });
  });

  test("registered locations read from the api endpoint in the hosted backend", async () => {
    const { store, calls } = stubStore(() => ({
      locations: [{
        id: "loc1",
        workspace_id: "p",
        path: "/projects/p",
        machine_id: "machine01",
        label: "main",
        kind: "local",
        is_primary: true,
        exists_at_create: true,
        metadata: {},
        created_at: "2026-07-31 00:00:00",
      }],
    }));
    expect(await store.getProjectLocations("p")).toEqual([{
      id: "loc1",
      workspace_id: "p",
      path: "/projects/p",
      machine_id: "machine01",
      label: "main",
      kind: "local",
      is_primary: true,
      exists_at_create: true,
      metadata: {},
      created_at: "2026-07-31 00:00:00",
    }]);
    expect(calls).toEqual([{ method: "GET", path: "/v1/projects/p/locations", auth: "Bearer secret-key" }]);
  });

  test("project agent assignments and locks route through the api in the hosted backend", async () => {
    const { store, calls } = stubStore((method, path, body) => {
      if (method === "GET" && path === "/v1/projects/p/agents") {
        return { assignments: [{ id: "wa1", workspace_id: "p", agent_id: "a1", role: "contributor", assigned_by: null, metadata: {}, created_at: "2026-08-01 00:00:00", agent: null }] };
      }
      if (method === "GET" && path === "/v1/locks") {
        return { locks: [{ id: "lk1", lock_key: "k", workspace_id: "p", agent_id: "a1", reason: null, created_at: "2026-08-01 00:00:00", expires_at: null }] };
      }
      if (method === "DELETE" && path === "/v1/locks/k?lock_id=lk1") return { released: true };
      return {};
    });
    expect(await store.getProjectAgents("p")).toEqual([{
      id: "wa1", workspace_id: "p", agent_id: "a1", role: "contributor", assigned_by: null, metadata: {}, created_at: "2026-08-01 00:00:00", agent: null,
    }]);
    expect(await store.listLocks()).toEqual([{
      id: "lk1", lock_key: "k", workspace_id: "p", agent_id: "a1", reason: null, created_at: "2026-08-01 00:00:00", expires_at: null,
    }]);
    // Holder-scoped release (regression 6692dc56): the caller's lock id is sent
    // as the lock_id query parameter so the server deletes only that row.
    expect(await store.releaseLock("k", "lk1")).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/projects/p/agents", auth: "Bearer secret-key" });
    expect(calls[1]).toMatchObject({ method: "GET", path: "/v1/locks", auth: "Bearer secret-key" });
    expect(calls[2]).toMatchObject({ method: "DELETE", path: "/v1/locks/k?lock_id=lk1", auth: "Bearer secret-key" });
  });

  test("forceReleaseLock DELETEs by key alone (admin force path) in the hosted backend", async () => {
    const { store, calls } = stubStore((method, path) => {
      if (method === "DELETE" && path === "/v1/locks/k") return { released: true };
      return {};
    });
    expect(await store.forceReleaseLock("k")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/v1/locks/k", auth: "Bearer secret-key" });
  });

  test("project agent assignment writes POST to the api in the hosted backend", async () => {
    const { store, calls } = stubStore((method, _p, body) => {
      if (method === "POST") {
        return { assignment: { id: "wa2", workspace_id: "p", agent_id: (body as { agent_id: string }).agent_id, role: (body as { role: string }).role, assigned_by: null, metadata: {}, created_at: "2026-08-01 00:00:00", agent: null } };
      }
      return {};
    });
    const assignment = await store.assignAgent("p", { agentId: "a1", role: "owner" });
    expect(assignment).toMatchObject({ id: "wa2", role: "owner", agent_id: "a1" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/projects/p/agents", auth: "Bearer secret-key" });
  });

  test("addLocation POSTs to /v1/projects/{id}/locations in the hosted backend", async () => {
    const { store, calls } = stubStore((method, _p, body) => {
      if (method === "POST") {
        const location = {
          id: "loc2",
          workspace_id: "p",
          path: (body as { path: string }).path,
          machine_id: "machine01",
          label: "extra",
          kind: "local",
          is_primary: false,
          exists_at_create: false,
          metadata: {},
          created_at: "2026-08-01 00:00:00",
        };
        return { project: { id: "p", slug: "proj" }, location };
      }
      return {};
    });
    const result = await store.addLocation("p", { path: "/x", label: "extra", machineId: "machine01" });
    expect(result.location).toMatchObject({ path: "/x", label: "extra", machine_id: "machine01" });
    expect(result.project).toMatchObject({ id: "p" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/projects/p/locations", auth: "Bearer secret-key" });
    expect(calls.at(-1)!.body).toMatchObject({ path: "/x", label: "extra", machine_id: "machine01" });
  });

  test("acquireLock POSTs to /v1/locks in the hosted backend", async () => {
    const { store, calls } = stubStore((method, _p, body) => {
      if (method === "POST") {
        return { lock: { id: "lk2", lock_key: (body as { lock_key: string }).lock_key, workspace_id: "p", agent_id: null, reason: null, created_at: "2026-08-01 00:00:00", expires_at: null } };
      }
      return {};
    });
    const lock = await store.acquireLock({ key: "workspace:p", workspaceId: "p", ttlSeconds: 600 });
    expect(lock).toMatchObject({ lock_key: "workspace:p", workspace_id: "p" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/locks", auth: "Bearer secret-key" });
    expect(calls.at(-1)!.body).toMatchObject({ lock_key: "workspace:p", workspace_id: "p", ttl_seconds: 600 });
  });

  // Regression for the vacuous-read defect (todos 4c17afb1): the per-project app
  // store is a machine-local sqlite FILE (data/<id>/project.db), and the server
  // exposes no loop endpoints at all — so in the hosted backend the ApiProjectStore used to
  // answer every app-store read from a hardcoded empty summary. `loops list`
  // returned `loops: []` and `store inspect` reported `exists: false` /
  // `loop_links: 0` against a file that demonstrably held rows, at rc=0.
  //
  // That is the vacuous-check shape in its worst form: there was NO input for
  // which the reader returned non-empty, so every zero looked like a real answer.
  // These tests pin the fix the tmux-profile precedent already established —
  // machine-local resources resolve against local sqlite in BOTH transports.
  //
  // The `calls` assertion is load-bearing in the other direction: it proves the
  // rows came from the local store rather than from the network, so a stub that
  // merely returned data could not make these pass.
  describe("machine-local app store resolves in the hosted backend (todos 4c17afb1)", () => {
    const project: ProjectStoreProject = {
      id: "wks_apiloops",
      name: "Api Loops",
      slug: "api-loops",
      status: "active",
      kind: "project",
      primary_path: null,
    };

    const fakeLoops: LoopsClientLike = {
      get(idOrName) {
        if (idOrName !== "loop_api") throw new Error("missing");
        return {
          id: "loop_api",
          name: "Api Loop",
          status: "active",
          schedule: { type: "interval", everyMs: 3_600_000 },
          target: { type: "command" },
          nextRunAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:00.000Z",
        };
      },
      runs: () => [],
    };

    // Isolation is asserted, not assumed: every test drives a fresh temp
    // PROJECTS_HOME and the finally-block removes it, so no production store
    // under ~/.hasna/projects is opened, migrated, or written by this suite.
    // Awaits `fn` before restoring the env and removing the temp root. Declared
    // synchronous previously, while every call site passes an async callback, so
    // the finally block ran when the promise was RETURNED rather than when it
    // resolved -- restoring PROJECTS_HOME and deleting the root at the callback's
    // first await. The comment above asserted isolation that the helper did not
    // actually provide.
    async function withTempHome<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
      const root = mkdtempSync(join(tmpdir(), "store-api-loops-"));
      const previous = process.env[PROJECTS_HOME_ENV];
      process.env[PROJECTS_HOME_ENV] = root;
      try {
        return await fn(root);
      } finally {
        if (previous === undefined) delete process.env[PROJECTS_HOME_ENV];
        else process.env[PROJECTS_HOME_ENV] = previous;
        rmSync(root, { recursive: true, force: true });
      }
    }

    test("listLoopLinks returns the rows on disk instead of a hardcoded []", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);
        linkProjectLoop(project, { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" });

        const { store, calls } = stubStore(() => ({}));
        const links = await store.listLoopLinks(project as never);

        expect(links).toHaveLength(1);
        expect(links[0]?.loop_id).toBe("loop_api");
        expect(calls).toHaveLength(0); // read the local file, not the network
      });
    });

    test("inspectAppStore reports exists:true and the real loop_links count", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);
        linkProjectLoop(project, { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" });

        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStore(project as never);

        // The exact pair the audit measured as false/0 on a 5-row store.
        expect(summary.exists).toBe(true);
        expect(summary.counts.loop_links).toBe(1);
      });
    });

    test("inspectAppStore reports a missing store without creating it", async () => {
      await withTempHome(async () => {
        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStore(project as never);

        expect(summary.exists).toBe(false);
        expect(summary.schema_version).toBeNull();
        expect(summary.counts).toEqual({ data_models: 0, data_records: 0, loop_links: 0 });
        expect(existsSync(summary.paths.db_path)).toBe(false);
      });
    });

    test("inspectAppStoreWithLoops surfaces the linked loop, not loops:[]", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);
        linkProjectLoop(project, { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" });

        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStoreWithLoops(project as never, { loopsClient: fakeLoops } as never);

        expect(summary.loops).toHaveLength(1);
        expect(summary.loops?.[0]?.link.loop_id).toBe("loop_api");
      });
    });

    // The instrument must be able to return a genuine zero, or the tests above
    // only prove it always returns rows. An empty store must still read empty.
    test("negative control: an empty store still reports 0 links in the hosted backend", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);

        const { store } = stubStore(() => ({}));
        const summary = await store.inspectAppStore(project as never);

        expect(summary.exists).toBe(true);
        expect(summary.counts.loop_links).toBe(0);
        expect(await store.listLoopLinks(project as never)).toEqual([]);
      });
    });

    // Regression for the write half. Making the app store resolve in the hosted backend
    // also made createDataModel / createDataRecord / linkLoop reachable there,
    // and each routes through withLock(project.id, ...). workspace_locks
    // .workspace_id is FK-constrained to the machine-local `workspaces` table,
    // so an api-created / hosted-only project -- which by definition has no local
    // registry row -- failed with "FOREIGN KEY constraint failed" before ever
    // touching its project.db. The reads this PR fixes were fine; the writes it
    // newly enabled were not.
    //
    // `project` here is deliberately never inserted into the local `workspaces`
    // table, which is exactly the hosted-only shape.
    test("hosted-backend writes succeed for a hosted-only project with no local workspaces row", async () => {
      await withTempHome(async () => {
        ensureProjectStore(project);

        // Precondition: the local registry genuinely has no row for this id, so
        // the test cannot pass by accident on a project that happens to be local.
        expect(getWorkspace(project.id)).toBeNull();

        const { store } = stubStore(() => ({}));

        const link = await store.linkLoop(
          project as never,
          { loop_id: "loop_api", loop_name: "Api Loop", role: "maintenance" } as never,
          { source: "cli" } as never,
        );
        expect(link.loop_id).toBe("loop_api");

        const model = await store.createDataModel(
          project as never,
          { name: "notes", schema: { fields: [] } } as never,
          { source: "cli" } as never,
        );
        expect(model.name).toBe("notes");

        // The write actually landed in the machine-local store, rather than the
        // call merely not throwing.
        expect(await store.listLoopLinks(project as never)).toHaveLength(1);

        // The lock is released, not leaked, so a second write still succeeds.
        const second = await store.createDataModel(
          project as never,
          { name: "notes-2", schema: { fields: [] } } as never,
          { source: "cli" } as never,
        );
        expect(second.name).toBe("notes-2");
      });
    });

  });

  // Regression (todos 9ddd325c): budget READS in the hosted backend were hardcoded
  // `return []` stubs, so hosted-backend callers (budgets list/remaining, the
  // buildProjectAgentContext budget block, budget-check actions, the MCP tool)
  // got zero statuses, zero exhaustion, rc=0, and proceeded with no cap applied
  // while only the write path failed loudly. The hosted server models no budget
  // resource (route() falls through to 404), so reads must reject exactly like
  // createBudget/resetBudget/recordSpend — and must never touch the network.
  test("budget reads reject in the hosted backend instead of returning a hardcoded [] (todos 9ddd325c)", async () => {
    const { store, calls } = stubStore(() => ({}));
    await expect(store.listBudgets()).rejects.toThrow(/local-only operation/i);
    await expect(store.getBudgetStatuses()).rejects.toThrow(/local-only operation/i);
    await expect(store.createBudget({} as never)).rejects.toThrow(/local-only operation/i);
    await expect(store.resetBudget("wks_any")).rejects.toThrow(/local-only operation/i);
    await expect(store.recordSpend({} as never)).rejects.toThrow(/local-only operation/i);
    expect(calls).toHaveLength(0);
  });

  // Regression: resolving "." (or any path/marker target) in the hosted backend must NOT
  // hit the API — the URL parser collapses `/projects/.` to the collection
  // route `/projects/`, returning a LIST payload that then masqueraded as a
  // single project and crashed renderers reading `project.metadata.stage`.
  test("getProject returns null for path-like/relative targets without a network call", async () => {
    const { store, calls } = stubStore(() => ({ workspaces: [{ id: "x", slug: "x" }], count: 1 }));
    for (const target of [".", "..", "./foo", "../bar", "/abs/path", "~/home", "a/b", "C:\\win"]) {
      expect(await store.getProject(target)).toBeNull();
    }
    expect(calls).toHaveLength(0);
    // resolveTarget surfaces a clean not-found rather than a masquerading list.
    await expect(store.resolveTarget(".")).rejects.toThrow(/Project not found/);
  });

  test("resolveTarget verifies an existing canonical workspace path against its stable hosted project id", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-api-context-path-"));
    const previousHome = process.env[PROJECTS_HOME_ENV];
    process.env[PROJECTS_HOME_ENV] = root;
    const projectId = "wks_contextcanonical";
    const canonicalPath = join(root, "workspaces", projectId);
    const wrongPrimaryId = "wks_contextwrongprimary";
    const wrongPrimaryPath = join(root, "workspaces", wrongPrimaryId);
    const wrongIdentityId = "wks_contextwrongidentity";
    const wrongIdentityPath = join(root, "workspaces", wrongIdentityId);
    const noncanonicalPath = join(root, "repos", "context-canonical");
    mkdirSync(canonicalPath, { recursive: true });
    mkdirSync(wrongPrimaryPath, { recursive: true });
    mkdirSync(wrongIdentityPath, { recursive: true });
    mkdirSync(noncanonicalPath, { recursive: true });
    try {
      const cloudProject = {
        id: projectId,
        slug: "context-canonical",
        name: "Context Canonical",
        kind: "project",
        status: "active",
        primary_path: canonicalPath,
        root_id: null,
        recipe_id: null,
        tags: [],
        integrations: {},
        metadata: {},
        last_opened_at: null,
        updated_at: "2026-08-10T00:00:00.000Z",
      };
      const { store, calls } = stubStore((_method, path) => {
        if (path === `/v1/projects/${projectId}`) return cloudProject;
        if (path === `/v1/projects/${wrongPrimaryId}`) {
          return { ...cloudProject, id: wrongPrimaryId, primary_path: noncanonicalPath };
        }
        if (path === `/v1/projects/${wrongIdentityId}`) {
          return { ...cloudProject, primary_path: wrongIdentityPath };
        }
        return {};
      });

      expect(await store.resolveTarget(canonicalPath)).toMatchObject({
        id: projectId,
        slug: "context-canonical",
        primary_path: canonicalPath,
      });
      expect(calls).toEqual([{
        method: "GET",
        path: `/v1/projects/${projectId}`,
        auth: "Bearer secret-key",
      }]);

      await expect(store.resolveTarget(noncanonicalPath)).rejects.toThrow(/Project not found/);
      await expect(store.resolveTarget(join(root, "workspaces", "wks_absentcanonical"))).rejects.toThrow(/Project not found/);
      await expect(store.resolveTarget(canonicalPath, { allowPath: false })).rejects.toThrow(/Project not found/);
      await expect(store.resolveTarget(wrongPrimaryPath)).rejects.toThrow(/Project not found/);
      await expect(store.resolveTarget(wrongIdentityPath)).rejects.toThrow(/Project not found/);
      expect(calls.map((call) => call.path)).toEqual([
        `/v1/projects/${projectId}`,
        `/v1/projects/${wrongPrimaryId}`,
        `/v1/projects/${wrongIdentityId}`,
      ]);
    } finally {
      if (previousHome === undefined) delete process.env[PROJECTS_HOME_ENV];
      else process.env[PROJECTS_HOME_ENV] = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("getProject normalizes null metadata/integrations/tags into safe shapes", async () => {
    const { store } = stubStore(() => ({
      id: "wks_1",
      slug: "iproj-x",
      name: "X",
      metadata: null,
      integrations: null,
      tags: null,
    }));
    const project = await store.getProject("iproj-x");
    expect(project).not.toBeNull();
    expect(project!.metadata).toEqual({});
    expect(project!.integrations).toEqual({});
    expect(project!.tags).toEqual([]);
  });

  test("getProject rejects a list-wrapper payload masquerading as a project", async () => {
    // Even if the server ever returned a collection body for a detail id, the
    // normalizer refuses it (no string id/slug) so it can't crash renderers.
    const { store } = stubStore(() => ({ workspaces: [{ id: "a", slug: "a" }], count: 1 }));
    expect(await store.getProject("iproj-x")).toBeNull();
  });

  test("updateProject surfaces the typed resource-link validation reason from an HTTP 400", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      calls.push({
        method: (init?.method ?? "GET").toUpperCase(),
        path: url.pathname,
      });
      return Response.json({
        error: "integration 'conversations_channel' is a typed resource-link compatibility projection and must be changed through resource-links",
      }, { status: 400 });
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);

    const err = await store.updateProject("wks_typedintegration01", {
      integrations: { conversations_channel: "moved-outside-resource-links" },
    }).catch((error: unknown) => error);
    // The shared @hasna/contracts seam surfaces the server's reason on the
    // error body (structured), not in the message string; the message keeps
    // the seam's standard shape. The seam's bundles are separate entries, so
    // errors are matched by shape (name + status), never by instanceof.
    expect(err).toMatchObject({ name: "HasnaHttpError", status: 400 });
    expect((err as HasnaHttpError).body).toEqual({
      error: "integration 'conversations_channel' is a typed resource-link compatibility projection and must be changed through resource-links",
    });

    expect(calls).toEqual([{
      method: "PATCH",
      path: "/v1/projects/wks_typedintegration01",
    }]);
  });

  test("guardedUpdateProject surfaces the typed resource-link validation reason from an HTTP 400", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      calls.push({
        method: (init?.method ?? "GET").toUpperCase(),
        path: url.pathname,
      });
      return Response.json({
        error: "integration 'conversations_channel' is a typed resource-link compatibility projection and must be changed through resource-links",
      }, { status: 400 });
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);

    const err = await store.guardedUpdateProject({
      project_id: "wks_typedintegration01",
      operation_id: "typed-integration-update",
      step_id: "guarded",
      expected_revision: "2026-08-12 00:00:00.000",
      patch: {
        integrations: { conversations_channel: "moved-outside-resource-links" },
      },
      dry_run: true,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    }).catch((error: unknown) => error);
    expect(err).toMatchObject({ name: "HasnaHttpError", status: 400 });
    expect((err as HasnaHttpError).body).toEqual({
      error: "integration 'conversations_channel' is a typed resource-link compatibility projection and must be changed through resource-links",
    });

    expect(calls).toEqual([{
      method: "POST",
      path: "/v1/projects/wks_typedintegration01/guarded-metadata",
    }]);
  });

  test("guardedReadProject uses the bounded exact-id API route and rejects slugs before transport", async () => {
    const projectId = "wks_guardedread0001";
    const project = {
      id: projectId,
      slug: "guarded-read",
      name: "Guarded Read",
      description: null,
      kind: "generic" as const,
      status: "active" as const,
      root_id: null,
      recipe_id: null,
      canonical_machine: null,
      primary_path: null,
      git_remote: null,
      s3_bucket: null,
      s3_prefix: null,
      tags: [],
      integrations: {},
      metadata: {},
      last_opened_at: null,
      created_at: "2026-08-07 00:00:00",
      updated_at: "2026-08-07 00:00:01",
      synced_at: null,
    };
    const response = {
      ok: true as const,
      project_id: projectId,
      project,
      current_revision: "2026-08-07 00:00:01",
      resource_links: [],
      resource_link_count: 0,
      resource_link_max_items: 1000,
      resource_link_collection_digest: "empty",
      response_control: {
        response_byte_limit: 16_384,
        time_budget_ms: 5_000,
        response_bytes: 512,
        elapsed_ms: 1,
        complete: true,
        truncated: false,
      },
    };
    const { store, calls } = stubStore(() => response);

    await expect(store.guardedReadProject({
      project_id: "guarded-read",
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    })).rejects.toThrow(/complete stable project id/);
    expect(calls).toHaveLength(0);

    const result = await store.guardedReadProject({
      project_id: projectId,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    });
    expect(result).toMatchObject({
      ok: true,
      project_id: projectId,
      project: { id: projectId, slug: "guarded-read" },
      current_revision: "2026-08-07 00:00:01",
      response_control: {
        response_byte_limit: 16_384,
        time_budget_ms: 5_000,
        complete: true,
        truncated: false,
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.path).toBe(
      `/v1/projects/${projectId}/guarded-metadata?response_byte_limit=16384&time_budget_ms=5000`,
    );
  });

  test("typed resource-link methods preserve API routes, bounds, modes, and rollback identity", async () => {
    const projectId = "wks_resourceapi0001";
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(input);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, path: `${url.pathname}${url.search}`, body });
      if (method === "GET" && url.pathname.endsWith("/resource-links")) {
        const collectionDigest = "a".repeat(64);
        return Response.json({
          project_id: projectId,
          current_revision: "revision",
          links: [],
          link_count: 0,
          max_items: 10,
          collection_digest: collectionDigest,
          complete: true,
          truncated: false,
          contract: {
            schema: "hasna.project_resource_link_collection.v1",
            project_id: projectId,
            current_revision: "revision",
            links: [],
            link_count: 0,
            max_items: 10,
            collection_digest: collectionDigest,
            complete: true,
            truncated: false,
          },
        });
      }
      return Response.json({});
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);
    const link = {
      authority: "conversations" as const,
      service_instance: "urn:hasna:conversations:test",
      source_package: "@hasna/conversations" as const,
      target_kind: "channel" as const,
      locator: {
        kind: "conversations_channel_id" as const,
        value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      },
      scope: "resource" as const,
      labels: { channel_name: "resource-api" },
    };
    const mutation = {
      project_id: projectId,
      operation_id: "resource-api",
      step_id: "links",
      mode: "add" as const,
      expected_revision: "revision",
      links: [link],
      integrations: {
        conversations_channel: "resource-api",
        todos_project_id: "td_project_resource_api",
        todos_task_list_id: "td_task_list_resource_api",
        mementos_project_id: "mm_project_resource_api",
      },
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };

    await store.readProjectResourceLinks({
      project_id: projectId,
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    await store.mutateProjectResourceLinks(mutation);
    await store.rollbackProjectResourceLinks({
      project_id: projectId,
      operation_id: "resource-api-rollback",
      step_id: "rollback-links",
      accepted_receipt_id: "gpmr_resource_api",
      expected_current_revision: "revision-2",
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      [
        "GET",
        `/v1/projects/${projectId}/resource-links?max_items=10&response_byte_limit=100000&time_budget_ms=5000`,
      ],
      ["POST", `/v1/projects/${projectId}/resource-links/add`],
      ["POST", `/v1/projects/${projectId}/resource-links/rollback`],
    ]);
    expect(calls[1]?.body).toEqual(mutation);
    expect(calls[2]?.body).toEqual(expect.objectContaining({
      accepted_receipt_id: "gpmr_resource_api",
    }));
  });

  test("resource-link migration methods preserve API routes, bounds, manifest identity, and CAS bodies", async () => {
    const projectId = "wks_resourcemigration01";
    const manifestId = "prlm_resource_migration";
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(input);
      calls.push({
        method,
        path: `${url.pathname}${url.search}`,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return Response.json({});
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);
    const plan = {
      project_id: projectId,
      operation_id: "resource-migration",
      step_id: "plan",
      expected_project_revision: "revision-1",
      links: [{
        link: {
          authority: "contacts" as const,
          service_instance: "urn:hasna:contacts:test",
          source_package: "@hasna/contacts" as const,
          target_kind: "contact" as const,
          locator: {
            kind: "external_uuid" as const,
            value: "6b68e131-abe5-43b7-92cd-9930b04611df",
          },
          scope: "resource" as const,
        },
        producer_resource_kind: "contact",
        producer_binding: {
          authority_id: "contacts",
          tenant_id: "tenant-primary",
          corpus_id: null,
          capability_digest: "sha256:contacts-capability",
        },
      }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const advance = {
      project_id: projectId,
      manifest_id: manifestId,
      expected_transition_version: 1,
      next_state: "producer_applied" as const,
      max_items: 10,
      producer_evidence: [{
        created_by_operation: true,
        forward_receipt_id: "contacts-receipt-1",
        child_link_receipt_ids: [],
        target_revision: "contacts-revision-1",
        target_digest: "contacts-digest-1",
        inverse_verified: false,
        inverse_outcome: "pending",
      }],
      evidence: { phase: "producer" },
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const rollback = {
      project_id: projectId,
      manifest_id: manifestId,
      expected_transition_version: 2,
      max_items: 10,
      producer_outcome: "pending" as const,
      producer_evidence: [{
        ...advance.producer_evidence[0]!,
        target_revision: "contacts-revision-2",
        target_digest: "contacts-digest-2",
        inverse_verified: true,
        inverse_outcome: "complete",
      }],
      evidence: { reason: "test" },
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };

    await store.planProjectResourceLinkMigration(plan);
    await store.readProjectResourceLinkMigration({
      project_id: projectId,
      manifest_id: manifestId,
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    await store.advanceProjectResourceLinkMigration(advance);
    await store.rollbackProjectResourceLinkMigration(rollback);

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/plan`],
      [
        "GET",
        `/v1/projects/${projectId}/resource-link-migrations/${manifestId}?max_items=10&response_byte_limit=100000&time_budget_ms=5000`,
      ],
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/${manifestId}/advance`],
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/${manifestId}/rollback`],
    ]);
    expect(calls[0]?.body).toEqual(plan);
    expect(calls[2]?.body).toEqual(advance);
    expect(calls[3]?.body).toEqual(rollback);
  });

  test("resource-link POST retries an ambiguous transport outcome with one stable idempotency key", async () => {
    const projectId = "wks_resourceapiretry01";
    const requests: Array<{ path: string; idempotencyKey: string | null }> = [];
    let attempt = 0;
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      const headers = new Headers(init?.headers);
      requests.push({
        path: url.pathname,
        idempotencyKey: headers.get("idempotency-key"),
      });
      attempt += 1;
      if (attempt === 1) {
        throw new Error("connection closed after server commit");
      }
      return Response.json({
        ok: true,
        outcome: "duplicate_of_accepted",
      });
    };
    __resetProjectStore();
    const store = resolveProjectStore(CLOUD_ENV, fetchImpl);

    const result = await store.mutateProjectResourceLinks({
      project_id: projectId,
      operation_id: "resource-api-retry",
      step_id: "projects-resource-link",
      mode: "add",
      expected_revision: "revision-1",
      links: [{
        authority: "contacts",
        service_instance: "urn:hasna:contacts:service:primary",
        source_package: "@hasna/contacts",
        target_kind: "contact",
        locator: {
          kind: "external_uuid",
          value: "6b68e131-abe5-43b7-92cd-9930b04611df",
        },
        scope: "resource",
      }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });

    expect(result.outcome).toBe("duplicate_of_accepted");
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.path)).toEqual([
      `/v1/projects/${projectId}/resource-links/add`,
      `/v1/projects/${projectId}/resource-links/add`,
    ]);
    expect(requests[0]!.idempotencyKey).toMatch(/^gpm_[0-9a-f]{48}$/);
    expect(requests[1]!.idempotencyKey).toBe(requests[0]!.idempotencyKey);
  });
});

// Regression for dc3ba294: the projects API hard-caps every list response at
// 1000 rows and the client issued exactly one un-offset request, so
// `projects list --json` silently returned 939 of 2399 registry rows with
// rc=0, an empty stderr and no count/cursor a caller could inspect. The store
// MUST walk the pages itself, MUST NOT assume the cap is 1000, and MUST make a
// bounded result detectable rather than silent.
describe("projects list pagination (server row cap)", () => {
  const CLOUD_ENV = {
    HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
    HASNA_PROJECTS_API_KEY: "secret-key",
  };

  /**
   * A fake registry that behaves like the deployed server: it clamps any
   * requested limit to `cap`, defaults to `defaultLimit` when none is sent,
   * honours `offset`, and reports the complete total/offset contract required
   * for a migration to prove that its inventory is complete.
   */
  function fakeRegistry(options: { total: number; cap: number; defaultLimit?: number; ignoreOffset?: boolean }) {
    const rows = Array.from({ length: options.total }, (_, i) => ({
      id: `wks_${String(i).padStart(5, "0")}`,
      slug: `proj-${String(i).padStart(5, "0")}`,
      name: `Project ${i}`,
      status: "active",
      tags: [],
      metadata: {},
      integrations: {},
    }));
    const requests: Array<{ limit: string | null; offset: string | null }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname !== "/v1/projects" || (init?.method ?? "GET").toUpperCase() !== "GET") {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      const q = url.searchParams;
      requests.push({ limit: q.get("limit"), offset: q.get("offset") });
      const requested = q.get("limit") ? Number(q.get("limit")) : (options.defaultLimit ?? 100);
      const limit = Math.min(Math.max(requested, 1), options.cap);
      const offset = options.ignoreOffset ? 0 : Math.max(Number(q.get("offset") ?? 0), 0);
      const page = rows.slice(offset, offset + limit);
      return new Response(JSON.stringify({
        workspaces: page,
        count: page.length,
        total: rows.length,
        offset,
        limit,
        has_more: offset + page.length < rows.length,
        complete: offset === 0 && offset + page.length === rows.length,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    __resetProjectStore();
    return { store: resolveProjectStore(CLOUD_ENV, fetchImpl), requests, rows };
  }

  test("no explicit limit returns every row, not the server's capped page", async () => {
    const { store, requests } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects();
    expect(projects).toHaveLength(2399);
    expect(new Set(projects.map((p) => p.id)).size).toBe(2399);
    expect(projects.at(-1)!.slug).toBe("proj-02398");
    // walked the pages rather than trusting one response
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.map((r) => r.offset)).toEqual(["0", "1000", "2000"]);
  });

  test("a status filter is paginated too (the cap applies to filtered queries)", async () => {
    const { store } = fakeRegistry({ total: 2360, cap: 1000 });
    const projects = await store.listProjects({ status: "active" });
    expect(projects).toHaveLength(2360);
  });

  test("the page stride is learned from the response, not hardcoded to 1000", async () => {
    const { store, requests } = fakeRegistry({ total: 640, cap: 250 });
    const projects = await store.listProjects();
    expect(projects).toHaveLength(640);
    // 640 rows at a 250-row cap: the page at offset 500 comes back short (140),
    // which is the tail signal — no fourth request is needed.
    expect(requests.map((r) => r.offset)).toEqual(["0", "250", "500"]);
  });

  test("a total that is an exact multiple of the cap still terminates and is complete", async () => {
    const { store } = fakeRegistry({ total: 2000, cap: 1000 });
    const projects = await store.listProjects();
    expect(projects).toHaveLength(2000);
  });

  test("an explicit limit under the cap is honoured in a single request", async () => {
    const { store, requests } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects({ limit: 50 });
    expect(projects).toHaveLength(50);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ limit: "50" });
  });

  test("an explicit limit above the cap is honoured by paginating, not clamped", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects({ limit: 1500 });
    expect(projects).toHaveLength(1500);
  });

  test("an explicit offset is respected as the starting point", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000 });
    const projects = await store.listProjects({ offset: 2390 });
    expect(projects).toHaveLength(9);
    expect(projects[0]!.slug).toBe("proj-02390");
  });

  test("a server that ignores offset fails loudly instead of truncating silently", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000, ignoreOffset: true });
    await expect(store.listProjects()).rejects.toThrow(/offset/i);
  });

  test("listProjectsPage exposes total and has_more so a bounded read is detectable", async () => {
    const { store } = fakeRegistry({ total: 2399, cap: 1000 });
    const page = await store.listProjectsPage({ limit: 25 });
    expect(page.projects).toHaveLength(25);
    expect(page.total).toBe(2399);
    expect(page.has_more).toBe(true);
    expect(page.complete).toBe(false);

    const all = await store.listProjectsPage();
    expect(all.projects).toHaveLength(2399);
    expect(all.total).toBe(2399);
    expect(all.has_more).toBe(false);
    expect(all.complete).toBe(true);
  });
});

// Regression d731c1f8: the local store's listEvents named its limit parameter
// `_limit` and never applied it, returning the project's full history in
// created_at ASC order. The api transport bounds (DESC LIMIT) and returns
// newest-first, so buildProjectAgentContext/buildProjectHandoff took the HEAD
// of the list — on the local transport an agent received the project's oldest
// creation-era events as its "recent events" and the limit was a no-op.
describe("local store listEvents (transport parity)", () => {
  test("a limit bounds and reverses newest-first; no limit stays full ASC", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-list-events-"));
    const previousHome = process.env[PROJECTS_HOME_ENV];
    process.env[PROJECTS_HOME_ENV] = root;
    closeDatabase();
    __resetProjectStore();
    try {
      const store = localFixtureStore();
      const project = await store.createProject({ name: "Local Events Parity", slug: "local-events-parity" });
      const recorded = [
        await store.recordEvent(project.id, { event_type: "note", source: "cli", metadata: { n: 1 } }),
        await store.recordEvent(project.id, { event_type: "started", source: "cli", metadata: { n: 2 } }),
        await store.recordEvent(project.id, { event_type: "updated", source: "cli", metadata: { n: 3 } }),
        await store.recordEvent(project.id, { event_type: "created", source: "cli", metadata: { n: 4 } }),
      ];

      // No limit: full history in db (ASC) order — unchanged for the callers
      // that depend on ascending order (workspace-agent, .at(-1) last-started).
      // createProject records its own implicit "created" event, so the full
      // list is the recorded events plus that oldest one.
      const all = await store.listEvents(project.id);
      expect(all.length).toBeGreaterThanOrEqual(recorded.length);
      for (const event of recorded) {
        expect(all.some((e) => e.id === event.id)).toBe(true);
      }
      expect(all[0]!.event_type).toBe("created");

      // Limit: exactly N events, the newest N, newest-first — the api
      // transport's contract (ORDER BY created_at DESC LIMIT).
      const limited = await store.listEvents(project.id, 2);
      expect(limited).toHaveLength(2);
      expect(limited.map((e) => e.id)).toEqual(all.slice(-2).reverse().map((e) => e.id));
      const timestamps = limited.map((e) => e.created_at);
      expect(timestamps).toEqual([...timestamps].sort().reverse());

      const single = await store.listEvents(project.id, 1);
      expect(single).toHaveLength(1);
      expect(single[0]!.id).toBe(all.at(-1)!.id);
    } finally {
      closeDatabase();
      __resetProjectStore();
      if (previousHome === undefined) delete process.env[PROJECTS_HOME_ENV];
      else process.env[PROJECTS_HOME_ENV] = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
