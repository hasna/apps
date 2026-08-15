import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  setProjectAgentRole,
  removeProjectAgentRole,
  listProjectAgentRoles,
  getAgentProjectRoles,
} from "./project-agent-roles.js";
import type { Database } from "bun:sqlite";

let db: Database;

function setupProject(id: string) {
  db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [id, "Test Proj", `/tmp/${id}`]);
}

function setupAgent(id: string) {
  db.run("INSERT INTO agents (id, name) VALUES (?, ?)", [id, id]);
}

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("setProjectAgentRole", () => {
  it("should assign a role to an agent in a project", () => {
    setupProject("proj-1");
    setupAgent("agent-1");
    const role = setProjectAgentRole("proj-1", "agent-1", "developer");
    expect(role.id).toBeTruthy();
    expect(role.project_id).toBe("proj-1");
    expect(role.agent_id).toBe("agent-1");
    expect(role.role).toBe("developer");
    expect(role.is_lead).toBe(false);
  });

  it("should assign a lead role", () => {
    setupProject("proj-1");
    setupAgent("agent-2");
    const role = setProjectAgentRole("proj-1", "agent-2", "lead", true);
    expect(role.role).toBe("lead");
    expect(role.is_lead).toBe(true);
  });

  it("should update an existing role (upsert)", () => {
    setupProject("proj-1");
    setupAgent("agent-1");
    setProjectAgentRole("proj-1", "agent-1", "developer", false);
    const updated = setProjectAgentRole("proj-1", "agent-1", "developer", true);
    expect(updated.is_lead).toBe(true);
  });

  it("should allow multiple roles for the same agent", () => {
    setupProject("proj-1");
    setupAgent("agent-1");
    setProjectAgentRole("proj-1", "agent-1", "developer");
    setProjectAgentRole("proj-1", "agent-1", "reviewer");
    const roles = listProjectAgentRoles("proj-1");
    expect(roles).toHaveLength(2);
  });
});

describe("removeProjectAgentRole", () => {
  it("should remove a specific role", () => {
    setupProject("proj-1");
    setupAgent("agent-1");
    setProjectAgentRole("proj-1", "agent-1", "developer");
    const count = removeProjectAgentRole("proj-1", "agent-1", "developer");
    expect(count).toBe(1);
    expect(listProjectAgentRoles("proj-1")).toEqual([]);
  });

  it("should remove all roles for an agent when role is not specified", () => {
    setupProject("proj-1");
    setupAgent("agent-1");
    setProjectAgentRole("proj-1", "agent-1", "developer");
    setProjectAgentRole("proj-1", "agent-1", "reviewer");
    const count = removeProjectAgentRole("proj-1", "agent-1");
    expect(count).toBe(2);
    expect(listProjectAgentRoles("proj-1")).toEqual([]);
  });

  it("should return 0 when no match", () => {
    expect(removeProjectAgentRole("proj-1", "nonexistent")).toBe(0);
  });
});

describe("listProjectAgentRoles", () => {
  it("should return empty array for project with no roles", () => {
    expect(listProjectAgentRoles("empty-proj")).toEqual([]);
  });

  it("should list roles ordered by role name", () => {
    setupProject("proj-1");
    setupAgent("agent-1");
    setupAgent("agent-2");
    setProjectAgentRole("proj-1", "agent-1", "reviewer");
    setProjectAgentRole("proj-1", "agent-2", "developer");
    const roles = listProjectAgentRoles("proj-1");
    expect(roles).toHaveLength(2);
    expect(roles[0].role).toBe("developer");
    expect(roles[1].role).toBe("reviewer");
  });

  it("should only return roles for the specified project", () => {
    setupProject("proj-1");
    setupProject("proj-2");
    setupAgent("agent-1");
    setupAgent("agent-2");
    setProjectAgentRole("proj-1", "agent-1", "dev");
    setProjectAgentRole("proj-2", "agent-2", "qa");
    const roles = listProjectAgentRoles("proj-1");
    expect(roles).toHaveLength(1);
    expect(roles[0].role).toBe("dev");
  });
});

describe("getAgentProjectRoles", () => {
  it("should return empty array for agent with no roles", () => {
    expect(getAgentProjectRoles("no-roles-agent")).toEqual([]);
  });

  it("should list roles for an agent across projects", () => {
    setupProject("proj-1");
    setupProject("proj-2");
    setupAgent("agent-1");
    setProjectAgentRole("proj-1", "agent-1", "dev");
    setProjectAgentRole("proj-2", "agent-1", "reviewer");
    const roles = getAgentProjectRoles("agent-1");
    expect(roles).toHaveLength(2);
  });

  it("should return roles ordered by project_id then role", () => {
    setupProject("proj-A");
    setupProject("proj-B");
    setupAgent("agent-1");
    setProjectAgentRole("proj-B", "agent-1", "reviewer");
    setProjectAgentRole("proj-A", "agent-1", "developer");
    const roles = getAgentProjectRoles("agent-1");
    expect(roles[0].project_id).toBe("proj-A");
    expect(roles[1].project_id).toBe("proj-B");
  });
});
