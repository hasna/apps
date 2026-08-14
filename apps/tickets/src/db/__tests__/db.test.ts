/**
 * Database layer tests — all CRUD modules with in-memory SQLite.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "../database.ts";
import { createProject, getProjectById, getProjectBySlug, listProjects, updateProject, deleteProject, getProjectStats, incrementTicketCounter } from "../projects.ts";
import { registerAgent, getAgentById, getAgentByName, listAgents } from "../agents.ts";
import { createComment, listComments, updateComment, deleteComment } from "../comments.ts";
import { appendActivity, listActivity } from "../activity.ts";
import { createRelation, listRelations, deleteRelation } from "../relations.ts";
import { createLabel, listLabels, updateLabel, deleteLabel } from "../labels.ts";
import { createMilestone, listMilestones, updateMilestone, closeMilestone } from "../milestones.ts";
import { createTicket, getTicketById, listTickets } from "../tickets.ts";
import { searchTickets, getSimilarTickets } from "../search.ts";
import { NotFoundError, ValidationError } from "../../types/index.ts";

process.env["TICKETS_DB_PATH"] = ":memory:";

let projectId: string;

beforeEach(() => {
  resetDatabase();
  const db = getDatabase();
  const p = createProject({ name: "Test", ticket_prefix: "TST" }, db);
  projectId = p.id;
});

afterEach(() => closeDatabase());

// ── Projects ──────────────────────────────────────────────────────────────────

describe("projects", () => {
  it("creates with auto-slug and prefix", () => {
    const p = createProject({ name: "My App" });
    expect(p.slug).toBe("my-app");
    expect(p.ticket_prefix).toBeTruthy();
  });

  it("getBySlug returns project", () => {
    const p = getProjectBySlug("test");
    expect(p?.id).toBe(projectId);
  });

  it("listProjects returns all", () => {
    createProject({ name: "Another" });
    expect(listProjects()).toHaveLength(2);
  });

  it("updateProject changes name", () => {
    const updated = updateProject(projectId, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
  });

  it("deleteProject removes it", () => {
    const p2 = createProject({ name: "Temp" });
    deleteProject(p2.id);
    expect(listProjects()).toHaveLength(1);
  });

  it("incrementTicketCounter is atomic", () => {
    expect(incrementTicketCounter(projectId)).toBe(1);
    expect(incrementTicketCounter(projectId)).toBe(2);
    expect(incrementTicketCounter(projectId)).toBe(3);
  });

  it("getProjectStats counts by status", () => {
    const t = createTicket({ project_id: projectId, title: "Bug" });
    const { closeTicket } = require("../tickets.ts") as typeof import("../tickets.ts");
    closeTicket(t.id, { resolution: "fixed" });
    createTicket({ project_id: projectId, title: "Feature" });
    const stats = getProjectStats(projectId);
    expect(stats.total).toBe(2);
    expect(stats.open).toBe(1);
    expect(stats.closed).toBe(1);
  });

  it("throws NotFoundError on unknown id", () => {
    expect(() => getProjectById("bad-id")).toThrow(NotFoundError);
  });
});

// ── Agents ────────────────────────────────────────────────────────────────────

describe("agents", () => {
  it("registers with 8-char ID", () => {
    const a = registerAgent({ name: "bot", type: "ai_agent" });
    expect(a.id).toHaveLength(8);
    expect(a.type).toBe("ai_agent");
  });

  it("idempotent by name", () => {
    const a1 = registerAgent({ name: "sentinel" });
    const a2 = registerAgent({ name: "sentinel" });
    expect(a1.id).toBe(a2.id);
  });

  it("getByName returns null for unknown", () => {
    expect(getAgentByName("nobody")).toBeNull();
  });

  it("listAgents returns all", () => {
    registerAgent({ name: "alpha" });
    registerAgent({ name: "beta" });
    expect(listAgents().length).toBeGreaterThanOrEqual(2);
  });

  it("throws NotFoundError on getById with bad id", () => {
    expect(() => getAgentById("bad")).toThrow(NotFoundError);
  });
});

// ── Comments ──────────────────────────────────────────────────────────────────

describe("comments", () => {
  let ticketId: string;
  beforeEach(() => {
    ticketId = createTicket({ project_id: projectId, title: "Ticket" }).id;
  });

  it("creates and lists comments", () => {
    createComment({ ticket_id: ticketId, content: "First" });
    createComment({ ticket_id: ticketId, content: "Second", is_internal: true });
    expect(listComments(ticketId, true)).toHaveLength(2);
    expect(listComments(ticketId, false)).toHaveLength(1);
  });

  it("updateComment changes content", () => {
    const c = createComment({ ticket_id: ticketId, content: "Old" });
    const updated = updateComment(c.id, "New");
    expect(updated.content).toBe("New");
  });

  it("deleteComment removes it", () => {
    const c = createComment({ ticket_id: ticketId, content: "Delete me" });
    deleteComment(c.id);
    expect(listComments(ticketId)).toHaveLength(0);
  });

  it("throws on empty content", () => {
    expect(() => createComment({ ticket_id: ticketId, content: "" })).toThrow(ValidationError);
  });

  it("throws NotFoundError on delete unknown", () => {
    expect(() => deleteComment("bad")).toThrow(NotFoundError);
  });
});

// ── Activity ──────────────────────────────────────────────────────────────────

describe("activity", () => {
  let ticketId: string;
  beforeEach(() => {
    ticketId = createTicket({ project_id: projectId, title: "Ticket" }).id;
  });

  it("appends and lists activity", () => {
    appendActivity({ ticket_id: ticketId, action: "status_changed", from_value: "open", to_value: "in_progress" });
    appendActivity({ ticket_id: ticketId, action: "assigned", to_value: "alice" });
    const { activity, total } = listActivity(ticketId);
    expect(total).toBe(2);
    expect(activity[0]!.action).toBe("status_changed");
  });

  it("paginates correctly", () => {
    for (let i = 0; i < 10; i++) appendActivity({ ticket_id: ticketId, action: `action_${i}` });
    const p1 = listActivity(ticketId, { page: 1, per_page: 5 });
    const p2 = listActivity(ticketId, { page: 2, per_page: 5 });
    expect(p1.activity).toHaveLength(5);
    expect(p2.activity).toHaveLength(5);
    expect(p1.total).toBe(10);
  });

  it("stores ai fields", () => {
    const a = appendActivity({ ticket_id: ticketId, action: "triage", is_ai_action: true, ai_confidence: 0.9, ai_reasoning: "Pattern match" });
    expect(a.is_ai_action).toBe(true);
    expect(a.ai_confidence).toBe(0.9);
  });
});

// ── Relations ─────────────────────────────────────────────────────────────────

describe("relations", () => {
  let t1Id: string;
  let t2Id: string;
  beforeEach(() => {
    t1Id = createTicket({ project_id: projectId, title: "T1" }).id;
    t2Id = createTicket({ project_id: projectId, title: "T2" }).id;
  });

  it("creates relation between tickets", () => {
    const r = createRelation(t1Id, t2Id, "blocks");
    expect(r.relation_type).toBe("blocks");
    expect(listRelations(t1Id)).toHaveLength(1);
  });

  it("throws on self-link", () => {
    expect(() => createRelation(t1Id, t1Id, "relates_to")).toThrow(ValidationError);
  });

  it("throws on duplicate relation", () => {
    createRelation(t1Id, t2Id, "blocks");
    expect(() => createRelation(t1Id, t2Id, "blocks")).toThrow(ValidationError);
  });

  it("deletes relation", () => {
    const r = createRelation(t1Id, t2Id, "relates_to");
    deleteRelation(r.id);
    expect(listRelations(t1Id)).toHaveLength(0);
  });

  it("listRelations returns both directions", () => {
    createRelation(t1Id, t2Id, "blocks");
    expect(listRelations(t2Id)).toHaveLength(1); // t2 is the related side
  });
});

// ── Labels ────────────────────────────────────────────────────────────────────

describe("labels", () => {
  it("creates and lists", () => {
    createLabel(projectId, "bug", "#ef4444");
    createLabel(projectId, "feature", "#3b82f6");
    expect(listLabels(projectId)).toHaveLength(2);
  });

  it("updateLabel changes name and color", () => {
    const l = createLabel(projectId, "old-name", "#111");
    const updated = updateLabel(l.id, { name: "new-name", color: "#fff" });
    expect(updated.name).toBe("new-name");
    expect(updated.color).toBe("#fff");
  });

  it("deleteLabel removes it", () => {
    const l = createLabel(projectId, "temp");
    deleteLabel(l.id);
    expect(listLabels(projectId)).toHaveLength(0);
  });

  it("throws on duplicate name in same project", () => {
    createLabel(projectId, "bug");
    expect(() => createLabel(projectId, "bug")).toThrow(ValidationError);
  });

  it("allows same name in different projects", () => {
    const p2 = createProject({ name: "Other", ticket_prefix: "OTH" });
    createLabel(projectId, "bug");
    expect(() => createLabel(p2.id, "bug")).not.toThrow();
  });
});

// ── Milestones ────────────────────────────────────────────────────────────────

describe("milestones", () => {
  it("creates and lists", () => {
    createMilestone(projectId, "v1.0", undefined, "2026-06-01");
    createMilestone(projectId, "v1.1");
    expect(listMilestones(projectId)).toHaveLength(2);
  });

  it("filters by status", () => {
    const ms = createMilestone(projectId, "v1.0");
    closeMilestone(ms.id);
    createMilestone(projectId, "v2.0");
    expect(listMilestones(projectId, "open")).toHaveLength(1);
    expect(listMilestones(projectId, "closed")).toHaveLength(1);
  });

  it("updateMilestone changes due_date", () => {
    const ms = createMilestone(projectId, "v1.0");
    const updated = updateMilestone(ms.id, { due_date: "2026-12-31" });
    expect(updated.due_date).toBe("2026-12-31");
  });

  it("closeMilestone sets status=closed", () => {
    const ms = createMilestone(projectId, "Release");
    expect(closeMilestone(ms.id).status).toBe("closed");
  });
});

// ── Search (FTS) ──────────────────────────────────────────────────────────────

describe("search (FTS5)", () => {
  it("finds by title keyword", () => {
    createTicket({ project_id: projectId, title: "Database connection timeout" });
    createTicket({ project_id: projectId, title: "UI rendering glitch" });
    const { tickets } = searchTickets("database", { project_id: projectId });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.title).toContain("Database");
  });

  it("finds by description keyword", () => {
    createTicket({ project_id: projectId, title: "Auth bug", description: "JWT token expiry not handled correctly" });
    createTicket({ project_id: projectId, title: "Other" });
    const { tickets } = searchTickets("JWT", { project_id: projectId });
    expect(tickets).toHaveLength(1);
  });

  it("returns empty for no match", () => {
    createTicket({ project_id: projectId, title: "Unrelated" });
    const { tickets } = searchTickets("quantum", { project_id: projectId });
    expect(tickets).toHaveLength(0);
  });

  it("getSimilarTickets finds by word overlap", () => {
    createTicket({ project_id: projectId, title: "API rate limiting issue" });
    createTicket({ project_id: projectId, title: "Dashboard load time" });
    const similar = getSimilarTickets("API rate limit exceeded", projectId);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0]!.title).toContain("API");
  });

  it("getSimilarTickets returns empty for short query", () => {
    expect(getSimilarTickets("ok", projectId)).toHaveLength(0);
  });
});
