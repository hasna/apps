/**
 * MCP tool tests — call the underlying DB functions directly
 * (same functions the MCP tools call) with an in-memory DB.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "../../db/database.ts";
import { createProject } from "../../db/projects.ts";
import { createTicket, getTicketById, closeTicket, bulkCreateTickets } from "../../db/tickets.ts";
import { searchTickets, getSimilarTickets } from "../../db/search.ts";
import { createComment, listComments } from "../../db/comments.ts";
import { registerAgent } from "../../db/agents.ts";
import { createLabel, listLabels } from "../../db/labels.ts";
import { createMilestone, listMilestones, closeMilestone } from "../../db/milestones.ts";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../../types/index.ts";

process.env["TICKETS_DB_PATH"] = ":memory:";

let projectId: string;

beforeEach(() => {
  resetDatabase();
  const db = getDatabase();
  const project = createProject({ name: "MCP Test Project", ticket_prefix: "MCP" }, db);
  projectId = project.id;
});

afterEach(() => closeDatabase());

// ── create_ticket ─────────────────────────────────────────────────────────────

describe("create_ticket", () => {
  it("creates ticket with default values", () => {
    const t = createTicket({ project_id: projectId, title: "Test bug", source: "mcp" });
    expect(t.short_id).toBe("MCP-0001");
    expect(t.status).toBe("open");
    expect(t.type).toBe("bug");
    expect(t.source).toBe("mcp");
    expect(t.is_ai_opened).toBe(false);
  });

  it("sets ai_opened fields", () => {
    const t = createTicket({
      project_id: projectId,
      title: "AI-detected regression",
      source: "mcp",
      is_ai_opened: true,
      ai_confidence: 0.92,
      ai_reasoning: "Stack trace matches known pattern",
    });
    expect(t.is_ai_opened).toBe(true);
    expect(t.ai_confidence).toBe(0.92);
    expect(t.ai_reasoning).toBe("Stack trace matches known pattern");
  });

  it("sets all optional fields", () => {
    const agent = registerAgent({ name: "reporter", type: "ai_agent" });
    const t = createTicket({
      project_id: projectId,
      title: "Full ticket",
      type: "feature",
      priority: "high",
      severity: "major",
      reporter_id: agent.id,
      labels: ["enhancement", "api"],
      due_date: "2026-12-31",
      sla_minutes: 60,
    });
    expect(t.type).toBe("feature");
    expect(t.priority).toBe("high");
    expect(t.severity).toBe("major");
    expect(t.labels).toEqual(["enhancement", "api"]);
    expect(t.sla_minutes).toBe(60);
  });

  it("throws ValidationError on empty title", () => {
    expect(() => createTicket({ project_id: projectId, title: "  " })).toThrow(ValidationError);
  });

  it("throws NotFoundError on bad project_id", () => {
    expect(() => createTicket({ project_id: "bad", title: "Test" })).toThrow(NotFoundError);
  });
});

// ── close_ticket (state machine) ──────────────────────────────────────────────

describe("close_ticket (state machine)", () => {
  it("open → closed with resolution=fixed", () => {
    const t = createTicket({ project_id: projectId, title: "Fix me" });
    const closed = closeTicket(t.id, { resolution: "fixed" });
    expect(closed.status).toBe("closed");
    expect(closed.resolution).toBe("fixed");
    expect(closed.closed_at).toBeTruthy();
  });

  it("closed → closed throws InvalidTransitionError", () => {
    const t = createTicket({ project_id: projectId, title: "Already closed" });
    closeTicket(t.id, { resolution: "fixed" });
    expect(() => closeTicket(t.id, { resolution: "wont_fix" })).toThrow(InvalidTransitionError);
  });

  it("sets duplicate_of when resolution=duplicate", () => {
    const original = createTicket({ project_id: projectId, title: "Original" });
    const dupe = createTicket({ project_id: projectId, title: "Duplicate" });
    const closed = closeTicket(dupe.id, { resolution: "duplicate", duplicate_of: original.id });
    expect(closed.duplicate_of).toBe(original.id);
  });
});

// ── bulk_create_tickets ───────────────────────────────────────────────────────

describe("bulk_create_tickets", () => {
  it("creates multiple tickets atomically", () => {
    const tickets = bulkCreateTickets([
      { project_id: projectId, title: "Bulk 1", type: "bug" },
      { project_id: projectId, title: "Bulk 2", type: "feature" },
      { project_id: projectId, title: "Bulk 3", type: "task" },
    ]);
    expect(tickets).toHaveLength(3);
    expect(tickets[0]!.short_id).toBe("MCP-0001");
    expect(tickets[1]!.short_id).toBe("MCP-0002");
    expect(tickets[2]!.short_id).toBe("MCP-0003");
    expect(tickets[0]!.type).toBe("bug");
    expect(tickets[1]!.type).toBe("feature");
  });

  it("returns empty array for empty input", () => {
    expect(bulkCreateTickets([])).toEqual([]);
  });
});

// ── search_tickets ────────────────────────────────────────────────────────────

describe("search_tickets", () => {
  it("finds tickets by title keyword", () => {
    createTicket({ project_id: projectId, title: "Authentication timeout error" });
    createTicket({ project_id: projectId, title: "Dashboard layout broken" });
    createTicket({ project_id: projectId, title: "Authentication cookie expired" });

    const result = searchTickets("authentication", { project_id: projectId });
    expect(result.total).toBe(2);
    expect(result.tickets.every((t) => t.title.toLowerCase().includes("auth"))).toBe(true);
  });

  it("returns all tickets with empty query", () => {
    createTicket({ project_id: projectId, title: "A" });
    createTicket({ project_id: projectId, title: "B" });
    const result = searchTickets("", { project_id: projectId });
    expect(result.total).toBe(2);
  });

  it("filters by status alongside search", () => {
    const t = createTicket({ project_id: projectId, title: "Login crash" });
    closeTicket(t.id, { resolution: "fixed" });
    createTicket({ project_id: projectId, title: "Login slow" });

    const open = searchTickets("login", { status: "open" });
    expect(open.tickets.every((t) => t.status === "open")).toBe(true);
  });
});

// ── get_similar_tickets ───────────────────────────────────────────────────────

describe("get_similar_tickets", () => {
  it("finds tickets with similar titles", () => {
    createTicket({ project_id: projectId, title: "API rate limit exceeded" });
    createTicket({ project_id: projectId, title: "API timeout on large requests" });
    createTicket({ project_id: projectId, title: "Dashboard chart not rendering" });

    const similar = getSimilarTickets("API rate limiting issue", projectId, 5);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0]!.title.toLowerCase()).toContain("api");
  });

  it("returns empty for short query", () => {
    const similar = getSimilarTickets("ok", projectId, 5);
    expect(similar).toEqual([]);
  });

  it("returns empty when no similar tickets", () => {
    createTicket({ project_id: projectId, title: "Completely unrelated ticket" });
    const similar = getSimilarTickets("quantum entanglement", projectId, 5);
    expect(similar.length).toBe(0);
  });

  it("respects project_id scope", () => {
    const db = getDatabase();
    const other = createProject({ name: "Other", ticket_prefix: "OTH" }, db);
    createTicket({ project_id: other.id, title: "API timeout error" });

    const similar = getSimilarTickets("API timeout", projectId, 5);
    // Should not find tickets from other project
    expect(similar.every((t) => !t.short_id.startsWith("OTH"))).toBe(true);
  });
});

// ── bootstrap ────────────────────────────────────────────────────────────────

describe("bootstrap (create_project + create_label)", () => {
  it("creates project with default labels", () => {
    const db = getDatabase();
    const project = createProject({ name: "My App", ticket_prefix: "APP" }, db);
    const labelNames = ["bug", "feature", "question", "urgent", "wontfix"];
    for (const name of labelNames) createLabel(project.id, name, "#6b7280", undefined, db);

    const labels = listLabels(project.id, db);
    expect(labels.map((l) => l.name)).toEqual(expect.arrayContaining(labelNames));
  });
});

// ── add_comment / suggest_resolution ─────────────────────────────────────────

describe("add_comment", () => {
  it("adds public comment", () => {
    const t = createTicket({ project_id: projectId, title: "Bug" });
    createComment({ ticket_id: t.id, content: "Investigating now." });
    const comments = listComments(t.id);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.content).toBe("Investigating now.");
    expect(comments[0]!.is_internal).toBe(false);
  });

  it("adds internal AI suggestion comment", () => {
    const t = createTicket({ project_id: projectId, title: "Slow query" });
    createComment({
      ticket_id: t.id,
      content: "**AI Suggestion** (confidence: 85%)\n\nAdd index on users.email column.",
      is_internal: true,
      type: "ai_suggestion",
      metadata: { confidence: 0.85 },
    });
    const all = listComments(t.id, true);
    expect(all).toHaveLength(1);
    expect(all[0]!.is_internal).toBe(true);
    expect(all[0]!.type).toBe("ai_suggestion");

    const publicOnly = listComments(t.id, false);
    expect(publicOnly).toHaveLength(0);
  });

  it("throws ValidationError on empty content", () => {
    const t = createTicket({ project_id: projectId, title: "Ticket" });
    expect(() => createComment({ ticket_id: t.id, content: "" })).toThrow(ValidationError);
  });
});

// ── labels ───────────────────────────────────────────────────────────────────

describe("create_label / list_labels", () => {
  it("creates and lists labels", () => {
    const db = getDatabase();
    createLabel(projectId, "bug", "#ef4444", "Software defects", db);
    createLabel(projectId, "feature", "#3b82f6", "New feature requests", db);

    const labels = listLabels(projectId, db);
    expect(labels).toHaveLength(2);
    expect(labels.map((l) => l.name)).toContain("bug");
    expect(labels.map((l) => l.name)).toContain("feature");
  });

  it("throws ValidationError on duplicate label name", () => {
    const db = getDatabase();
    createLabel(projectId, "bug", "#ef4444", undefined, db);
    expect(() => createLabel(projectId, "bug", "#ff0000", undefined, db)).toThrow(ValidationError);
  });
});

// ── milestones ────────────────────────────────────────────────────────────────

describe("milestones", () => {
  it("creates milestone and lists open ones", () => {
    const db = getDatabase();
    createMilestone(projectId, "v1.0", "First release", "2026-06-01", db);
    createMilestone(projectId, "v1.1", "Patch release", "2026-07-01", db);

    const open = listMilestones(projectId, "open", db);
    expect(open).toHaveLength(2);
    expect(open[0]!.name).toBe("v1.0");
  });

  it("close_milestone changes status", () => {
    const db = getDatabase();
    const ms = createMilestone(projectId, "v1.0", undefined, "2026-06-01", db);
    const closed = closeMilestone(ms.id, db);
    expect(closed.status).toBe("closed");

    const still_open = listMilestones(projectId, "open", db);
    expect(still_open).toHaveLength(0);
  });
});

// ── register_agent ────────────────────────────────────────────────────────────

describe("register_agent", () => {
  it("registers idempotently by name", () => {
    const a1 = registerAgent({ name: "sentinel", type: "ai_agent" });
    const a2 = registerAgent({ name: "sentinel" }); // second call
    expect(a1.id).toBe(a2.id);
    expect(a1.name).toBe("sentinel");
  });

  it("returns 8-char ID", () => {
    const a = registerAgent({ name: "alpha" });
    expect(a.id).toHaveLength(8);
  });
});
