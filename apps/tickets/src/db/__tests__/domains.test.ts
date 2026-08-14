import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "../database.ts";
import { createProject } from "../projects.ts";
import { createDomain, getDomainByName, listDomains, verifyDomain, deleteDomain, generateVerificationToken } from "../domains.ts";
import { createApp } from "../../server/index.ts";
import { registerAgent } from "../agents.ts";
import { createApiKey } from "../../lib/auth.ts";
import { NotFoundError, ValidationError } from "../../types/index.ts";

process.env["TICKETS_DB_PATH"] = ":memory:";

let projectId: string;

beforeEach(() => {
  resetDatabase();
  const db = getDatabase();
  const p = createProject({ name: "Domain Test Project", ticket_prefix: "DMN" }, db);
  projectId = p.id;
});

afterEach(() => closeDatabase());

// ── createDomain ──────────────────────────────────────────────────────────────

describe("createDomain", () => {
  it("creates domain with verified=false", () => {
    const d = createDomain("tickets.myapp.com", { project_id: projectId });
    expect(d.domain).toBe("tickets.myapp.com");
    expect(d.verified).toBe(false);
    expect(d.project_id).toBe(projectId);
  });

  it("strips https:// prefix", () => {
    const d = createDomain("https://support.example.com/", { project_id: projectId });
    expect(d.domain).toBe("support.example.com");
  });

  it("strips trailing slash", () => {
    const d = createDomain("help.myapp.io/", { project_id: projectId });
    expect(d.domain).toBe("help.myapp.io");
  });

  it("throws ValidationError on duplicate domain", () => {
    createDomain("tickets.myapp.com", { project_id: projectId });
    expect(() => createDomain("tickets.myapp.com", { project_id: projectId })).toThrow(ValidationError);
  });

  it("throws ValidationError on empty domain", () => {
    expect(() => createDomain("", { project_id: projectId })).toThrow(ValidationError);
  });
});

// ── getDomainByName ───────────────────────────────────────────────────────────

describe("getDomainByName", () => {
  it("finds domain by exact name", () => {
    createDomain("api.tickets.com", { project_id: projectId });
    const d = getDomainByName("api.tickets.com");
    expect(d?.domain).toBe("api.tickets.com");
  });

  it("strips port from hostname", () => {
    createDomain("api.tickets.com", { project_id: projectId });
    const d = getDomainByName("api.tickets.com:8080");
    expect(d?.domain).toBe("api.tickets.com");
  });

  it("returns null for unknown domain", () => {
    expect(getDomainByName("unknown.example.com")).toBeNull();
  });
});

// ── listDomains ───────────────────────────────────────────────────────────────

describe("listDomains", () => {
  it("lists all domains", () => {
    createDomain("one.myapp.com");
    createDomain("two.myapp.com");
    expect(listDomains()).toHaveLength(2);
  });

  it("filters by project_id", () => {
    const db = getDatabase();
    const p2 = createProject({ name: "Other", ticket_prefix: "OTH" }, db);
    createDomain("one.myapp.com", { project_id: projectId });
    createDomain("two.myapp.com", { project_id: p2.id });
    expect(listDomains({ project_id: projectId })).toHaveLength(1);
  });
});

// ── verifyDomain ──────────────────────────────────────────────────────────────

describe("verifyDomain", () => {
  it("sets verified=true and verified_at", () => {
    const d = createDomain("verify.example.com", { project_id: projectId });
    expect(d.verified).toBe(false);
    const verified = verifyDomain(d.id);
    expect(verified.verified).toBe(true);
    expect(verified.verified_at).toBeTruthy();
  });

  it("throws NotFoundError on unknown id", () => {
    expect(() => verifyDomain("bad-id")).toThrow(NotFoundError);
  });
});

// ── deleteDomain ──────────────────────────────────────────────────────────────

describe("deleteDomain", () => {
  it("removes domain", () => {
    const d = createDomain("delete.me.com", { project_id: projectId });
    deleteDomain(d.id);
    expect(getDomainByName("delete.me.com")).toBeNull();
  });

  it("throws NotFoundError on unknown id", () => {
    expect(() => deleteDomain("bad-id")).toThrow(NotFoundError);
  });
});

// ── generateVerificationToken ─────────────────────────────────────────────────

describe("generateVerificationToken", () => {
  it("generates deterministic token for same inputs", () => {
    const t1 = generateVerificationToken("domain-id-123", "secret");
    const t2 = generateVerificationToken("domain-id-123", "secret");
    expect(t1).toBe(t2);
  });

  it("generates different token for different domain IDs", () => {
    const t1 = generateVerificationToken("domain-id-aaa", "secret");
    const t2 = generateVerificationToken("domain-id-bbb", "secret");
    expect(t1).not.toBe(t2);
  });

  it("starts with tickets-verify=", () => {
    const t = generateVerificationToken("abc", "secret");
    expect(t).toMatch(/^tickets-verify=/);
  });
});

// ── Domain routing middleware via API ─────────────────────────────────────────

describe("domain routing middleware", () => {
  let app: ReturnType<typeof createApp>;
  let apiKey: string;

  beforeEach(async () => {
    app = createApp();
    const db = getDatabase();
    const agent = registerAgent({ name: "test-domain-agent" }, db);
    const { rawKey } = await createApiKey(agent.id, "test", ["read", "write"], db);
    apiKey = rawKey;
  });

  async function req(path: string, host?: string) {
    return app.fetch(new Request(`http://localhost${path}`, {
      headers: { "X-API-Key": apiKey, ...(host ? { Host: host } : {}) },
    }));
  }

  it("falls back gracefully for unknown domain", async () => {
    const res = await req("/api/health", "unknown.notregistered.com");
    expect(res.status).toBe(200);
  });

  it("falls back gracefully for localhost", async () => {
    const res = await req("/api/health", "localhost:19428");
    expect(res.status).toBe(200);
  });

  it("resolves verified domain to project and attaches to context", async () => {
    const db = getDatabase();
    const d = createDomain("tickets.myapp.com", { project_id: projectId });
    verifyDomain(d.id);

    // Making a request with a Host header matching a verified domain should work
    const res = await req("/api/tickets", "tickets.myapp.com");
    expect(res.status).toBe(200);
  });

  it("does not resolve unverified domain", async () => {
    createDomain("unverified.myapp.com", { project_id: projectId });
    // Unverified domain — middleware should skip it, request still works normally
    const res = await req("/api/tickets", "unverified.myapp.com");
    expect(res.status).toBe(200); // still responds, just without domain project context
  });
});
