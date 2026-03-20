import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import type { Agent } from "../types/index.js";
import { listAgents, getOrgChart } from "./agents.js";
import type { OrgNode } from "./agents.js";

export interface ProjectAgentRole {
  id: string;
  project_id: string;
  agent_id: string;
  role: string;
  is_lead: boolean;
  created_at: string;
}

export interface ProjectAgentRoleRow {
  id: string;
  project_id: string;
  agent_id: string;
  role: string;
  is_lead: number;
  created_at: string;
}

function rowToRole(row: ProjectAgentRoleRow): ProjectAgentRole {
  return { ...row, is_lead: row.is_lead === 1 };
}

export function setProjectAgentRole(
  projectId: string,
  agentId: string,
  role: string,
  isLead = false,
  db?: Database,
): ProjectAgentRole {
  const d = db || getDatabase();
  const existing = d.query(
    "SELECT * FROM project_agent_roles WHERE project_id = ? AND agent_id = ? AND role = ?",
  ).get(projectId, agentId, role) as ProjectAgentRoleRow | null;

  if (existing) {
    d.run(
      "UPDATE project_agent_roles SET is_lead = ? WHERE id = ?",
      [isLead ? 1 : 0, existing.id],
    );
    return rowToRole(d.query("SELECT * FROM project_agent_roles WHERE id = ?").get(existing.id) as ProjectAgentRoleRow);
  }

  const id = uuid();
  d.run(
    "INSERT INTO project_agent_roles (id, project_id, agent_id, role, is_lead, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, projectId, agentId, role, isLead ? 1 : 0, now()],
  );
  return rowToRole(d.query("SELECT * FROM project_agent_roles WHERE id = ?").get(id) as ProjectAgentRoleRow);
}

export function removeProjectAgentRole(
  projectId: string,
  agentId: string,
  role?: string,
  db?: Database,
): number {
  const d = db || getDatabase();
  if (role) {
    return d.run(
      "DELETE FROM project_agent_roles WHERE project_id = ? AND agent_id = ? AND role = ?",
      [projectId, agentId, role],
    ).changes;
  }
  return d.run(
    "DELETE FROM project_agent_roles WHERE project_id = ? AND agent_id = ?",
    [projectId, agentId],
  ).changes;
}

export function listProjectAgentRoles(projectId: string, db?: Database): ProjectAgentRole[] {
  const d = db || getDatabase();
  return (d.query(
    "SELECT * FROM project_agent_roles WHERE project_id = ? ORDER BY role, created_at",
  ).all(projectId) as ProjectAgentRoleRow[]).map(rowToRole);
}

export function getAgentProjectRoles(agentId: string, db?: Database): ProjectAgentRole[] {
  const d = db || getDatabase();
  return (d.query(
    "SELECT * FROM project_agent_roles WHERE agent_id = ? ORDER BY project_id, role",
  ).all(agentId) as ProjectAgentRoleRow[]).map(rowToRole);
}

export interface ProjectOrgNode extends OrgNode {
  project_roles: string[];
  is_project_lead: boolean;
}

/**
 * Get org chart scoped to a project. Returns global org chart with per-project
 * role overrides merged in. Agents not in the project are excluded when filter=true.
 */
export function getProjectOrgChart(
  projectId: string,
  opts?: { filter_to_project?: boolean },
  db?: Database,
): ProjectOrgNode[] {
  const d = db || getDatabase();
  const globalTree = getOrgChart(d);
  const projectRoles = listProjectAgentRoles(projectId, d);

  const rolesByAgent = new Map<string, { roles: string[]; isLead: boolean }>();
  for (const pr of projectRoles) {
    if (!rolesByAgent.has(pr.agent_id)) rolesByAgent.set(pr.agent_id, { roles: [], isLead: false });
    const entry = rolesByAgent.get(pr.agent_id)!;
    entry.roles.push(pr.role);
    if (pr.is_lead) entry.isLead = true;
  }

  function augmentTree(nodes: OrgNode[]): ProjectOrgNode[] {
    return nodes
      .map(n => {
        const override = rolesByAgent.get(n.agent.id);
        return {
          ...n,
          reports: augmentTree(n.reports),
          project_roles: override?.roles ?? [],
          is_project_lead: override?.isLead ?? false,
        };
      })
      .filter(n => {
        if (!opts?.filter_to_project) return true;
        // Include if this agent has a project role, or has any descendant with one
        const hasRole = n.project_roles.length > 0;
        const hasDescendant = n.reports.length > 0;
        return hasRole || hasDescendant;
      });
  }

  return augmentTree(globalTree);
}
