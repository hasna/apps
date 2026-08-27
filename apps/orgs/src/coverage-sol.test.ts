// Sol-guided coverage suite (2026-08-19, tests-coverage-sol workflow, lane: orgs).
// Guidance source: gpt-5.6-sol at xhigh — five priorities: node discrimination and
// graph validation; atomic store mutation and locks; slug, routing, and init;
// snapshots and delegation; CLI public commands and failures.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPEN_ORGS_AUDIT_ENV,
  OPEN_ORGS_STORE_ENV,
  JsonOrgStore,
  collectionForKind,
  createAgentSnapshot,
  createRelationshipRecord,
  formatAgentSnapshotMarkdown,
  getOrgAuditPath,
  getOrgStorePath,
  kindForNode,
  nodeRefFor,
  normalizeGraphData,
  resolveDelegationTargets,
  slugify,
  validateGraphData,
  type GraphNode,
  type OrgGraphData,
} from "./index.js";
import { runCli } from "./cli.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "orgs-sol-"));
  process.exitCode = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  process.exitCode = 0;
});

function storePath(name = "orgs.json"): string {
  return join(dir, name);
}

function newStore(name = "orgs.json", auditName = "audit.jsonl"): JsonOrgStore {
  return new JsonOrgStore({ filePath: storePath(name), auditPath: join(dir, auditName) });
}

// ---------------------------------------------------------------------------
// Priority 1 — node discrimination and graph validation
// ---------------------------------------------------------------------------

describe("node discrimination", () => {
  const BASE = {
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  test("kindForNode resolves each node kind to exactly one kind, including the org fallback", () => {
    const data = normalizeGraphData({
      orgs: [
        { id: "org_fallback", name: "Fallback Org" },
        { id: "org_ref", name: "Ref Org", identityRef: { system: "identities", kind: "organization", id: "ref-org" } },
      ],
      teams: [{ id: "team_x", name: "Team X", orgId: "org_fallback", functionIds: [] }],
      functions: [{ id: "func_x", name: "Func X", orgId: "org_fallback", capabilityIds: [] }],
      roles: [{ id: "role_x", name: "Role X", orgId: "org_fallback", requiredCapabilities: [] }],
      members: [{
        id: "mem_x",
        name: "Member X",
        orgId: "org_fallback",
        kind: "agent",
        identityRef: { system: "identities", kind: "agent", id: "mem-x" },
      }],
      projects: [{ id: "proj_x", name: "Proj X", orgId: "org_fallback", projectRef: { system: "projects", kind: "workspace", id: "proj-x" } }],
      machines: [{ id: "mach_x", name: "Mach X", orgId: "org_fallback", machineRef: { system: "machines", kind: "machine", id: "mach-x" } }],
      capabilities: [{ id: "cap_x", name: "Cap X", orgId: "org_fallback", namespace: "repo", key: "review" }],
    });

    const expectations: Array<[GraphNode, string]> = [
      [data.orgs[0], "org"],
      [data.orgs[1], "org"],
      [data.teams[0], "team"],
      [data.functions[0], "function"],
      [data.roles[0], "role"],
      [data.members[0], "member"],
      [data.projects[0], "project"],
      [data.machines[0], "machine"],
      [data.capabilities[0], "capability"],
    ];
    for (const [node, kind] of expectations) {
      expect(kindForNode(node), `kindForNode for ${node.id}`).toBe(kind);
      expect(nodeRefFor(node).kind, `nodeRefFor for ${node.id}`).toBe(kind);
      expect(nodeRefFor(node).id, `nodeRefFor id for ${node.id}`).toBe(node.id);
      const collection = collectionForKind(kind);
      expect(data[collection].some((record) => record.id === node.id), `${kind} round-trips to ${collection}`).toBe(true);
    }
  });

  test("a bare record with no discriminating field classifies as the org fallback", () => {
    const bare = { id: "bare_1", slug: "bare", name: "Bare", ...BASE };
    expect(kindForNode(bare)).toBe("org");
  });

  test("store add/get relationship endpoints resolve every node kind and reject wrong kinds", async () => {
    const store = newStore();
    const org = await store.createOrg({ id: "org_r", name: "Root" });
    const team = await store.createTeam({ id: "team_r", orgId: org.id, name: "Team" });
    const func = await store.createFunction({ id: "func_r", orgId: org.id, name: "Function" });
    const role = await store.createRole({ id: "role_r", orgId: org.id, name: "Role" });
    const member = await store.createMember({ id: "mem_r", orgId: org.id, kind: "agent", name: "Member", identityRef: { system: "identities", kind: "agent", id: "mem-r" } });
    const project = await store.createProject({ id: "proj_r", orgId: org.id, name: "Project", projectRef: { system: "projects", kind: "workspace", id: "proj-r" } });
    const machine = await store.createMachine({ id: "mach_r", orgId: org.id, name: "Machine", machineRef: { system: "machines", kind: "machine", id: "mach-r" } });
    const capability = await store.createCapability({ id: "cap_r", orgId: org.id, namespace: "repo", key: "review" });

    const nodes = [org, team, func, role, member, project, machine, capability];
    for (const node of nodes) {
      const resolved = await store.getNode(node.id);
      expect(resolved, `getNode ${node.id}`).toBeDefined();
      expect(kindForNode(resolved!), `kindForNode for stored ${node.id}`).toBe(kindForNode(node));
      const relationship = await store.createRelationship({
        kind: "custom",
        source: nodeRefFor(node),
        target: nodeRefFor(member),
      });
      expect(relationship.source.kind).toBe(kindForNode(node));
      expect(relationship.source.id).toBe(node.id);
      expect(relationship.target.kind).toBe("member");
    }

    // A wrong declared kind must fail validation — the endpoint would otherwise corrupt.
    await expect(store.createRelationship({
      kind: "custom",
      source: { kind: "member", id: team.id },
      target: { kind: "member", id: member.id },
    })).rejects.toThrow(/wrong kind/);
  });

  test("reports_to with a non-member source or target is an error with the exact category", () => {
    const data = normalizeGraphData({
      orgs: [{ id: "org_v", name: "V" }],
      members: [{
        id: "mem_a",
        name: "A",
        orgId: "org_v",
        kind: "agent",
        identityRef: { system: "identities", kind: "agent", id: "a" },
      }],
      teams: [{ id: "team_v", name: "Team", orgId: "org_v" }],
      relationships: [
        {
          id: "rel_src_bad",
          slug: "src-bad",
          kind: "reports_to",
          source: { kind: "team", id: "team_v" },
          target: { kind: "member", id: "mem_a" },
          authority: "none",
          scope: [],
          allowedActions: [],
          deniedActions: [],
          provenance: { source: "test", observedAt: "2026-01-01T00:00:00.000Z" },
          confidence: 1,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "rel_tgt_bad",
          slug: "tgt-bad",
          kind: "reports_to",
          source: { kind: "member", id: "mem_a" },
          target: { kind: "team", id: "team_v" },
          authority: "none",
          scope: [],
          allowedActions: [],
          deniedActions: [],
          provenance: { source: "test", observedAt: "2026-01-01T00:00:00.000Z" },
          confidence: 1,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const result = validateGraphData(data);
    expect(result.valid).toBe(false);
    const byCode = new Map(result.issues.map((issue) => [issue.code, issue]));
    expect(byCode.get("invalid_reports_to_source")?.message).toBe("reports_to source must be a member: rel_src_bad");
    expect(byCode.get("invalid_reports_to_target")?.message).toBe("reports_to target must be a member: rel_tgt_bad");
    expect(byCode.get("invalid_reports_to_source")?.level).toBe("error");
    expect(byCode.get("invalid_reports_to_target")?.level).toBe("error");
  });

  test("the store rejects reports_to edges between non-members at add time", async () => {
    const store = newStore();
    const org = await store.createOrg({ name: "Reports Org" });
    const team = await store.createTeam({ orgId: org.id, name: "Reports Team" });
    await expect(store.createRelationship({
      kind: "reports_to",
      source: { kind: "team", id: team.id },
      target: { kind: "team", id: team.id },
    })).rejects.toThrow(/reports_to source must be a member/);
  });

  test("missing scope references are errors with exact per-kind categories", () => {
    const data = normalizeGraphData({
      orgs: [{ id: "org_v", name: "V" }],
      members: [{ id: "mem_a", name: "A", orgId: "org_v", kind: "agent", identityRef: { system: "identities", kind: "agent", id: "a" } }],
      relationships: [{
        id: "rel_scope",
        slug: "scope",
        kind: "custom",
        source: { kind: "member", id: "mem_a" },
        target: { kind: "member", id: "mem_a" },
        authority: "none",
        scope: [
          { orgId: "org_ghost" },
          { teamId: "team_ghost" },
          { functionId: "func_ghost" },
          { projectId: "proj_ghost" },
          { machineId: "mach_ghost" },
          { capabilityId: "cap_ghost" },
        ],
        allowedActions: [],
        deniedActions: [],
        provenance: { source: "test", observedAt: "2026-01-01T00:00:00.000Z" },
        confidence: 1,
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    const result = validateGraphData(data);
    expect(result.valid).toBe(false);
    const codes = result.issues.map((issue) => issue.code);
    for (const code of ["missing_scope_org", "missing_scope_team", "missing_scope_function", "missing_scope_project", "missing_scope_machine", "missing_scope_capability"]) {
      expect(codes, code).toContain(code);
    }
    expect(result.issues.find((issue) => issue.code === "missing_scope_org")?.message).toBe("Missing scoped org org_ghost");
  });

  test("missing required capabilities on roles are errors scoped to the org", () => {
    const data = normalizeGraphData({
      orgs: [{ id: "org_v", name: "V" }],
      capabilities: [{ id: "cap_existing", name: "Existing", orgId: "org_v", namespace: "repo", key: "review" }],
      roles: [{
        id: "role_x",
        name: "Role X",
        orgId: "org_v",
        responsibilities: [],
        requiredCapabilities: ["repo:review", "deploy:prod"],
      }],
    });
    const result = validateGraphData(data);
    expect(result.valid).toBe(false);
    const issues = result.issues.filter((issue) => issue.code === "missing_required_capability");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe("Missing capability deploy:prod in org org_v");
    expect(issues[0].level).toBe("error");
  });

  test("error versus warning categories are exact, not merely non-empty", () => {
    const now = "2026-08-17T12:00:00.000Z";
    const data = normalizeGraphData({
      orgs: [{ id: "org_v", name: "V" }],
      members: [{
        id: "mem_a",
        name: "A",
        orgId: "org_v",
        kind: "agent",
        identityRef: { system: "identities", kind: "agent", id: "a", stale: true },
      }],
      capabilities: [{ id: "cap_v", name: "Cap", orgId: "org_v", namespace: "repo", key: "review" }],
      relationships: [{
        id: "rel_lifetime",
        slug: "lifetime",
        kind: "delegates_to",
        source: { kind: "member", id: "mem_a" },
        target: { kind: "member", id: "mem_a" },
        authority: "none",
        scope: [{ capabilityId: "cap_v" }],
        allowedActions: [],
        deniedActions: [],
        validFrom: "2026-08-18T00:00:00.000Z",
        expiresAt: "2026-08-17T00:00:00.000Z",
        provenance: { source: "test", observedAt: "2026-01-01T00:00:00.000Z" },
        confidence: 1,
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    const result = validateGraphData(data, now);
    const byCode = new Map(result.issues.map((issue) => [issue.code, issue]));
    expect(byCode.get("invalid_relationship_lifetime")?.level).toBe("error");
    expect(byCode.get("invalid_relationship_lifetime")?.message).toBe("Relationship validFrom is after expiresAt: rel_lifetime");
    expect(byCode.get("stale_external_ref")?.level).toBe("warning");
    expect(byCode.get("inactive_relationship")?.level).toBe("warning");
    // The lifetime error flips validity; the warnings alone never would (covered below).
    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.level === "error").map((issue) => issue.code)).toEqual(["invalid_relationship_lifetime"]);
  });
});

// ---------------------------------------------------------------------------
// Priority 2 — atomic store mutation and locks
// ---------------------------------------------------------------------------

describe("atomic store mutation", () => {
  test("a rejected replaceAll leaves the store and audit byte-for-byte unchanged", async () => {
    const store = newStore();
    await store.createOrg({ name: "Original" });
    const rawBefore = await readFile(store.filePath);
    const auditBefore = await readFile(store.auditPath);

    const invalid = normalizeGraphData({
      version: 1,
      orgs: [{ id: "org_a", slug: "a", name: "A", metadata: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      members: [{
        id: "mem_x",
        slug: "x",
        name: "X",
        displayName: "X",
        orgId: "org_nowhere",
        kind: "agent",
        identityRef: { system: "identities", kind: "agent", id: "x" },
        roleIds: [], teamIds: [], functionIds: [], capabilities: [], responsibilities: [],
        status: "active",
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    await expect(store.replaceAll(invalid)).rejects.toThrow(/Missing org for member mem_x/);

    const rawAfter = await readFile(store.filePath);
    const auditAfter = await readFile(store.auditPath);
    expect(rawAfter.equals(rawBefore)).toBe(true);
    expect(auditAfter.equals(auditBefore)).toBe(true);
  });

  test("removeRelationship works by id, by slug, and by case-insensitive slug — exactly one removed, persisted, audited", async () => {
    const store = newStore();
    const org = await store.createOrg({ name: "Remove Org" });
    const one = await store.createMember({ orgId: org.id, kind: "agent", name: "One", identityRef: { system: "identities", kind: "agent", id: "one" } });
    const two = await store.createMember({ orgId: org.id, kind: "agent", name: "Two", identityRef: { system: "identities", kind: "agent", id: "two" } });
    const three = await store.createMember({ orgId: org.id, kind: "agent", name: "Three", identityRef: { system: "identities", kind: "agent", id: "three" } });

    const byId = await store.createRelationship({ id: "rel_by_id", kind: "delegates_to", source: { kind: "member", id: one.id }, target: { kind: "member", id: two.id } });
    const bySlug = await store.createRelationship({ slug: "rel-by-slug", kind: "delegates_to", source: { kind: "member", id: two.id }, target: { kind: "member", id: three.id } });
    const byCase = await store.createRelationship({ slug: "rel-by-case", kind: "delegates_to", source: { kind: "member", id: three.id }, target: { kind: "member", id: one.id } });
    expect(await store.list("relationships")).toHaveLength(3);

    expect(await store.removeRelationship(byId.id)).toBe(true);
    expect(await store.list("relationships")).toHaveLength(2);

    expect(await store.removeRelationship(bySlug.slug)).toBe(true);
    expect(await store.list("relationships")).toHaveLength(1);

    expect(await store.removeRelationship(byCase.slug.toUpperCase())).toBe(true);
    expect(await store.list("relationships")).toHaveLength(0);

    // Persisted: re-read from disk.
    const persisted = JSON.parse(await readFile(store.filePath, "utf8")) as OrgGraphData;
    expect(persisted.relationships).toHaveLength(0);

    const audit = (await readFile(store.auditPath, "utf8")).trim().split("\n");
    const removals = audit.filter((line) => line.includes('"action":"remove-relationship"'));
    expect(removals).toHaveLength(3);
  });

  test("a failed removeRelationship preserves bytes and appends no audit line", async () => {
    const store = newStore();
    const org = await store.createOrg({ name: "Keep Org" });
    const rawBefore = await readFile(store.filePath);
    const auditBefore = await readFile(store.auditPath);

    expect(await store.removeRelationship("rel_does_not_exist")).toBe(false);
    expect(await store.removeRelationship("rel_does_not_exist".toUpperCase())).toBe(false);

    const rawAfter = await readFile(store.filePath);
    const auditAfter = await readFile(store.auditPath);
    expect(rawAfter.equals(rawBefore)).toBe(true);
    expect(auditAfter.equals(auditBefore)).toBe(true);
    expect((await store.exportData()).orgs.map((item) => item.id)).toEqual([org.id]);
  });

  test("in-process mutations are serialized: concurrent adds lose nothing", async () => {
    const store = newStore();
    const names = Array.from({ length: 12 }, (_, index) => `Serial Org ${index}`);
    await Promise.all(names.map((name) => store.createOrg({ name })));
    const data = await store.exportData();
    expect(data.orgs.map((org) => org.name).sort()).toEqual([...names].sort());
    expect(data.orgs).toHaveLength(12);
    // The persisted file must parse as valid JSON after the concurrent burst.
    const persisted = JSON.parse(await readFile(store.filePath, "utf8")) as OrgGraphData;
    expect(persisted.orgs).toHaveLength(12);
  });
});

describe("store lock ownership", () => {
  test("a stale lock with a dead pid and a matching id is reaped and the next acquire succeeds", async () => {
    const store = newStore();
    const org = await store.createOrg({ name: "Seed" });
    const lockPath = `${store.filePath}.lock`;
    await writeFile(lockPath, JSON.stringify({ id: "stale-id", pid: 9_999_999, createdAt: "2026-01-01T00:00:00.000Z", store: store.filePath }), "utf8");
    const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
    await utimes(lockPath, sixMinutesAgo, sixMinutesAgo);

    const second = await store.createOrg({ name: "After Reap" });
    expect((await store.exportData()).orgs.map((item) => item.id).sort()).toEqual([org.id, second.id].sort());
    expect(existsSync(lockPath)).toBe(false);
  });

  test("locks that can never be reclaimed are left in place and time out with the documented error", async () => {
    const liveStore = newStore("live.json", "live-audit.jsonl");
    const unreadableStore = newStore("unreadable.json", "unreadable-audit.jsonl");
    const noIdStore = newStore("noid.json", "noid-audit.jsonl");

    // 1. A live pid (this process) with a fresh lock file is never reaped.
    const liveLock = `${liveStore.filePath}.lock`;
    await writeFile(liveLock, JSON.stringify({ id: "live-lock", pid: process.pid, createdAt: new Date().toISOString(), store: liveStore.filePath }), "utf8");

    // 2. Unreadable lock content is never removed, even when the file is stale.
    const unreadableLock = `${unreadableStore.filePath}.lock`;
    await writeFile(unreadableLock, "not-json{{{", "utf8");
    const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
    await utimes(unreadableLock, sixMinutesAgo, sixMinutesAgo);

    // 3. A stale lock carrying a pid but no id is never removed (removal is id-owned).
    const noIdLock = `${noIdStore.filePath}.lock`;
    await writeFile(noIdLock, JSON.stringify({ pid: 9_999_999, createdAt: "2026-01-01T00:00:00.000Z", store: noIdStore.filePath }), "utf8");
    await utimes(noIdLock, sixMinutesAgo, sixMinutesAgo);

    const results = await Promise.allSettled([
      liveStore.createOrg({ name: "Live" }),
      unreadableStore.createOrg({ name: "Unreadable" }),
      noIdStore.createOrg({ name: "NoId" }),
    ]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      const reason = (result as PromiseRejectedResult).reason as Error;
      expect(reason.message).toMatch(/Timed out waiting for org store lock/);
    }
    expect(await readFile(liveLock, "utf8")).toContain('"pid":');
    expect(await readFile(unreadableLock, "utf8")).toBe("not-json{{{");
    expect(JSON.parse(await readFile(noIdLock, "utf8"))).toMatchObject({ pid: 9_999_999 });
    // No mutation landed while the lock was never granted.
    expect(existsSync(liveStore.filePath)).toBe(false);
    expect(existsSync(unreadableStore.filePath)).toBe(false);
    expect(existsSync(noIdStore.filePath)).toBe(false);
  }, { timeout: 60_000 });
});

// ---------------------------------------------------------------------------
// Priority 3 — slug, routing, and init
// ---------------------------------------------------------------------------

describe("slug, routing, and init", () => {
  test("slugify folds case, strips quotes and apostrophes, collapses runs, trims dashes", () => {
    expect(slugify("O'Brien's Team")).toBe("obriens-team");
    expect(slugify('  "A"  ')).toBe("a");
    expect(slugify("A---B___C----")).toBe("a-b-c");
  });

  test("slugify rejects empty and quote-only values with the documented message", () => {
    for (const value of ["", "   ", "'''", '"""', "''''''", "!!!"]) {
      expect(() => slugify(value), JSON.stringify(value)).toThrow(/Cannot create slug from empty value/);
    }
  });

  test("OPEN_ORGS_STORE and OPEN_ORGS_AUDIT overrides are honored by getters, status, and init preservation", async () => {
    const storeOverride = join(dir, "env", "orgs.json");
    const auditOverride = join(dir, "env", "audit.jsonl");
    const previousStore = process.env[OPEN_ORGS_STORE_ENV];
    const previousAudit = process.env[OPEN_ORGS_AUDIT_ENV];
    try {
      process.env[OPEN_ORGS_STORE_ENV] = storeOverride;
      process.env[OPEN_ORGS_AUDIT_ENV] = auditOverride;
      expect(getOrgStorePath()).toBe(storeOverride);
      expect(getOrgAuditPath()).toBe(auditOverride);

      const store = new JsonOrgStore();
      expect(store.filePath).toBe(storeOverride);
      expect(store.auditPath).toBe(auditOverride);

      await store.init();
      const org = await store.createOrg({ name: "Env Org" });
      const status = await store.status();
      expect(status.env).toMatchObject({
        primary: OPEN_ORGS_STORE_ENV,
        audit: OPEN_ORGS_AUDIT_ENV,
        activeStoreOverride: true,
        activeAuditOverride: true,
      });
      expect(status.dataDir).toBe(join(dir, "env"));

      // init on an existing store preserves data.
      await store.init();
      await store.init();
      expect((await store.exportData()).orgs.map((item) => item.id)).toEqual([org.id]);
    } finally {
      if (previousStore === undefined) delete process.env[OPEN_ORGS_STORE_ENV];
      else process.env[OPEN_ORGS_STORE_ENV] = previousStore;
      if (previousAudit === undefined) delete process.env[OPEN_ORGS_AUDIT_ENV];
      else process.env[OPEN_ORGS_AUDIT_ENV] = previousAudit;
    }

    // With no overrides, status reports them inactive.
    const plain = new JsonOrgStore({ filePath: storePath("plain.json"), auditPath: join(dir, "plain-audit.jsonl") });
    await plain.init();
    const plainStatus = await plain.status();
    expect(plainStatus.env).toMatchObject({ activeStoreOverride: false, activeAuditOverride: false });
  });
});

// ---------------------------------------------------------------------------
// Priority 4 — snapshots and delegation
// ---------------------------------------------------------------------------

describe("snapshot markdown and reporting paths", () => {
  const NOW = "2026-08-17T12:00:00.000Z";
  const BASE = {
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  function member(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      slug: id,
      name: id,
      displayName: id,
      orgId: "org_main",
      kind: "agent",
      identityRef: { system: "identities", kind: "agent", id },
      roleIds: [],
      teamIds: [],
      functionIds: [],
      capabilities: [],
      responsibilities: [],
      status: "active",
      ...BASE,
      ...extra,
    };
  }

  function machine(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      slug: id,
      name: id,
      orgId: "org_main",
      machineRef: { system: "machines", kind: "machine", id },
      assignedMemberIds: [],
      assignedTeamIds: [],
      projectIds: [],
      capabilityIds: [],
      ...BASE,
      ...extra,
    };
  }

  function relationship(id: string, kind: string, source: { kind: string; id: string }, target: { kind: string; id: string }, extra: Record<string, unknown> = {}) {
    return {
      id,
      slug: id,
      kind,
      source,
      target,
      authority: "none",
      scope: [],
      allowedActions: [],
      deniedActions: [],
      provenance: { source: "test", observedAt: NOW },
      confidence: 1,
      ...BASE,
      ...extra,
    };
  }

  function graph(overrides: Partial<OrgGraphData> = {}): OrgGraphData {
    return normalizeGraphData({
      orgs: [{ id: "org_main", name: "Main" }],
      teams: [],
      functions: [],
      roles: [],
      members: [],
      projects: [],
      machines: [],
      capabilities: [],
      relationships: [],
      ...overrides,
    });
  }

  test("an empty member snapshot renders exact '- None' rows and no policy or warning sections", () => {
    const snapshot = createAgentSnapshot(graph({ members: [member("mem_plain")] }), "mem_plain", NOW);
    const markdown = formatAgentSnapshotMarkdown(snapshot);
    expect(markdown).toContain("# mem_plain");
    expect(markdown).toContain("- Identity: identities:agent:mem_plain");
    expect(markdown).toContain("- Kind: agent");
    expect(markdown).toContain("- Status: active");
    expect(markdown).toContain("## Responsibilities\n- None");
    expect(markdown).toContain("## Capabilities\n- None");
    expect(markdown).toContain("## Reporting Path\n- None");
    expect(markdown).toContain("## Delegation Targets\n- None");
    expect(markdown).toContain("## Related Projects\n- None");
    expect(markdown).toContain("## Machine Assignments\n- None");
    expect(markdown).not.toContain("## Policy Context");
    expect(markdown).not.toContain("## Warnings");
  });

  test("inactive hops are excluded from the reporting path and cycles terminate via the seen-set", () => {
    const inactive = graph({
      members: [member("mem_worker"), member("mem_lead"), member("mem_ceo")],
      relationships: [
        relationship("rel_1", "reports_to", { kind: "member", id: "mem_worker" }, { kind: "member", id: "mem_lead" }),
        relationship("rel_2", "reports_to", { kind: "member", id: "mem_lead" }, { kind: "member", id: "mem_ceo" }, { expiresAt: "2026-08-17T11:00:00.000Z" }),
      ],
    });
    expect(createAgentSnapshot(inactive, "mem_worker", NOW).reportingPath.map((actor) => actor.memberId)).toEqual(["mem_lead"]);

    const cyclic = graph({
      members: [member("mem_a"), member("mem_b"), member("mem_c")],
      relationships: [
        relationship("rel_ab", "reports_to", { kind: "member", id: "mem_a" }, { kind: "member", id: "mem_b" }),
        relationship("rel_bc", "reports_to", { kind: "member", id: "mem_b" }, { kind: "member", id: "mem_c" }),
        relationship("rel_cb", "reports_to", { kind: "member", id: "mem_c" }, { kind: "member", id: "mem_b" }),
      ],
    });
    const path = createAgentSnapshot(cyclic, "mem_a", NOW).reportingPath;
    expect(path[0].memberId).toBe("mem_b");
    expect(path[1].memberId).toBe("mem_c");
    expect(path.length).toBeLessThanOrEqual(3); // the seen-set bounds the walk
  });

  test("deduplication of delegates_to records merges scopes, capabilities, and dispatch targets into a unique union", () => {
    const data = graph({
      members: [
        member("mem_lead"),
        member("mem_worker", { capabilities: ["repo:review", "repo:deploy"] }),
      ],
      machines: [
        machine("mach_1", { assignedMemberIds: ["mem_worker"], dispatchTarget: { machine: "mach_1", target: "work:1", state: "idle" } }),
        machine("mach_2", { assignedMemberIds: ["mem_worker"], dispatchTarget: { machine: "mach_2", target: "work:2", state: "unknown" } }),
      ],
      relationships: [
        relationship("rel_1", "delegates_to", { kind: "member", id: "mem_lead" }, { kind: "member", id: "mem_worker" }, { authority: "execute", scope: [{ capabilityId: "cap_a" }] }),
        relationship("rel_2", "delegates_to", { kind: "member", id: "mem_lead" }, { kind: "member", id: "mem_worker" }, { scope: [{ capabilityId: "cap_b" }] }),
        relationship("rel_3", "delegates_to", { kind: "member", id: "mem_lead" }, { kind: "member", id: "mem_worker" }, { scope: [{ capabilityId: "cap_a" }] }),
      ],
    });
    const resolution = resolveDelegationTargets(data, { actor: "mem_lead", now: NOW });
    expect(resolution.targets).toHaveLength(1);
    const target = resolution.targets[0];
    expect(target.memberId).toBe("mem_worker");
    expect(target.scope.map((scope) => scope.capabilityId)).toEqual(["cap_a", "cap_b"]);
    expect(target.capabilities).toEqual(["repo:review", "repo:deploy"]);
    expect(target.dispatchTargets.map((dispatch) => dispatch.machine).sort()).toEqual(["mach_1", "mach_2"]);
    expect(target.dispatchTargets).toHaveLength(2);
    expect(target.authority).toBe("execute");
    expect(resolution.refused).toEqual([]);
  });

  test("policy_context targets and scopes are sanitized of href and metadata while keeping authority", () => {
    const data = graph({
      members: [member("mem_lead")],
      relationships: [
        relationship("rel_policy", "policy_context", { kind: "member", id: "mem_lead" }, {
          kind: "external",
          id: "ext_proj",
          external: { system: "projects", kind: "workspace", id: "ext_proj", href: "https://private.invalid/proj", metadata: { token: "secret" } },
        }, {
          authority: "approve",
          scope: [{ external: { system: "projects", kind: "workspace", id: "ext_proj", href: "https://private.invalid/scope", metadata: { key: "secret" } } }],
        }),
      ],
    });
    const snapshot = createAgentSnapshot(data, "mem_lead", NOW);
    expect(snapshot.policyContext).toHaveLength(1);
    const policy = snapshot.policyContext[0];
    expect(policy.authority).toBe("approve");
    expect(policy.target).toEqual({ kind: "external", id: "ext_proj", external: { system: "projects", kind: "workspace", id: "ext_proj" } });
    expect(policy.scope[0].external).toEqual({ system: "projects", kind: "workspace", id: "ext_proj" });
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain("private.invalid");
    expect(encoded).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------
// Priority 5 — CLI public commands and failures
// ---------------------------------------------------------------------------

describe("CLI add groups and routing", () => {
  let cliStore = "";
  let savedStore: string | undefined;
  let savedAudit: string | undefined;

  beforeEach(() => {
    cliStore = storePath("cli.json");
    savedStore = process.env[OPEN_ORGS_STORE_ENV];
    savedAudit = process.env[OPEN_ORGS_AUDIT_ENV];
    process.env[OPEN_ORGS_STORE_ENV] = cliStore;
    process.env[OPEN_ORGS_AUDIT_ENV] = join(dir, "cli-audit.jsonl");
  });

  afterEach(() => {
    if (savedStore === undefined) delete process.env[OPEN_ORGS_STORE_ENV];
    else process.env[OPEN_ORGS_STORE_ENV] = savedStore;
    if (savedAudit === undefined) delete process.env[OPEN_ORGS_AUDIT_ENV];
    else process.env[OPEN_ORGS_AUDIT_ENV] = savedAudit;
  });

  async function runJson(args: string[]): Promise<unknown> {
    const out: string[] = [];
    await runCli(args, { out: (text) => out.push(text), throwOnError: true });
    return JSON.parse(out.pop()!);
  }

  test("every add group lands through the CLI with its flags", async () => {
    const org = await runJson(["--json", "orgs", "add", "--name", "Cli Org"]) as { id: string };
    const agent = await runJson(["--json", "agents", "add", "--org", org.id, "--name", "Cli Agent", "--identity", "agent:cli-agent"]) as { id: string };
    const human = await runJson(["--json", "members", "add", "--org", org.id, "--kind", "human", "--name", "Cli Human", "--identity", "human:cli-human"]) as { id: string; kind: string };
    expect(human.kind).toBe("human");
    const service = await runJson(["--json", "services", "add", "--org", org.id, "--name", "Cli Service", "--identity", "cli-service"]) as { id: string; kind: string; identityRef: { system: string; kind: string; id: string } };
    expect(service.kind).toBe("service-account");
    expect(service.identityRef).toEqual({ system: "identities", kind: "service", id: "cli-service" });

    const capability = await runJson(["--json", "capabilities", "add", "--org", org.id, "--namespace", "repo", "--key", "review"]) as { id: string };
    const func = await runJson(["--json", "functions", "add", "--org", org.id, "--name", "Cli Function", "--capability", capability.id]) as { capabilityIds: string[] };
    expect(func.capabilityIds).toEqual([capability.id]);

    const team = await runJson(["--json", "teams", "add", "--org", org.id, "--name", "Cli Team", "--function", func.id]) as { functionIds: string[] };
    expect(team.functionIds).toEqual([func.id]);

    const role = await runJson(["--json", "roles", "add", "--org", org.id, "--name", "Cli Role", "--team", team.id, "--function", func.id, "--responsibility", "Do things", "--capability", "repo:review"]) as { responsibilities: string[]; requiredCapabilities: string[] };
    expect(role.responsibilities).toEqual(["Do things"]);
    expect(role.requiredCapabilities).toEqual(["repo:review"]);

    const project = await runJson(["--json", "projects", "add", "--org", org.id, "--name", "Cli Project", "--project-ref", "workspace:cli-project", "--owner-member", agent.id]) as { projectRef: { system: string; kind: string; id: string }; ownerMemberIds: string[] };
    expect(project.projectRef).toEqual({ system: "projects", kind: "workspace", id: "cli-project" });
    expect(project.ownerMemberIds).toEqual([agent.id]);

    const capabilityOwned = await runJson(["--json", "capabilities", "add", "--org", org.id, "--namespace", "deploy", "--key", "prod", "--owner-member", agent.id, "--owner-team", team.id, "--owner-role", role.id, "--owner-function", func.id, "--owner-project", project.id]) as { ownerMemberIds: string[]; ownerTeamIds: string[]; ownerRoleIds: string[]; ownerFunctionIds: string[]; ownerProjectIds: string[] };
    expect(capabilityOwned.ownerMemberIds).toEqual([agent.id]);
    expect(capabilityOwned.ownerTeamIds).toEqual([team.id]);
    expect(capabilityOwned.ownerRoleIds).toEqual([role.id]);
    expect(capabilityOwned.ownerFunctionIds).toEqual([func.id]);
    expect(capabilityOwned.ownerProjectIds).toEqual([project.id]);

    const machine = await runJson([
      "--json", "machines", "add", "--org", org.id, "--name", "Cli Machine",
      "--machine-ref", "machine:cli-machine",
      "--assigned-member", agent.id,
      "--project", project.id,
      "--capability", capability.id,
      "--dispatch-target", "work:cli.1",
      "--dispatch-machine", "cli-machine",
      "--dispatch-state", "idle",
      "--dispatch-last-seen", "2026-08-17T10:00:00.000Z",
    ]) as { dispatchTarget: { target: string; machine: string; source: string; state: string; lastSeenAt: string } };
    expect(machine.dispatchTarget).toEqual({
      target: "work:cli.1",
      machine: "cli-machine",
      source: "manual",
      state: "idle",
      lastSeenAt: "2026-08-17T10:00:00.000Z",
    });

    // Relationship endpoints resolve through the same CLI routing.
    const relationship = await runJson(["--json", "relationships", "add", "--kind", "delegates_to", "--from", `member:${agent.id}`, "--to", `member:${service.id}`, "--authority", "execute"]) as { source: { kind: string }; target: { kind: string }; authority: string };
    expect(relationship.source.kind).toBe("member");
    expect(relationship.target.kind).toBe("member");
    expect(relationship.authority).toBe("execute");

    // Everything persisted under the overridden store path.
    const stored = JSON.parse(await readFile(cliStore, "utf8")) as OrgGraphData;
    expect(stored.orgs).toHaveLength(1);
    expect(stored.members).toHaveLength(3);
    expect(stored.machines[0].dispatchTarget).toMatchObject({ source: "manual", state: "idle" });
  });

  test("export, real import, relationships remove, version, snapshot markdown, and snapshot export --out", async () => {
    const org = await runJson(["--json", "orgs", "add", "--name", "Export Org"]) as { id: string };
    const agent = await runJson(["--json", "agents", "add", "--org", org.id, "--name", "Export Agent", "--identity", "agent:export-agent"]) as { id: string };
    const relationship = await runJson(["--json", "relationships", "add", "--kind", "delegates_to", "--from", `member:${agent.id}`, "--to", `member:${agent.id}`]) as { id: string };

    // export to stdout (json)
    const exported = await runJson(["--json", "export"]) as OrgGraphData;
    expect(exported.orgs.map((item) => item.id)).toEqual([org.id]);

    // export to a file
    const exportPath = join(dir, "exported.json");
    const exportResult = await runJson(["--json", "export", exportPath]) as { path: string; exported: number };
    expect(exportResult.path).toBe(exportPath);
    expect(exportResult.exported).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(await readFile(exportPath, "utf8"))).toMatchObject({ version: 1 });

    // relationships remove through the CLI
    const removed = await runJson(["--json", "relationships", "remove", relationship.id]) as { deleted: boolean };
    expect(removed.deleted).toBe(true);
    const afterRemove = JSON.parse(await readFile(cliStore, "utf8")) as OrgGraphData;
    expect(afterRemove.relationships).toHaveLength(0);

    // real import (mutates the store)
    const importPath = join(dir, "import.json");
    await writeFile(importPath, JSON.stringify({
      version: 1,
      orgs: [{ id: "org_imported", slug: "imported", name: "Imported", metadata: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      members: [{
        id: "mem_imported",
        slug: "imported-agent",
        name: "Imported Agent",
        orgId: "org_imported",
        kind: "agent",
        identityRef: { system: "identities", kind: "agent", id: "imported-agent" },
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    }), "utf8");
    const imported = await runJson(["--json", "import", importPath]) as { imported: number; path: string };
    expect(imported.imported).toBe(2);
    const stored = JSON.parse(await readFile(cliStore, "utf8")) as OrgGraphData;
    expect(stored.orgs.map((item) => item.id)).toEqual(["org_imported"]);

    // version
    const version = await runJson(["--json", "version"]) as { version: string };
    expect(version.version).toBe("0.1.2");

    // markdown snapshot through the CLI
    const markdown: string[] = [];
    await runCli(["--store", cliStore, "snapshot", "mem_imported", "--format", "markdown"], { out: (text) => markdown.push(text), throwOnError: true });
    expect(markdown.join("\n")).toContain("## Responsibilities\n- None");

    // snapshot export --out writes a file
    const snapshotPath = join(dir, "snapshot.md");
    const snapshotExport = await runJson(["--json", "snapshot", "export", "mem_imported", "--format", "markdown", "--out", snapshotPath]) as { path: string; format: string };
    expect(snapshotExport.path).toBe(snapshotPath);
    expect(snapshotExport.format).toBe("markdown");
    expect(await readFile(snapshotPath, "utf8")).toContain("# Imported Agent");
  });

  test("resolve returns the DelegationResolution envelope and honors filters", async () => {
    const org = await runJson(["--json", "orgs", "add", "--name", "Resolve Org"]) as { id: string };
    const lead = await runJson(["--json", "agents", "add", "--org", org.id, "--name", "Resolve Lead", "--identity", "agent:resolve-lead"]) as { id: string };
    const worker = await runJson(["--json", "agents", "add", "--org", org.id, "--name", "Resolve Worker", "--identity", "agent:resolve-worker"]) as { id: string };
    await runJson(["--json", "relationships", "add", "--kind", "delegates_to", "--from", `member:${lead.id}`, "--to", `member:${worker.id}`, "--authority", "execute"]);

    const resolution = await runJson(["--json", "resolve", "--actor", lead.id]) as { schemaVersion: string; generatedAt: string; query: { actor: string; now: string }; targets: Array<{ memberId: string; authority: string }>; refused: unknown[]; warnings: unknown[] };
    expect(resolution.schemaVersion).toBe("1.0");
    expect(resolution.generatedAt).toBeTruthy();
    expect(resolution.query.actor).toBe(lead.id);
    expect(resolution.query.now).toBeTruthy();
    expect(resolution.targets).toHaveLength(1);
    expect(resolution.targets[0].memberId).toBe(worker.id);
    expect(resolution.targets[0].authority).toBe("execute");
    expect(resolution.refused).toEqual([]);
    expect(resolution.warnings).toEqual(["target " + worker.id + " has no dispatch target evidence"]);

    // A capability filter no worker holds refuses rather than mutating anything.
    const filtered = await runJson(["--json", "resolve", "--actor", lead.id, "--capability", "repo:review"]) as { targets: unknown[]; refused: Array<{ reason: string }> };
    expect(filtered.targets).toEqual([]);
    expect(filtered.refused[0].reason).toBe("target lacks capability repo:review");
  });

  test("unknown commands, missing flags, and invalid values exit 1 with {error} and do not throw", async () => {
    const out: string[] = [];
    await runCli(["--store", cliStore, "--json", "orgs", "add", "--name", "Base"], { out: (text) => out.push(text) });
    out.length = 0;

    const cases: Array<[string[], RegExp]> = [
      [["--store", cliStore, "--json", "frobnicate"], /Unknown command: frobnicate/],
      [["--store", cliStore, "--json", "orgs", "add"], /orgs add requires --name/],
      [["--store", cliStore, "--json", "orgs", "add", "--name", "Bad Meta", "--metadata-json", "{not-json"], /JSON/i],
      [["--store", cliStore, "--json", "orgs", "add", "--name", "Bad Meta", "--metadata-json", "[1,2]"], /must be a JSON object/],
      [["--store", cliStore, "--json", "relationships", "add", "--kind", "bogus", "--from", "org:base", "--to", "org:base"], /invalid relationship kind/],
      [["--store", cliStore, "--json", "relationships", "add", "--kind", "custom", "--from", "org:base", "--to", "org:base", "--authority", "root"], /invalid relationship authority/],
      [["--store", cliStore, "--json", "relationships", "add", "--kind", "custom", "--from", "org:base", "--to", "org:base", "--confidence", "2"], /confidence must be a number between 0 and 1/],
      [["--store", cliStore, "--json", "members", "list", "--limit", "0"], /--limit must be a positive integer/],
      [["--store", cliStore, "--json", "members", "list", "--cursor", "abc"], /--cursor must be a non-negative integer offset/],
    ];
    for (const [args, expected] of cases) {
      out.length = 0;
      process.exitCode = 0;
      await runCli(args, { out: (text) => out.push(text) });
      expect(process.exitCode, args.join(" ")).toBe(1);
      const last = out.pop()!;
      const parsed = JSON.parse(last) as { error: string };
      expect(parsed.error, args.join(" ")).toMatch(expected);
    }

    // Non-json mode sends the message to stderr and still exits 1.
    const errLines: string[] = [];
    process.exitCode = 0;
    await runCli(["--store", cliStore, "frobnicate"], { err: (text) => errLines.push(text) });
    expect(process.exitCode).toBe(1);
    expect(errLines.join("\n")).toMatch(/Unknown command: frobnicate/);
  });

  test("missing and ambiguous targets error without mutating the store", async () => {
    const org = await runJson(["--json", "orgs", "add", "--name", "Stable Org"]) as { id: string };
    const rawBefore = await readFile(cliStore);

    const out: string[] = [];
    process.exitCode = 0;
    await runCli(["--store", cliStore, "--json", "relationships", "add", "--kind", "custom", "--from", "ghost:ghost", "--to", "org:stable"], { out: (text) => out.push(text) });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(out.pop()!).error).toMatch(/Node not found/);

    process.exitCode = 0;
    await runCli(["--store", cliStore, "--json", "members", "add", "--org", "org_missing", "--kind", "agent", "--name", "Ghost", "--identity", "agent:ghost"], { out: (text) => out.push(text) });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(out.pop()!).error).toMatch(/Record not found/);

    expect(await readFile(cliStore)).toEqual(rawBefore);
    const stored = JSON.parse(await readFile(cliStore, "utf8")) as OrgGraphData;
    expect(stored.orgs.map((item) => item.id)).toEqual([org.id]);
    expect(stored.relationships).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Import/normalization parity (pins real gaps found on the import path)
// ---------------------------------------------------------------------------

describe("normalizeGraphData import parity", () => {
  test("trims padded names on every collection exactly like orgs, and defaults member displayName to the name", () => {
    const data = normalizeGraphData({
      orgs: [{ id: "org_1", name: "  Padded Org  " }],
      teams: [{ id: "team_1", name: "  Padded Team  ", orgId: "org_1" }],
      functions: [{ id: "func_1", name: "  Padded Func  ", orgId: "org_1" }],
      roles: [{ id: "role_1", name: "  Padded Role  ", orgId: "org_1" }],
      members: [{ id: "mem_1", name: "  Padded Member  ", orgId: "org_1", kind: "agent", identityRef: { system: "identities", kind: "agent", id: "x" } }],
      projects: [{ id: "proj_1", name: "  Padded Proj  ", orgId: "org_1", projectRef: { system: "projects", kind: "workspace", id: "p" } }],
      machines: [{ id: "mach_1", name: "  Padded Mach  ", orgId: "org_1", machineRef: { system: "machines", kind: "machine", id: "m" } }],
      capabilities: [{ id: "cap_1", name: "  Padded Cap  ", orgId: "org_1", namespace: "ns", key: "k" }],
    });
    expect(data.orgs[0].name).toBe("Padded Org");
    expect(data.teams[0].name).toBe("Padded Team");
    expect(data.functions[0].name).toBe("Padded Func");
    expect(data.roles[0].name).toBe("Padded Role");
    expect(data.members[0].name).toBe("Padded Member");
    expect(data.members[0].displayName).toBe("Padded Member");
    expect(data.projects[0].name).toBe("Padded Proj");
    expect(data.machines[0].name).toBe("Padded Mach");
    expect(data.capabilities[0].name).toBe("Padded Cap");
  });

  test("an imported member without displayName classifies as a member and stays usable as a relationship endpoint", async () => {
    const store = newStore();
    const importPath = join(dir, "import-no-display.json");
    await writeFile(importPath, JSON.stringify({
      version: 1,
      orgs: [{ id: "org_i", slug: "imported", name: "Imported", metadata: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      members: [
        { id: "mem_i1", slug: "member-one", name: "Member One", orgId: "org_i", kind: "agent", identityRef: { system: "identities", kind: "agent", id: "i1" }, metadata: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "mem_i2", slug: "member-two", name: "Member Two", orgId: "org_i", kind: "agent", identityRef: { system: "identities", kind: "agent", id: "i2" }, metadata: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    }), "utf8");

    const out: string[] = [];
    await runCli(["--store", store.filePath, "--json", "import", importPath], { out: (text) => out.push(text), throwOnError: true });

    const normalized = await store.exportData();
    expect(kindForNode(normalized.members[0])).toBe("member");

    // The CLI resolves the member ref through nodeRefFor; a wrong kind would corrupt the endpoint.
    const relationshipOut: string[] = [];
    await runCli(["--store", store.filePath, "--json", "relationships", "add", "--kind", "delegates_to", "--from", "member:member-one", "--to", "member:member-two"], { out: (text) => relationshipOut.push(text), throwOnError: true });
    const relationship = JSON.parse(relationshipOut.pop()!) as { source: { kind: string }; target: { kind: string } };
    expect(relationship.source).toEqual({ kind: "member", id: "mem_i1" });
    expect(relationship.target).toEqual({ kind: "member", id: "mem_i2" });
    expect((await store.list("relationships"))).toHaveLength(1);
  });

  test("createRelationshipRecord and the import path derive identical relationship slugs", () => {
    const relationship = createRelationshipRecord({
      kind: "delegates_to",
      source: { kind: "member", id: "mem_a" },
      target: { kind: "member", id: "mem_b" },
    });
    expect(relationship.slug).toBe("delegates-to-member-mem-a-member-mem-b");
    expect(relationship.id).toMatch(/^rel_/);

    const imported = normalizeGraphData({
      orgs: [{ id: "org_p", name: "P" }],
      members: [
        { id: "mem_a", name: "A", orgId: "org_p", kind: "agent", identityRef: { system: "identities", kind: "agent", id: "a" } },
        { id: "mem_b", name: "B", orgId: "org_p", kind: "agent", identityRef: { system: "identities", kind: "agent", id: "b" } },
      ],
      relationships: [{
        id: "rel_p",
        kind: "delegates_to",
        source: { kind: "member", id: "mem_a" },
        target: { kind: "member", id: "mem_b" },
        authority: "none",
        scope: [],
        allowedActions: [],
        deniedActions: [],
        provenance: { source: "import", observedAt: "2026-01-01T00:00:00.000Z" },
        confidence: 1,
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    expect(imported.relationships[0].slug).toBe(relationship.slug);
  });
});
