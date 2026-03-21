#!/usr/bin/env bun
import { Command } from "commander";
import { getDatabase } from "../db/database.ts";
import { registerBrainsCommand } from "./brains.ts";
import { createProject, getProjectById, getProjectBySlug, listProjects, getProjectStats } from "../db/projects.ts";
import { createTicket, getTicketById, updateTicket, closeTicket, reopenTicket, listTickets, assignTicket, transitionTicket } from "../db/tickets.ts";
import { createComment, listComments } from "../db/comments.ts";
import { createRelation, listRelations, deleteRelation } from "../db/relations.ts";
import { registerAgent, getAgentByName } from "../db/agents.ts";
import { createLabel, listLabels } from "../db/labels.ts";
import { createMilestone, listMilestones, closeMilestone } from "../db/milestones.ts";
import { createWebhook, listWebhooks, deleteWebhook } from "../db/webhooks.ts";
import { searchTickets } from "../db/search.ts";
import type { TicketType, Resolution, Priority, TicketStatus, RelationType, WebhookEvent } from "../types/index.ts";

const pkg = { version: "0.1.0" };

// ── Output helpers ────────────────────────────────────────────────────────────

function out(data: unknown, json: boolean) {
  if (json) { console.log(JSON.stringify(data, null, 2)); return; }
  if (typeof data === "string") { console.log(data); return; }
  console.log(JSON.stringify(data, null, 2));
}

function err(msg: string, json: boolean) {
  if (json) { console.error(JSON.stringify({ error: msg })); } else { console.error(`Error: ${msg}`); }
  process.exit(1);
}

function formatTicket(t: ReturnType<typeof getTicketById>) {
  return `${t.short_id}  ${t.status.padEnd(12)} ${t.priority.padEnd(8)} ${t.title}`;
}

function formatTable(rows: string[]) { rows.forEach((r) => console.log(r)); }

// ── CLI program ───────────────────────────────────────────────────────────────

const program = new Command()
  .name("tickets")
  .description("open-tickets — MCP-native ticketing system")
  .version(pkg.version)
  .option("--json", "Output as JSON")
  .hook("preAction", () => { getDatabase(); }); // ensure DB is initialized

// ── init ─────────────────────────────────────────────────────────────────────

program
  .command("init [workspace-name]")
  .description("Initialize workspace and SQLite database")
  .action((name: string | undefined, _opts, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    const wsName = name ?? "default";
    const db = getDatabase();
    // Create default workspace record if tables allow it
    out({ message: `Workspace "${wsName}" initialized`, db_path: process.env["TICKETS_DB_PATH"] ?? "~/.tickets/tickets.db" }, json);
  });

// ── project ───────────────────────────────────────────────────────────────────

const projectCmd = program.command("project").description("Manage projects");

projectCmd
  .command("add <name>")
  .description("Create a new project")
  .option("--prefix <prefix>", "Ticket prefix (e.g. API)")
  .option("--description <desc>", "Project description")
  .option("--public", "Make project publicly submittable")
  .action((name: string, opts: { prefix?: string; description?: string; public?: boolean }, cmd) => {
    const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
    try {
      const project = createProject({ name, ticket_prefix: opts.prefix, description: opts.description, is_public: opts.public });
      if (json) { out(project, true); return; }
      console.log(`Created project: ${project.name} [${project.ticket_prefix}] (ID: ${project.id})`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

projectCmd
  .command("list")
  .description("List all projects")
  .action((_opts, cmd) => {
    const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
    const projects = listProjects();
    if (json) { out(projects, true); return; }
    if (projects.length === 0) { console.log("No projects yet. Run: tickets project add <name>"); return; }
    console.log(`${"NAME".padEnd(20)} ${"PREFIX".padEnd(8)} ${"TICKETS".padEnd(8)} ID`);
    for (const p of projects) {
      console.log(`${p.name.padEnd(20)} ${p.ticket_prefix.padEnd(8)} ${String(p.ticket_counter).padEnd(8)} ${p.id}`);
    }
  });

projectCmd
  .command("show <id>")
  .description("Show project details and stats")
  .action((id: string, _opts, cmd) => {
    const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
    try {
      const project = getProjectBySlug(id) ?? getProjectById(id);
      const stats = getProjectStats(project.id);
      if (json) { out({ project, stats }, true); return; }
      console.log(`Project: ${project.name} [${project.ticket_prefix}]`);
      console.log(`Total: ${stats.total}  Open: ${stats.open}  In progress: ${stats.in_progress}  Resolved: ${stats.resolved}  Closed: ${stats.closed}`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── open ──────────────────────────────────────────────────────────────────────

program
  .command("open <title>")
  .description("Open a new ticket")
  .option("--project <slug-or-id>", "Project slug or ID")
  .option("--type <type>", "Type: bug|feature|question|incident|improvement|task", "bug")
  .option("--priority <priority>", "Priority: none|low|medium|high|critical", "none")
  .option("--severity <severity>", "Severity: minor|moderate|major|critical|blocker")
  .option("--label <labels>", "Comma-separated labels")
  .option("--assignee <name>", "Agent name to assign to")
  .option("--description <desc>", "Description text")
  .option("--due <date>", "Due date (YYYY-MM-DD)")
  .action(async (title: string, opts: { project?: string; type?: string; priority?: string; severity?: string; label?: string; assignee?: string; description?: string; due?: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      let projectId: string | undefined;
      if (opts.project) {
        const p = getProjectBySlug(opts.project) ?? getProjectById(opts.project);
        projectId = p.id;
      } else {
        const projects = listProjects();
        if (projects.length === 0) err("No projects found. Run: tickets project add <name>", json);
        projectId = projects[0]!.id;
      }

      let assigneeId: string | undefined;
      if (opts.assignee) {
        const agent = getAgentByName(opts.assignee);
        assigneeId = agent?.id;
      }

      const ticket = createTicket({
        project_id: projectId!,
        title,
        description: opts.description,
        type: opts.type as TicketType,
        priority: opts.priority as Priority,
        severity: opts.severity as any,
        assignee_id: assigneeId,
        labels: opts.label ? opts.label.split(",").map((l) => l.trim()) : undefined,
        due_date: opts.due,
        source: "cli",
      });

      if (json) { out(ticket, true); return; }
      console.log(`✓ Created ${ticket.short_id}: ${ticket.title}`);
      console.log(`  Status: ${ticket.status}  Priority: ${ticket.priority}  Type: ${ticket.type}`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List tickets")
  .option("--project <slug-or-id>", "Filter by project")
  .option("--status <status>", "Filter by status")
  .option("--priority <priority>", "Filter by priority")
  .option("--type <type>", "Filter by type")
  .option("--assignee <name>", "Filter by assignee")
  .option("--label <label>", "Filter by label")
  .option("--overdue", "Only SLA-breached tickets")
  .option("--unassigned", "Only unassigned tickets")
  .option("--page <n>", "Page number", "1")
  .option("--per-page <n>", "Results per page", "25")
  .action((opts: { project?: string; status?: string; priority?: string; type?: string; assignee?: string; label?: string; overdue?: boolean; unassigned?: boolean; page?: string; perPage?: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      let projectId: string | undefined;
      if (opts.project) {
        const p = getProjectBySlug(opts.project) ?? getProjectById(opts.project);
        projectId = p.id;
      }

      let assigneeId: string | undefined;
      if (opts.assignee) {
        const agent = getAgentByName(opts.assignee);
        assigneeId = agent?.id;
      }

      const result = listTickets({
        project_id: projectId,
        status: opts.status as TicketStatus | undefined,
        priority: opts.priority as Priority | undefined,
        type: opts.type as TicketType | undefined,
        assignee_id: assigneeId,
        label: opts.label,
        sla_breached: opts.overdue ? true : undefined,
        page: opts.page ? parseInt(opts.page) : 1,
        per_page: opts.perPage ? parseInt(opts.perPage) : 25,
      });

      // Filter unassigned post-query
      const tickets = opts.unassigned ? result.tickets.filter((t) => !t.assignee_id) : result.tickets;

      if (json) { out({ tickets, total: result.total }, true); return; }
      if (tickets.length === 0) { console.log("No tickets found."); return; }
      console.log(`${"ID".padEnd(12)} ${"STATUS".padEnd(12)} ${"PRIORITY".padEnd(10)} TITLE`);
      formatTable(tickets.map(formatTicket));
      console.log(`\n${tickets.length} of ${result.total} tickets`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── show ──────────────────────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("Show full ticket details")
  .action((id: string, _opts, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      const ticket = getTicketById(id);
      if (json) { out(ticket, true); return; }
      console.log(`\n${ticket.short_id}  ${ticket.title}`);
      console.log(`${"─".repeat(60)}`);
      console.log(`Type:     ${ticket.type}`);
      console.log(`Status:   ${ticket.status}${ticket.resolution ? ` (${ticket.resolution})` : ""}`);
      console.log(`Priority: ${ticket.priority}${ticket.severity ? ` / ${ticket.severity}` : ""}`);
      if (ticket.assignee_id) console.log(`Assignee: ${ticket.assignee_id}`);
      if (ticket.labels.length) console.log(`Labels:   ${ticket.labels.join(", ")}`);
      if (ticket.due_date) console.log(`Due:      ${ticket.due_date}`);
      console.log(`Created:  ${ticket.created_at}`);
      if (ticket.description) { console.log(`\n${ticket.description}`); }

      const comments = listComments(ticket.id, false);
      if (comments.length > 0) {
        console.log(`\nComments (${comments.length}):`);
        for (const c of comments) console.log(`  [${c.created_at.slice(0, 10)}] ${c.content.slice(0, 120)}`);
      }
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── update ────────────────────────────────────────────────────────────────────

program
  .command("update <id>")
  .description("Update ticket fields")
  .option("--title <title>", "New title")
  .option("--priority <priority>", "New priority")
  .option("--status <status>", "New status")
  .option("--assignee <name>", "Assign to agent (use 'none' to unassign)")
  .option("--label <labels>", "Set labels (comma-separated)")
  .option("--due <date>", "Due date (YYYY-MM-DD)")
  .action((id: string, opts: { title?: string; priority?: string; status?: string; assignee?: string; label?: string; due?: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      if (opts.status) {
        transitionTicket(id, opts.status as TicketStatus);
      }
      if (opts.assignee) {
        const assigneeId = opts.assignee === "none" ? null : (getAgentByName(opts.assignee)?.id ?? opts.assignee);
        assignTicket(id, assigneeId);
      }
      const ticket = updateTicket(id, {
        title: opts.title,
        priority: opts.priority as Priority | undefined,
        labels: opts.label ? opts.label.split(",").map((l) => l.trim()) : undefined,
        due_date: opts.due,
      });
      if (json) { out(ticket, true); return; }
      console.log(`✓ Updated ${ticket.short_id}`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── close ─────────────────────────────────────────────────────────────────────

program
  .command("close <id>")
  .description("Close a ticket")
  .requiredOption("--resolution <resolution>", "Resolution: fixed|wont_fix|duplicate|invalid|by_design")
  .option("--of <id>", "Duplicate of ticket ID (when resolution=duplicate)")
  .option("--reason <text>", "Reason (added as comment)")
  .action((id: string, opts: { resolution: string; of?: string; reason?: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      const ticket = closeTicket(id, { resolution: opts.resolution as Resolution, duplicate_of: opts.of });
      if (opts.reason) createComment({ ticket_id: ticket.id, content: opts.reason });
      if (json) { out(ticket, true); return; }
      console.log(`✓ Closed ${ticket.short_id} (${opts.resolution})`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── reopen ────────────────────────────────────────────────────────────────────

program
  .command("reopen <id>")
  .description("Reopen a closed or resolved ticket")
  .option("--reason <text>", "Reason for reopening")
  .action((id: string, opts: { reason?: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      const ticket = reopenTicket(id);
      if (opts.reason) createComment({ ticket_id: ticket.id, content: opts.reason });
      if (json) { out(ticket, true); return; }
      console.log(`✓ Reopened ${ticket.short_id}`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── assign ────────────────────────────────────────────────────────────────────

program
  .command("assign <id>")
  .description("Assign ticket to an agent")
  .requiredOption("--to <name>", "Agent name (use 'none' to unassign)")
  .action((id: string, opts: { to: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      const assigneeId = opts.to === "none" ? null : (getAgentByName(opts.to)?.id ?? opts.to);
      const ticket = assignTicket(id, assigneeId);
      if (json) { out(ticket, true); return; }
      console.log(`✓ ${ticket.short_id} assigned to ${opts.to === "none" ? "nobody" : opts.to}`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── comment ───────────────────────────────────────────────────────────────────

program
  .command("comment <id> <text>")
  .description("Add a comment to a ticket")
  .option("--internal", "Mark as internal note")
  .action((id: string, text: string, opts: { internal?: boolean }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      const ticket = getTicketById(id);
      const comment = createComment({ ticket_id: ticket.id, content: text, is_internal: opts.internal });
      if (json) { out(comment, true); return; }
      console.log(`✓ Comment added to ${ticket.short_id}`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

program
  .command("comments <id>")
  .description("List comments on a ticket")
  .option("--internal", "Include internal notes")
  .action((id: string, opts: { internal?: boolean }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      const ticket = getTicketById(id);
      const comments = listComments(ticket.id, opts.internal ?? false);
      if (json) { out(comments, true); return; }
      if (comments.length === 0) { console.log("No comments."); return; }
      for (const c of comments) {
        console.log(`[${c.created_at.slice(0, 16)}]${c.is_internal ? " [internal]" : ""} ${c.content}`);
      }
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── link / unlink ─────────────────────────────────────────────────────────────

program
  .command("link <id>")
  .description("Link two tickets")
  .option("--blocks <id>", "This ticket blocks <id>")
  .option("--blocked-by <id>", "This ticket is blocked by <id>")
  .option("--duplicates <id>", "This ticket duplicates <id>")
  .option("--relates-to <id>", "This ticket relates to <id>")
  .option("--caused-by <id>", "This ticket was caused by <id>")
  .action((id: string, opts: Record<string, string | undefined>, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      const ticket = getTicketById(id);
      let relationType: RelationType | undefined;
      let relatedId: string | undefined;
      if (opts["blocks"]) { relationType = "blocks"; relatedId = opts["blocks"]; }
      else if (opts["blockedBy"]) { relationType = "blocked_by"; relatedId = opts["blockedBy"]; }
      else if (opts["duplicates"]) { relationType = "duplicates"; relatedId = opts["duplicates"]; }
      else if (opts["relatesTo"]) { relationType = "relates_to"; relatedId = opts["relatesTo"]; }
      else if (opts["causedBy"]) { relationType = "caused_by"; relatedId = opts["causedBy"]; }
      if (!relationType || !relatedId) err("Specify a relation type (--blocks, --duplicates, etc.)", json);
      const related = getTicketById(relatedId!);
      createRelation(ticket.id, related.id, relationType!);
      if (json) { out({ linked: true }, true); return; }
      console.log(`✓ Linked: ${ticket.short_id} ${relationType} ${related.short_id}`);
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── search ────────────────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Full-text search across tickets")
  .option("--project <slug-or-id>", "Scope to project")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Max results", "20")
  .action((query: string, opts: { project?: string; status?: string; limit?: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      let projectId: string | undefined;
      if (opts.project) { const p = getProjectBySlug(opts.project) ?? getProjectById(opts.project); projectId = p.id; }
      const result = searchTickets(query, { project_id: projectId, status: opts.status as TicketStatus | undefined, per_page: opts.limit ? parseInt(opts.limit) : 20 });
      if (json) { out(result, true); return; }
      if (result.tickets.length === 0) { console.log(`No results for "${query}"`); return; }
      console.log(`${result.total} results for "${query}":`);
      formatTable(result.tickets.map(formatTicket));
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── stats ─────────────────────────────────────────────────────────────────────

program
  .command("stats")
  .description("Show ticket statistics")
  .option("--project <slug-or-id>", "Project stats")
  .action((opts: { project?: string }, cmd) => {
    const json = cmd.parent?.opts()["json"] as boolean ?? false;
    try {
      if (opts.project) {
        const p = getProjectBySlug(opts.project) ?? getProjectById(opts.project);
        const stats = getProjectStats(p.id);
        if (json) { out(stats, true); return; }
        console.log(`${p.name} [${p.ticket_prefix}] stats:`);
        console.log(`  Total: ${stats.total}  Open: ${stats.open}  In progress: ${stats.in_progress}  Resolved: ${stats.resolved}  Closed: ${stats.closed}`);
      } else {
        const projects = listProjects();
        if (json) {
          const all = projects.map((p) => ({ project: p.name, ...getProjectStats(p.id) }));
          out(all, true); return;
        }
        for (const p of projects) {
          const s = getProjectStats(p.id);
          console.log(`${p.name.padEnd(20)} total=${s.total}  open=${s.open}  closed=${s.closed}`);
        }
      }
    } catch (e) { err(e instanceof Error ? e.message : String(e), json); }
  });

// ── label ─────────────────────────────────────────────────────────────────────

const labelCmd = program.command("label").description("Manage labels");
labelCmd.command("add <name>").option("--project <id>", "Project ID").option("--color <hex>", "Hex color").action((name: string, opts: { project?: string; color?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const projects = listProjects();
  const projectId = opts.project ?? projects[0]?.id;
  if (!projectId) err("No project found", json);
  const label = createLabel(projectId!, name, opts.color);
  if (json) { out(label, true); return; }
  console.log(`✓ Label "${name}" created`);
});
labelCmd.command("list").option("--project <id>", "Project ID").action((opts: { project?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const projects = listProjects();
  const projectId = opts.project ?? projects[0]?.id;
  if (!projectId) err("No project found", json);
  const labels = listLabels(projectId!);
  if (json) { out(labels, true); return; }
  for (const l of labels) console.log(`  ${l.color}  ${l.name}${l.description ? `  — ${l.description}` : ""}`);
});

// ── milestone ─────────────────────────────────────────────────────────────────

const msCmd = program.command("milestone").description("Manage milestones");
msCmd.command("add <name>").option("--project <id>", "Project ID").option("--due <date>", "Due date YYYY-MM-DD").option("--description <desc>").action((name: string, opts: { project?: string; due?: string; description?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const projects = listProjects();
  const projectId = opts.project ?? projects[0]?.id;
  if (!projectId) err("No project found", json);
  const ms = createMilestone(projectId!, name, opts.description, opts.due);
  if (json) { out(ms, true); return; }
  console.log(`✓ Milestone "${name}" created${opts.due ? ` (due ${opts.due})` : ""}`);
});
msCmd.command("list").option("--project <id>", "Project ID").action((opts: { project?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const projects = listProjects();
  const projectId = opts.project ?? projects[0]?.id;
  if (!projectId) err("No project found", json);
  const milestones = listMilestones(projectId!);
  if (json) { out(milestones, true); return; }
  for (const m of milestones) console.log(`  [${m.status}] ${m.name}${m.due_date ? `  due ${m.due_date}` : ""}`);
});
msCmd.command("close <id>").action((id: string, _opts, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const ms = closeMilestone(id);
  if (json) { out(ms, true); return; }
  console.log(`✓ Milestone "${ms.name}" closed`);
});

// ── agent ─────────────────────────────────────────────────────────────────────

const agentCmd = program.command("agent").description("Manage agents");
agentCmd.command("register <name>").option("--type <type>", "human|ai_agent", "human").option("--email <email>").action((name: string, opts: { type?: string; email?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const agent = registerAgent({ name, type: opts.type as "human" | "ai_agent", email: opts.email });
  if (json) { out(agent, true); return; }
  console.log(`✓ Agent "${agent.name}" registered (ID: ${agent.id})`);
});

// ── webhook ───────────────────────────────────────────────────────────────────

const whCmd = program.command("webhook").description("Manage webhooks");
whCmd.command("add <url>").option("--events <events>", "Comma-separated events", "ticket.created,ticket.closed").option("--project <id>").action((url: string, opts: { events?: string; project?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const events = (opts.events ?? "ticket.created,ticket.closed").split(",").map((e) => e.trim()) as WebhookEvent[];
  const wh = createWebhook(url, events, { project_id: opts.project });
  if (json) { out(wh, true); return; }
  console.log(`✓ Webhook created (ID: ${wh.id})\n  Secret: ${wh.secret}`);
});
whCmd.command("list").action((_opts, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const whs = listWebhooks();
  if (json) { out(whs, true); return; }
  for (const w of whs) console.log(`  ${w.id.slice(0, 8)}  ${w.url}  active=${w.is_active}  failures=${w.failure_count}`);
});
whCmd.command("remove <id>").action((id: string, _opts, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  deleteWebhook(id);
  if (!json) console.log(`✓ Webhook ${id} removed`);
});

// ── serve + mcp ───────────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the web dashboard and API server")
  .option("--port <port>", "Port", "19428")
  .action((opts: { port?: string }) => {
    process.env["PORT"] = opts.port ?? "19428";
    import("../server/index.ts");
  });

program
  .command("mcp")
  .description("Register MCP server with AI agents")
  .option("--claude", "Register with Claude Code")
  .option("--codex", "Register with Codex")
  .option("--gemini", "Register with Gemini")
  .option("--all", "Register with all agents")
  .action(async (opts: { claude?: boolean; codex?: boolean; gemini?: boolean; all?: boolean }) => {
    const { execSync } = await import("node:child_process");
    const mcpPath = new URL("../mcp/index.ts", import.meta.url).pathname;
    if (opts.claude || opts.all) {
      try { execSync(`claude mcp add --transport stdio --scope user open-tickets -- bun run ${mcpPath}`, { stdio: "inherit" }); console.log("✓ Registered with Claude Code"); } catch { console.error("✗ Claude Code: claude CLI not found"); }
    }
    if (!opts.claude && !opts.codex && !opts.gemini && !opts.all) {
      console.log("Specify --claude, --codex, --gemini, or --all");
    }
  });

// ── email ─────────────────────────────────────────────────────────────────────

const emailCmd = program.command("email").description("Email configuration");
emailCmd.command("config").option("--provider <provider>", "ses|resend|smtp|console").option("--from <email>", "From email address").action((opts: { provider?: string; from?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const config: Record<string, string> = {};
  if (opts.provider) config["EMAIL_PROVIDER"] = opts.provider;
  if (opts.from) config["TICKETS_FROM_EMAIL"] = opts.from;
  if (json) { out(config, true); return; }
  console.log("Email config (add to your .env file):");
  for (const [k, v] of Object.entries(config)) console.log(`  ${k}=${v}`);
});
emailCmd.command("inbound-url").option("--project <id>", "Project ID").action((opts: { project?: string }) => {
  const base = process.env["TICKETS_BASE_URL"] ?? "http://localhost:19428";
  const qs = opts.project ? `?project_id=${opts.project}` : "";
  console.log("Inbound email webhook URLs:");
  console.log(`  SES:    ${base}/api/email/inbound/ses${qs}`);
  console.log(`  Resend: ${base}/api/email/inbound/resend${qs}`);
  console.log(`  SMTP:   ${base}/api/email/inbound/smtp${qs}`);
});

// ── domain ────────────────────────────────────────────────────────────────────

const domainCmd = program.command("domain").description("Manage custom domains");
domainCmd.command("add <domain>").option("--project <id>", "Project ID").action(async (domain: string, opts: { project?: string }, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const { createDomain, generateVerificationToken } = await import("../db/domains.ts");
  const d = createDomain(domain, { project_id: opts.project });
  const token = generateVerificationToken(d.id, "verify");
  if (json) { out({ domain: d, verification_token: token }, true); return; }
  console.log(`✓ Domain "${domain}" added (ID: ${d.id})`);
  console.log(`\nAdd this DNS TXT record to verify:`);
  console.log(`  Host:  _tickets-verify.${domain}`);
  console.log(`  Value: ${token}`);
  console.log(`\nThen run: tickets domain verify ${domain}`);
});
domainCmd.command("verify <domain>").action(async (domain: string, _opts, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const { getDomainByName, verifyDomain } = await import("../db/domains.ts");
  const d = getDomainByName(domain);
  if (!d) err(`Domain "${domain}" not found`, json);
  const verified = verifyDomain(d!.id);
  if (json) { out(verified, true); return; }
  console.log(`✓ Domain "${domain}" verified`);
});
domainCmd.command("list").action(async (_opts, cmd) => {
  const json = cmd.parent?.parent?.opts()["json"] as boolean ?? false;
  const { listDomains } = await import("../db/domains.ts");
  const domains = listDomains();
  if (json) { out(domains, true); return; }
  for (const d of domains) console.log(`  ${d.verified ? "✓" : "○"}  ${d.domain}  project=${d.project_id ?? "none"}`);
});

// ── brains ────────────────────────────────────────────────────────────────────

registerBrainsCommand(program);

program.parse();
