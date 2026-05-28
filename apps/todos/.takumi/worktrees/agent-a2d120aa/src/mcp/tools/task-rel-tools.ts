// @ts-nocheck
/**
 * Task relationship tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";
import { listTasks } from "../../tasks.js";

interface TaskRelContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
  getAgentFocus: (agentId: string) => { agent_id: string; project_id?: string } | undefined;
}

export function registerTaskRelTools(server: McpServer, ctx: TaskRelContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask } = ctx;

  // === HANDOFFS ===

  if (shouldRegisterTool("create_handoff")) {
    server.tool(
      "create_handoff",
      "Create a session handoff note for agent coordination.",
      {
        agent_id: z.string().optional().describe("Agent creating the handoff"),
        project_id: z.string().optional().describe("Project ID"),
        summary: z.string().describe("What was accomplished this session"),
        completed: z.array(z.string()).optional().describe("Items completed"),
        in_progress: z.array(z.string()).optional().describe("Items still in progress"),
        blockers: z.array(z.string()).optional().describe("Blocking issues"),
        next_steps: z.array(z.string()).optional().describe("Recommended next actions"),
      },
      async ({ agent_id, project_id, summary, completed, in_progress, blockers, next_steps }) => {
        try {
          const { createHandoff } = require("../db/handoffs.js") as any;
          const handoff = createHandoff({
            agent_id, project_id: project_id ? resolveId(project_id, "projects") : undefined,
            summary, completed, in_progress, blockers, next_steps,
          });
          return { content: [{ type: "text" as const, text: `Handoff created: ${handoff.id.slice(0, 8)} by ${handoff.agent_id || "unknown"}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_latest_handoff")) {
    server.tool(
      "get_latest_handoff",
      "Get the most recent handoff for an agent or project.",
      {
        agent_id: z.string().optional().describe("Filter by agent"),
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ agent_id, project_id }) => {
        try {
          const { getLatestHandoff } = require("../db/handoffs.js") as any;
          const handoff = getLatestHandoff(agent_id, project_id ? resolveId(project_id, "projects") : undefined);
          if (!handoff) return { content: [{ type: "text" as const, text: "No handoffs found." }] };
          const lines = [
            `${handoff.created_at.slice(0, 16)} ${handoff.agent_id || "unknown"}`,
            handoff.summary,
          ];
          if (handoff.completed?.length) lines.push(`Done: ${handoff.completed.join(", ")}`);
          if (handoff.in_progress?.length) lines.push(`In progress: ${handoff.in_progress.join(", ")}`);
          if (handoff.blockers?.length) lines.push(`Blocked: ${handoff.blockers.join(", ")}`);
          if (handoff.next_steps?.length) lines.push(`Next: ${handoff.next_steps.join(", ")}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TASK RELATIONSHIPS ===

  if (shouldRegisterTool("add_task_relationship")) {
    server.tool(
      "add_task_relationship",
      "Create a semantic relationship between two tasks (related_to, conflicts_with, similar_to, duplicates, supersedes, modifies_same_file).",
      {
        source_task_id: z.string().describe("Source task ID"),
        target_task_id: z.string().describe("Target task ID"),
        relationship_type: z.enum(["related_to", "conflicts_with", "similar_to", "duplicates", "supersedes", "modifies_same_file"]).describe("Type of relationship"),
        created_by: z.string().optional().describe("Agent ID who created this relationship"),
      },
      async ({ source_task_id, target_task_id, relationship_type, created_by }) => {
        try {
          const { addTaskRelationship } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
          const rel = addTaskRelationship({
            source_task_id: resolveId(source_task_id),
            target_task_id: resolveId(target_task_id),
            relationship_type,
            created_by,
          });
          return { content: [{ type: "text" as const, text: `Relationship created: ${rel.source_task_id.slice(0,8)} --[${rel.relationship_type}]--> ${rel.target_task_id.slice(0,8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("remove_task_relationship")) {
    server.tool(
      "remove_task_relationship",
      "Remove a semantic relationship between tasks by ID or by source+target+type.",
      {
        id: z.string().optional().describe("Relationship ID to remove"),
        source_task_id: z.string().optional().describe("Source task ID (use with target_task_id + type)"),
        target_task_id: z.string().optional().describe("Target task ID"),
        relationship_type: z.enum(["related_to", "conflicts_with", "similar_to", "duplicates", "supersedes", "modifies_same_file"]).optional(),
      },
      async ({ id, source_task_id, target_task_id, relationship_type }) => {
        try {
          const { removeTaskRelationship, removeTaskRelationshipByPair } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
          let removed = false;
          if (id) {
            removed = removeTaskRelationship(id);
          } else if (source_task_id && target_task_id && relationship_type) {
            removed = removeTaskRelationshipByPair(resolveId(source_task_id), resolveId(target_task_id), relationship_type);
          } else {
            return { content: [{ type: "text" as const, text: "Provide either 'id' or 'source_task_id + target_task_id + relationship_type'" }], isError: true };
          }
          return { content: [{ type: "text" as const, text: removed ? "Relationship removed." : "Relationship not found." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_relationships")) {
    server.tool(
      "get_task_relationships",
      "Get all semantic relationships for a task.",
      {
        task_id: z.string().describe("Task ID"),
        relationship_type: z.enum(["related_to", "conflicts_with", "similar_to", "duplicates", "supersedes", "modifies_same_file"]).optional(),
      },
      async ({ task_id, relationship_type }) => {
        try {
          const { getTaskRelationships } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
          const rels = getTaskRelationships(resolveId(task_id), relationship_type);
          if (rels.length === 0) return { content: [{ type: "text" as const, text: "No relationships found." }] };
          const lines = rels.map(r => `${r.source_task_id.slice(0,8)} --[${r.relationship_type}]--> ${r.target_task_id.slice(0,8)}${r.metadata && Object.keys(r.metadata).length > 0 ? ` (${JSON.stringify(r.metadata)})` : ""}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("detect_file_relationships")) {
    server.tool(
      "detect_file_relationships",
      "Auto-detect tasks that modify the same files and create modifies_same_file relationships.",
      {
        task_id: z.string().describe("Task ID to detect file relationships for"),
      },
      async ({ task_id }) => {
        try {
          const { autoDetectFileRelationships } = require("../db/task-relationships.js") as typeof import("../db/task-relationships.js");
          const created = autoDetectFileRelationships(resolveId(task_id));
          return { content: [{ type: "text" as const, text: created.length > 0 ? `Created ${created.length} file relationship(s).` : "No file overlaps detected." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === KNOWLEDGE GRAPH ===

  if (shouldRegisterTool("sync_kg")) {
    server.tool(
      "sync_kg",
      "Sync all existing relationships into the knowledge graph edges table. Idempotent.",
      {},
      async () => {
        try {
          const { syncKgEdges } = require("../db/kg.js") as typeof import("../db/kg.js");
          const result = syncKgEdges();
          return { content: [{ type: "text" as const, text: `Knowledge graph synced: ${result.synced} edge(s) processed.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_related_entities")) {
    server.tool(
      "get_related_entities",
      "Get entities related to a given entity in the knowledge graph.",
      {
        entity_id: z.string().describe("Entity ID (task, agent, project, file path)"),
        relation_type: z.string().optional().describe("Filter by relation type (depends_on, assigned_to, reports_to, references_file, in_project, in_plan, etc.)"),
        entity_type: z.string().optional().describe("Filter by entity type (task, agent, project, file, plan)"),
        direction: z.enum(["outgoing", "incoming", "both"]).optional().describe("Edge direction"),
        limit: z.number().optional().describe("Max results"),
      },
      async ({ entity_id, relation_type, entity_type, direction, limit }) => {
        try {
          const { getRelated } = require("../db/kg.js") as typeof import("../db/kg.js");
          const edges = getRelated(entity_id, { relation_type, entity_type, direction, limit });
          if (edges.length === 0) return { content: [{ type: "text" as const, text: "No related entities found." }] };
          const lines = edges.map(e => `${e.source_id.slice(0,12)}(${e.source_type}) --[${e.relation_type}]--> ${e.target_id.slice(0,12)}(${e.target_type})`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("find_path")) {
    server.tool(
      "find_path",
      "Find paths between two entities in the knowledge graph.",
      {
        source_id: z.string().describe("Starting entity ID"),
        target_id: z.string().describe("Target entity ID"),
        max_depth: z.number().optional().describe("Maximum path depth (default: 5)"),
        relation_types: z.array(z.string()).optional().describe("Filter by relation types"),
      },
      async ({ source_id, target_id, max_depth, relation_types }) => {
        try {
          const { findPath } = require("../db/kg.js") as typeof import("../db/kg.js");
          const paths = findPath(source_id, target_id, { max_depth, relation_types });
          if (paths.length === 0) return { content: [{ type: "text" as const, text: "No path found." }] };
          const lines = paths.map((path, i) => {
            const steps = path.map(e => `${e.source_id.slice(0,8)} --[${e.relation_type}]--> ${e.target_id.slice(0,8)}`);
            return `Path ${i + 1} (${path.length} hops):\n  ${steps.join("\n  ")}`;
          });
          return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_impact_analysis")) {
    server.tool(
      "get_impact_analysis",
      "Analyze what entities are affected if a given entity changes. Traverses the knowledge graph.",
      {
        entity_id: z.string().describe("Entity ID to analyze impact for"),
        max_depth: z.number().optional().describe("Maximum traversal depth (default: 3)"),
        relation_types: z.array(z.string()).optional().describe("Filter by relation types"),
      },
      async ({ entity_id, max_depth, relation_types }) => {
        try {
          const { getImpactAnalysis } = require("../db/kg.js") as typeof import("../db/kg.js");
          const impact = getImpactAnalysis(entity_id, { max_depth, relation_types });
          if (impact.length === 0) return { content: [{ type: "text" as const, text: "No downstream impact detected." }] };
          const byDepth = new Map<number, typeof impact>();
          for (const i of impact) {
            if (!byDepth.has(i.depth)) byDepth.set(i.depth, []);
            byDepth.get(i.depth)!.push(i);
          }
          const lines = [`Impact analysis: ${impact.length} affected entities`];
          for (const [depth, entities] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
            lines.push(`\nDepth ${depth}:`);
            for (const e of entities) {
              lines.push(`  ${e.entity_id.slice(0,12)} (${e.entity_type}) via ${e.relation}`);
            }
          }
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_critical_path")) {
    server.tool(
      "get_critical_path",
      "Find tasks that block the most downstream work (critical path analysis).",
      {
        project_id: z.string().optional().describe("Filter by project"),
        limit: z.number().optional().describe("Max results (default: 20)"),
      },
      async ({ project_id, limit }) => {
        try {
          const { getCriticalPath } = require("../db/kg.js") as typeof import("../db/kg.js");
          const result = getCriticalPath({ project_id: project_id ? resolveId(project_id, "projects") : undefined, limit });
          if (result.length === 0) return { content: [{ type: "text" as const, text: "No critical path data. Run sync_kg first to populate the knowledge graph." }] };
          const lines = result.map((r, i) => `${i + 1}. ${r.task_id.slice(0,8)} blocks ${r.blocking_count} task(s), max depth ${r.depth}`);
          return { content: [{ type: "text" as const, text: `Critical path:\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === PER-PROJECT ORG CHART ===

  if (shouldRegisterTool("set_project_agent_role")) {
    server.tool(
      "set_project_agent_role",
      "Assign an agent a role on a specific project (client, lead, developer, qa, reviewer, etc.). Per-project roles extend the global org chart.",
      {
        project_id: z.string().describe("Project ID"),
        agent_name: z.string().describe("Agent name"),
        role: z.string().describe("Role on this project (e.g. 'lead', 'developer', 'qa')"),
        is_lead: z.coerce.boolean().optional().describe("Whether this agent is the project lead for this role"),
      },
      async ({ project_id, agent_name, role, is_lead }) => {
        try {
          const { setProjectAgentRole } = require("../db/project-agent-roles.js") as any;
          const { getAgentByName } = require("../db/agents.js") as typeof import("../db/agents.js");
          const agent = getAgentByName(agent_name);
          if (!agent) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_name}` }], isError: true };
          const pid = resolveId(project_id, "projects");
          const result = setProjectAgentRole(pid, agent.id, role, is_lead ?? false);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("get_project_org_chart")) {
    server.tool(
      "get_project_org_chart",
      "Get org chart scoped to a project — global hierarchy with per-project role overrides merged in.",
      {
        project_id: z.string().describe("Project ID"),
        format: z.enum(["text", "json"]).optional().describe("Output format (default: text)"),
        filter_to_project: z.coerce.boolean().optional().describe("Only show agents with a role on this project"),
      },
      async ({ project_id, format, filter_to_project }) => {
        try {
          const { getProjectOrgChart } = require("../db/project-agent-roles.js") as any;
          const pid = resolveId(project_id, "projects");
          const tree = getProjectOrgChart(pid, { filter_to_project });

          if (format === "json") {
            return { content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }] };
          }

          const now = Date.now();
          const ACTIVE_MS = 30 * 60 * 1000;
          function render(nodes: any[], indent = 0): string {
            return nodes.map(n => {
              const prefix = "  ".repeat(indent);
              const title = n.agent.title ? ` — ${n.agent.title}` : "";
              const globalRole = n.agent.role ? ` [${n.agent.role}]` : "";
              const projectRoles = n.project_roles.length > 0 ? ` <${n.project_roles.join(", ")}>` : "";
              const lead = n.is_project_lead ? " ★" : "";
              const lastSeen = new Date(n.agent.last_seen_at).getTime();
              const active = now - lastSeen < ACTIVE_MS ? " ●" : " ○";
              const line = `${prefix}${active} ${n.agent.name}${title}${globalRole}${projectRoles}${lead}`;
              const children = n.reports.length > 0 ? "\n" + render(n.reports, indent + 1) : "";
              return line + children;
            }).join("\n");
          }
          const text = tree.length > 0 ? render(tree) : "No agents in this project's org chart.";
          return { content: [{ type: "text" as const, text }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_project_agent_roles")) {
    server.tool(
      "list_project_agent_roles",
      "List all agent role assignments for a project.",
      {
        project_id: z.string().describe("Project ID"),
      },
      async ({ project_id }) => {
        try {
          const { listProjectAgentRoles } = require("../db/project-agent-roles.js") as any;
          const pid = resolveId(project_id, "projects");
          const roles = listProjectAgentRoles(pid);
          return { content: [{ type: "text" as const, text: JSON.stringify(roles, null, 2) }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  // === AGENT CAPABILITIES ===

  if (shouldRegisterTool("get_capable_agents")) {
    server.tool(
      "get_capable_agents",
      "Find agents that match given capabilities, sorted by match score.",
      {
        capabilities: z.array(z.string()).describe("Required capabilities to match against"),
        min_score: z.number().optional().describe("Minimum match score 0.0-1.0 (default: 0.1)"),
        limit: z.number().optional().describe("Max results"),
      },
      async ({ capabilities, min_score, limit }) => {
        try {
          const { getCapableAgents } = require("../db/agents.js") as typeof import("../db/agents.js");
          const results = getCapableAgents(capabilities, { min_score, limit });
          if (results.length === 0) return { content: [{ type: "text" as const, text: "No agents match the given capabilities." }] };
          const lines = results.map(r => `${r.agent.name} (${r.agent.id}) score:${(r.score * 100).toFixed(0)}% caps:[${r.agent.capabilities.join(",")}]`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === PATROL & REVIEW ===

  if (shouldRegisterTool("patrol_tasks")) {
    server.tool(
      "patrol_tasks",
      "Scan for task issues: stuck tasks, low-confidence completions, orphaned tasks, zombie-blocked tasks, and pending reviews.",
      {
        stuck_minutes: z.number().optional().describe("Minutes threshold for stuck detection (default: 60)"),
        confidence_threshold: z.number().optional().describe("Confidence threshold for low-confidence detection (default: 0.5)"),
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ stuck_minutes, confidence_threshold, project_id }) => {
        try {
          const { patrolTasks } = require("../db/patrol.js") as typeof import("../db/patrol.js");
          const result = patrolTasks({
            stuck_minutes,
            confidence_threshold,
            project_id: project_id ? resolveId(project_id, "projects") : undefined,
          });
          if (result.total_issues === 0) return { content: [{ type: "text" as const, text: "All clear — no issues detected." }] };
          const lines = [`Found ${result.total_issues} issue(s):\n`];
          for (const issue of result.issues) {
            lines.push(`[${issue.severity.toUpperCase()}] ${issue.type}: ${issue.task_title.slice(0,60)} (${issue.task_id.slice(0,8)})`);
            lines.push(`  ${issue.detail}`);
          }
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_review_queue")) {
    server.tool(
      "get_review_queue",
      "Get tasks that need review: requires_approval but unapproved, or low confidence completions.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        limit: z.number().optional().describe("Max results (default: all)"),
      },
      async ({ project_id, limit }) => {
        try {
          const { getReviewQueue } = require("../db/patrol.js") as typeof import("../db/patrol.js");
          const tasks = getReviewQueue({
            project_id: project_id ? resolveId(project_id, "projects") : undefined,
            limit,
          });
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "Review queue is empty." }] };
          const lines = tasks.map(t => {
            const conf = t.confidence != null ? ` confidence:${t.confidence}` : "";
            const approval = t.requires_approval && !t.approved_by ? " [needs approval]" : "";
            return `${(t.short_id || t.id.slice(0,8))} ${t.title.slice(0,60)}${conf}${approval}`;
          });
          return { content: [{ type: "text" as const, text: `Review queue (${tasks.length}):\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("score_task")) {
    server.tool(
      "score_task",
      "Score a completed task's quality (0.0-1.0). Stores in task metadata for agent performance tracking.",
      {
        task_id: z.string().describe("Task ID to score"),
        score: z.number().min(0).max(1).describe("Quality score 0.0-1.0"),
        reviewer_id: z.string().optional().describe("Agent ID of reviewer"),
      },
      async ({ task_id, score, reviewer_id }) => {
        try {
          const { scoreTask } = require("../db/agent-metrics.js") as typeof import("../db/agent-metrics.js");
          scoreTask(resolveId(task_id), score, reviewer_id);
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} scored: ${score}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TIME TRACKING ===

  if (shouldRegisterTool("log_time")) {
    server.tool(
      "log_time",
      "Log time spent on a task.",
      {
        task_id: z.string().describe("Task ID to log time against"),
        minutes: z.number().min(1).describe("Minutes spent"),
        agent_id: z.string().optional().describe("Agent logging the time"),
        started_at: z.string().optional().describe("ISO timestamp when work started"),
        ended_at: z.string().optional().describe("ISO timestamp when work ended"),
        notes: z.string().optional().describe("Notes about what was done"),
      },
      async ({ task_id, minutes, agent_id, started_at, ended_at, notes }) => {
        try {
          const { logTime } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          logTime({ task_id: resolveId(task_id), minutes, agent_id, started_at, ended_at, notes });
          return { content: [{ type: "text" as const, text: `Logged ${minutes} min on task ${task_id.slice(0,8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_time_report")) {
    server.tool(
      "get_time_report",
      "Get time tracking report: actual vs estimated minutes for completed tasks.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        agent_id: z.string().optional().describe("Filter by assignee"),
        since: z.string().optional().describe("ISO date — only tasks completed after this date"),
      },
      async ({ project_id, agent_id, since }) => {
        try {
          const { getTimeReport } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const report = getTimeReport({ project_id: project_id ? resolveId(project_id, "projects") : undefined, agent_id, since });
          if (report.length === 0) return { content: [{ type: "text" as const, text: "No completed tasks found." }] };
          const lines = report.map(r => {
            const est = r.estimated_minutes ?? "?";
            const actual = r.actual_minutes ?? "?";
            const diff = r.estimated_minutes != null && r.actual_minutes != null ? ` (${r.actual_minutes - r.estimated_minutes >= 0 ? "+" : ""}${r.actual_minutes - r.estimated_minutes})` : "";
            return `${r.title.slice(0,50)}: estimated ${est}min, actual ${actual}min${diff}`;
          });
          return { content: [{ type: "text" as const, text: `Time Report:\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TASK WATCHERS ===

  if (shouldRegisterTool("watch_task")) {
    server.tool(
      "watch_task",
      "Subscribe to notifications for a task.",
      {
        task_id: z.string().describe("Task ID to watch"),
        agent_id: z.string().optional().describe("Agent subscribing (defaults to context agent)"),
      },
      async ({ task_id, agent_id }) => {
        try {
          const { watchTask } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          watchTask(resolveId(task_id), agent_id || "");
          return { content: [{ type: "text" as const, text: `Now watching task ${task_id.slice(0,8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("unwatch_task")) {
    server.tool(
      "unwatch_task",
      "Unsubscribe from notifications for a task.",
      {
        task_id: z.string().describe("Task ID to unwatch"),
        agent_id: z.string().optional().describe("Agent unsubscribing (defaults to context agent)"),
      },
      async ({ task_id, agent_id }) => {
        try {
          const { unwatchTask } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          unwatchTask(resolveId(task_id), agent_id || "");
          return { content: [{ type: "text" as const, text: `Stopped watching task ${task_id.slice(0,8)}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_watchers")) {
    server.tool(
      "get_task_watchers",
      "List agents watching a task.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const { getTaskWatchers } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const watchers = getTaskWatchers(resolveId(task_id));
          if (watchers.length === 0) return { content: [{ type: "text" as const, text: "No watchers." }] };
          return { content: [{ type: "text" as const, text: `Watching (${watchers.length}): ${watchers.map(w => w.agent_id).join(", ")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === TODOS RETRO ===

  if (shouldRegisterTool("todos_retro")) {
    server.tool(
      "todos_retro",
      "Post-completion retrospective: stats on completed tasks, low-confidence completions, avg time vs estimate, and patterns.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        plan_id: z.string().optional().describe("Filter by plan"),
        task_list_id: z.string().optional().describe("Filter by task list"),
        since: z.string().optional().describe("ISO date — only tasks completed after this date"),
        agent_id: z.string().optional().describe("Filter by assignee"),
      },
      async ({ project_id, plan_id, task_list_id, since, agent_id }) => {
        try {
          const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const { patrolTasks } = require("../db/patrol.js") as typeof import("../db/patrol.js");
          const completed = listTasks({ status: "completed", project_id, plan_id, task_list_id, assigned_to: agent_id, limit: 500 }, undefined) as any[];
          const filtered = since ? completed.filter((t: any) => t.completed_at && t.completed_at >= since) : completed;
          const total = filtered.length;
          const lowConf = filtered.filter((t: any) => t.confidence != null && t.confidence < 0.7).length;
          const withEstimate = filtered.filter((t: any) => t.estimated_minutes != null && t.actual_minutes != null);
          const avgDiff = withEstimate.length > 0
            ? withEstimate.reduce((acc: number, t: any) => acc + (t.actual_minutes - t.estimated_minutes), 0) / withEstimate.length
            : 0;
          const patrolResult = patrolTasks({ project_id: project_id ? resolveId(project_id, "projects") : undefined });
          const stuck = patrolResult.issues.filter((i: any) => i.type === "stuck").length;
          const lines = [
            `Retro (${total} completed tasks${since ? ` since ${since}` : ""})`,
            `Low confidence: ${lowConf}/${total}`,
            `Avg time vs estimate: ${avgDiff >= 0 ? "+" : ""}${avgDiff.toFixed(1)}min`,
            `Currently stuck: ${stuck}`,
          ];
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === INBOX ===

  if (shouldRegisterTool("todos_inbox")) {
    server.tool(
      "todos_inbox",
      "Get unassigned tasks (GTD inbox) — tasks with no assignee, not yet started.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        limit: z.number().optional().describe("Max results (default: 20)"),
      },
      async ({ project_id, limit }) => {
        try {
          const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const tasks = listTasks({ status: "pending", project_id, assigned_to: "", limit: limit || 20 }, undefined) as any[];
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "Inbox is empty." }] };
          const lines = tasks.map((t: any) => `[${t.priority}] ${t.title.slice(0,60)} (${t.id.slice(0,8)})`);
          return { content: [{ type: "text" as const, text: `Inbox (${tasks.length}):\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === AGENT METRICS & LEADERBOARD ===

  if (shouldRegisterTool("get_agent_metrics")) {
    server.tool(
      "get_agent_metrics",
      "Get performance metrics for an agent: completion rate, speed, confidence, review scores.",
      {
        agent_id: z.string().describe("Agent ID or name"),
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ agent_id, project_id }) => {
        try {
          const { getAgentMetrics } = require("../db/agent-metrics.js") as typeof import("../db/agent-metrics.js");
          const metrics = getAgentMetrics(agent_id, {
            project_id: project_id ? resolveId(project_id, "projects") : undefined,
          });
          if (!metrics) return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
          const lines = [
            `Agent: ${metrics.agent_name} (${metrics.agent_id})`,
            `Completed: ${metrics.tasks_completed} | Failed: ${metrics.tasks_failed} | In Progress: ${metrics.tasks_in_progress}`,
            `Completion Rate: ${(metrics.completion_rate * 100).toFixed(1)}%`,
            metrics.avg_completion_minutes != null ? `Avg Completion Time: ${metrics.avg_completion_minutes} min` : null,
            metrics.avg_confidence != null ? `Avg Confidence: ${(metrics.avg_confidence * 100).toFixed(1)}%` : null,
            metrics.review_score_avg != null ? `Avg Review Score: ${(metrics.review_score_avg * 100).toFixed(1)}%` : null,
            `Composite Score: ${(metrics.composite_score * 100).toFixed(1)}%`,
          ].filter(Boolean);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_leaderboard")) {
    server.tool(
      "get_leaderboard",
      "Get agent leaderboard ranked by composite performance score.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        limit: z.number().optional().describe("Max entries (default: 20)"),
      },
      async ({ project_id, limit }) => {
        try {
          const { getLeaderboard } = require("../db/agent-metrics.js") as typeof import("../db/agent-metrics.js");
          const entries = getLeaderboard({
            project_id: project_id ? resolveId(project_id, "projects") : undefined,
            limit,
          });
          if (entries.length === 0) return { content: [{ type: "text" as const, text: "No agents with task activity found." }] };
          const lines = entries.map(e =>
            `#${e.rank} ${e.agent_name.padEnd(15)} score:${(e.composite_score * 100).toFixed(0).padStart(3)}% done:${String(e.tasks_completed).padStart(3)} rate:${(e.completion_rate * 100).toFixed(0)}%`
          );
          return { content: [{ type: "text" as const, text: `Leaderboard:\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
