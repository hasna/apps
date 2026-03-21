import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "../database.ts";
import { createProject } from "../projects.ts";
import { createTicket, getTicketById, updateTicket, closeTicket, reopenTicket, listTickets, deleteTicket, assignTicket } from "../tickets.ts";
import { VersionConflictError, InvalidTransitionError, NotFoundError } from "../../types/index.ts";

process.env["TICKETS_DB_PATH"] = ":memory:";

let projectId: string;

beforeEach(() => {
  resetDatabase();
  const db = getDatabase();
  const project = createProject({ name: "Test", ticket_prefix: "TST" }, db);
  projectId = project.id;
});

afterEach(() => { closeDatabase(); });

describe("createTicket", () => {
  it("creates ticket with auto short_id", () => {
    const t = createTicket({ project_id: projectId, title: "First bug" });
    expect(t.short_id).toBe("TST-0001");
    expect(t.status).toBe("open");
    expect(t.version).toBe(1);
  });

  it("increments short_id counter", () => {
    createTicket({ project_id: projectId, title: "One" });
    const t2 = createTicket({ project_id: projectId, title: "Two" });
    expect(t2.short_id).toBe("TST-0002");
  });

  it("throws on empty title", () => {
    expect(() => createTicket({ project_id: projectId, title: "" })).toThrow();
  });

  it("throws on title > 255 chars", () => {
    expect(() => createTicket({ project_id: projectId, title: "x".repeat(256) })).toThrow();
  });

  it("throws on unknown project", () => {
    expect(() => createTicket({ project_id: "bad-id", title: "Test" })).toThrow(NotFoundError);
  });
});

describe("getTicketById", () => {
  it("resolves by UUID", () => {
    const t = createTicket({ project_id: projectId, title: "Find me" });
    const found = getTicketById(t.id);
    expect(found.title).toBe("Find me");
  });

  it("resolves by short_id", () => {
    createTicket({ project_id: projectId, title: "Find by short" });
    const found = getTicketById("TST-0001");
    expect(found.short_id).toBe("TST-0001");
  });

  it("throws NotFoundError for unknown", () => {
    expect(() => getTicketById("NOTREAL-9999")).toThrow(NotFoundError);
  });
});

describe("updateTicket", () => {
  it("updates title and bumps version", () => {
    const t = createTicket({ project_id: projectId, title: "Old" });
    const updated = updateTicket(t.id, { title: "New" });
    expect(updated.title).toBe("New");
    expect(updated.version).toBe(2);
  });

  it("throws VersionConflictError on stale version", () => {
    const t = createTicket({ project_id: projectId, title: "Ticket" });
    updateTicket(t.id, { title: "Updated once" }); // bumps to version 2
    expect(() => updateTicket(t.id, { title: "Stale", version: 1 })).toThrow(VersionConflictError);
  });

  it("updates labels array", () => {
    const t = createTicket({ project_id: projectId, title: "Labeled" });
    const updated = updateTicket(t.id, { labels: ["bug", "urgent"] });
    expect(updated.labels).toEqual(["bug", "urgent"]);
  });
});

describe("closeTicket", () => {
  it("closes with resolution", () => {
    const t = createTicket({ project_id: projectId, title: "Close me" });
    const closed = closeTicket(t.id, { resolution: "fixed" });
    expect(closed.status).toBe("closed");
    expect(closed.resolution).toBe("fixed");
    expect(closed.closed_at).toBeTruthy();
  });

  it("marks duplicate_of", () => {
    const t1 = createTicket({ project_id: projectId, title: "Original" });
    const t2 = createTicket({ project_id: projectId, title: "Duplicate" });
    const closed = closeTicket(t2.id, { resolution: "duplicate", duplicate_of: t1.id });
    expect(closed.duplicate_of).toBe(t1.id);
  });

  it("throws InvalidTransitionError if already closed", () => {
    const t = createTicket({ project_id: projectId, title: "Already closed" });
    closeTicket(t.id, { resolution: "fixed" });
    expect(() => closeTicket(t.id, { resolution: "fixed" })).toThrow(InvalidTransitionError);
  });
});

describe("reopenTicket", () => {
  it("reopens closed ticket and clears resolution", () => {
    const t = createTicket({ project_id: projectId, title: "Reopen me" });
    closeTicket(t.id, { resolution: "fixed" });
    const reopened = reopenTicket(t.id);
    expect(reopened.status).toBe("open");
    expect(reopened.resolution).toBeNull();
    expect(reopened.closed_at).toBeNull();
  });

  it("throws if ticket is open (can't reopen open ticket)", () => {
    const t = createTicket({ project_id: projectId, title: "Open" });
    expect(() => reopenTicket(t.id)).toThrow(InvalidTransitionError);
  });
});

describe("listTickets", () => {
  it("returns all tickets with pagination meta", () => {
    createTicket({ project_id: projectId, title: "A" });
    createTicket({ project_id: projectId, title: "B" });
    const result = listTickets();
    expect(result.total).toBe(2);
    expect(result.tickets.length).toBe(2);
  });

  it("filters by status", () => {
    const t = createTicket({ project_id: projectId, title: "Bug" });
    closeTicket(t.id, { resolution: "fixed" });
    createTicket({ project_id: projectId, title: "Feature" });

    const open = listTickets({ status: "open" });
    expect(open.total).toBe(1);
    expect(open.tickets[0]!.title).toBe("Feature");
  });

  it("filters by project_id", () => {
    const db = getDatabase();
    const p2 = createProject({ name: "Other", ticket_prefix: "OTH" }, db);
    createTicket({ project_id: projectId, title: "In TST" });
    createTicket({ project_id: p2.id, title: "In OTH" });

    const result = listTickets({ project_id: projectId });
    expect(result.total).toBe(1);
    expect(result.tickets[0]!.short_id).toMatch(/^TST-/);
  });

  it("paginates correctly", () => {
    for (let i = 0; i < 5; i++) createTicket({ project_id: projectId, title: `Ticket ${i}` });
    const page1 = listTickets({ page: 1, per_page: 2 });
    const page2 = listTickets({ page: 2, per_page: 2 });
    expect(page1.tickets.length).toBe(2);
    expect(page2.tickets.length).toBe(2);
    expect(page1.total).toBe(5);
  });
});

describe("assignTicket", () => {
  it("assigns and unassigns", () => {
    const t = createTicket({ project_id: projectId, title: "Assign me" });
    const assigned = assignTicket(t.id, "agent-123");
    expect(assigned.assignee_id).toBe("agent-123");
    const unassigned = assignTicket(t.id, null);
    expect(unassigned.assignee_id).toBeNull();
  });
});

describe("deleteTicket", () => {
  it("deletes existing ticket", () => {
    const t = createTicket({ project_id: projectId, title: "Delete me" });
    deleteTicket(t.id);
    expect(() => getTicketById(t.id)).toThrow(NotFoundError);
  });

  it("throws NotFoundError for unknown id", () => {
    expect(() => deleteTicket("nonexistent")).toThrow(NotFoundError);
  });
});
