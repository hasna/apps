// @ts-nocheck
/**
 * Task meta tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface TaskMetaContext {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (error: unknown) => string;
}

export function registerTaskMetaTools(server: McpServer, ctx: TaskMetaContext) {
  const { shouldRegisterTool, formatError } = ctx;

  // === META / HELP ===

  if (shouldRegisterTool("search_tools")) {
    server.tool(
      "search_tools",
      "Search available MCP tools by keyword. Returns matching tool names and descriptions.",
      {
        query: z.string().describe("Search query"),
      },
      async ({ query }) => {
        try {
          const { listTools } = require("@modelcontextprotocol/sdk/server/mcp.js") as any;
          // We have access to the server's tool list through introspection
          // Since we can't directly access server.tools, we return a helpful message
          return {
            content: [{
              type: "text" as const,
              text: `Search for "${query}": This tool requires runtime introspection which is not available at startup. Use describe_tools to list all available tools.`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("describe_tools")) {
    server.tool(
      "describe_tools",
      "Get detailed documentation for a specific tool including all parameters and descriptions.",
      {
        tool_name: z.string().describe("Tool name to describe"),
      },
      async ({ tool_name }) => {
        try {
          // Return documentation for known tools
          const toolDocs: Record<string, string> = {
            create_task: "create_task — Create a new task. Params: title (required), description, status, priority, project_id, task_list_id, assigned_to, depends_on, short_id (null to disable), tags, estimate (minutes), confidence (0.0-1.0), deadline (ISO), retry_count",
            list_tasks: "list_tasks — List tasks with filters. Params: status, priority, project_id, task_list_id, assigned_to, tags[], created_after, created_before, limit, offset",
            get_task: "get_task — Get compact task details by default. Params: task_id, detail=compact|full, max_description_chars, include_metadata",
            update_task: "update_task — Update task fields (optimistic locking). Params: task_id (required), title, description, status, priority, assigned_to (null to unassign), project_id, task_list_id, depends_on[], tags[], estimate, actual_minutes, confidence, approved_by, completed_at, deadline, retry_count, version",
            delete_task: "delete_task — Delete a task. Params: task_id, force (skip child check)",
            start_task: "start_task — Mark task in_progress. Params: task_id, version",
            complete_task: "complete_task — Mark task completed. Params: task_id, confidence, completed_at, version",
            cancel_task: "cancel_task — Cancel a task. Params: task_id, version",
            reassign_task: "reassign_task — Change task assignee. Params: task_id, new_assignee, version",
            move_task: "move_task — Re-parent a task to another project and/or task list (keeps its id and history). Params: task_id (required), to_project, to_list, clear_list, version",
            reschedule_task: "reschedule_task — Update deadline. Params: task_id, deadline, version",
            prioritize_task: "prioritize_task — Set priority. Params: task_id, priority, version",
            search_tasks: "search_tasks — Full-text search. Params: query, project_id, status, limit",
            save_search_view: "save_search_view — Save a local search view across tasks, projects, plans, runs, comments, or all records. Params: name, query, scope, description, project_id, status, priority, assigned_to, agent_id, tags, limit",
            list_search_views: "list_search_views — List local saved search views. Params: scope",
            run_search_view: "run_search_view — Run a local saved search view and return stable JSON results. Params: name",
            delete_search_view: "delete_search_view — Delete a local saved search view. Params: name",
            get_my_tasks: "get_my_tasks — Get tasks for calling agent. Params: agent_id, status, project_id, limit",
            get_next_task: "get_next_task — Get the next available task without claiming it. Params: agent_id, project_id, task_list_id, plan_id, tags",
            claim_next_task: "claim_next_task — Atomically claim and start the next available task. Params: agent_id, project_id, task_list_id, plan_id, tags, steal_stale, stale_minutes",
            get_tasks_changed_since: "get_tasks_changed_since — List tasks changed since an ISO timestamp. Params: since, project_id, task_list_id, limit",
            get_context: "get_context — Get compact session start context by default. Params: agent_id, project_id, task_list_id, explain_blocked, detail=compact|full, max_description_chars",
            bootstrap: "bootstrap — Bootstrap an agent session with compact queue context by default. Params: agent_id, project_id, task_list_id, explain_blocked, detail=compact|full, max_description_chars",
            standup: "standup — Get standup report. Params: agent_id, project_id",
            patrol_tasks: "patrol_tasks — Scan for task issues. Params: stuck_minutes, confidence_threshold, project_id",
            get_review_queue: "get_review_queue — Get tasks needing review. Params: project_id, limit",
            list_review_queue: "list_review_queue — List explicit local review queue items. Params: queue, state, reviewer, requester, project_id, limit",
            request_review_queue: "request_review_queue — Request local review and route task into a queue. Params: task_id, requester, reviewer, queue, reason, notes",
            claim_review_item: "claim_review_item — Claim a queued review item. Params: task_id, reviewer, note",
            approve_review_item: "approve_review_item — Approve a queued review item. Params: task_id, reviewer, note",
            return_review_item: "return_review_item — Return a queued review item with requested changes. Params: task_id, reviewer, note, changes_requested",
            reopen_review_item: "reopen_review_item — Reopen a queued review item for another pass. Params: task_id, reviewer, note",
            set_review_routing_rule: "set_review_routing_rule — Create or update local review routing. Params: name, queue, reviewers, tags, priorities, project_id, enabled",
            list_review_routing_rules: "list_review_routing_rules — List local review routing rules.",
            remove_review_routing_rule: "remove_review_routing_rule — Remove local review routing. Params: name",
            set_task_contract: "set_task_contract — Set acceptance criteria, required verification commands, artifacts, files, risk, and done definition. Params: task_id, acceptance_criteria, verification_commands, expected_artifacts, relevant_files, risk_level, done_definition",
            get_task_contract: "get_task_contract — Get local task contract and review state. Params: task_id",
            request_task_review: "request_task_review — Request review for a task. Params: task_id, requester, reviewer, notes",
            record_task_review: "record_task_review — Record approved, changes_requested, or reopened review state. Params: task_id, state, reviewer, notes, changes_requested",
            check_task_done_contract: "check_task_done_contract — Check status, verification evidence, artifacts, and review state against the local task contract. Params: task_id",
            generate_release_notes: "generate_release_notes — Generate local release notes/changelog JSON or Markdown from completed tasks, plans, commits, and verification evidence. Params: project_id, plan_id, task_ids, tag, since, until, title, version, format",
            bootstrap_project: "bootstrap_project — Discover a local workspace and initialize project identity, default task list, and source metadata. Params: path, name, task_list_slug, dry_run",
            create_project: "create_project — Create a project. Params: name, description, status, short_id, metadata",
            list_projects: "list_projects — List projects. Params: status, limit",
            get_project: "get_project — Get project details. Params: project_id",
            update_project: "update_project — Update project. Params: project_id, name, description, status, metadata",
            delete_project: "delete_project — Delete project. Params: project_id, force",
            create_task_list: "create_task_list — Create a task list. Params: name, project_id, description, status",
            list_task_lists: "list_task_lists — List task lists. Params: project_id, status",
            get_task_list: "get_task_list — Get task list with tasks. Params: task_list_id, include_tasks",
            update_task_list: "update_task_list — Update task list. Params: task_list_id, name, description, status",
            delete_task_list: "delete_task_list — Delete task list. Params: task_list_id, force",
            create_plan: "create_plan — Create a plan/sprint. Params: name, project_id, description, start_date, end_date, status",
            list_plans: "list_plans — List plans. Params: project_id, status",
            get_plan: "get_plan — Get plan with tasks. Params: plan_id, include_tasks",
            update_plan: "update_plan — Update plan. Params: plan_id, name, description, start_date, end_date, status",
            delete_plan: "delete_plan — Delete plan. Params: plan_id, force",
            create_roadmap: "create_roadmap — Create a local roadmap. Params: name, description, project_id, status, owner, agent_id, release",
            list_roadmaps: "list_roadmaps — List local roadmaps. Params: project_id, status",
            get_roadmap_summary: "get_roadmap_summary — Get computed roadmap progress, milestone, release, and blocker summary. Params: roadmap_id, format",
            update_roadmap: "update_roadmap — Update a local roadmap. Params: roadmap_id, name, description, project_id, status, owner, agent_id, release",
            delete_roadmap: "delete_roadmap — Delete a local roadmap and its milestone/release config. Params: roadmap_id",
            create_milestone: "create_milestone — Add a milestone to a roadmap. Params: roadmap_id, title, description, due_at, status, owner, agent_id, task_ids, plan_ids, run_ids, release, tags",
            update_milestone: "update_milestone — Update a local milestone. Params: milestone_id, title, description, due_at, status, owner, agent_id, task_ids, plan_ids, run_ids, release, tags",
            delete_milestone: "delete_milestone — Delete a local milestone. Params: milestone_id",
            set_release_group: "set_release_group — Create or update a local roadmap release grouping. Params: roadmap_id, name, version, status, milestone_ids, task_ids, plan_ids, run_ids, notes",
            export_roadmap: "export_roadmap — Export a roadmap JSON bundle or Markdown. Params: roadmap_id, format",
            import_roadmap: "import_roadmap — Preview or apply a roadmap JSON bundle. Params: bundle, apply",
            set_capacity_profile: "set_capacity_profile — Create or update a local agent capacity profile. Params: agent_id, project_id, minutes_per_day, working_days, effective_from",
            list_capacity_profiles: "list_capacity_profiles — List local capacity profiles. Params: agent_id, project_id",
            remove_capacity_profile: "remove_capacity_profile — Remove a local capacity profile. Params: agent_id_or_id, project_id",
            get_planning_forecast: "get_planning_forecast — Forecast local plan or project completion from estimates, actuals, capacity, and due dates. Params: project_id, plan_id, agent_id, start_date, format",
            get_audit_ledger: "get_audit_ledger — Build a tamper-evident local audit hash chain. Params: project_id, task_id, run_id, include_entries, format",
            seal_audit_ledger: "seal_audit_ledger — Store a local audit ledger checkpoint. Params: name, project_id, task_id, run_id, agent_id, note",
            list_audit_ledger_checkpoints: "list_audit_ledger_checkpoints — List sealed local audit ledger checkpoints.",
            verify_audit_ledger: "verify_audit_ledger — Verify current local evidence against a checkpoint. Params: checkpoint, format",
            create_tag: "create_tag — Create a tag. Params: name, color, description",
            list_tags: "list_tags — List all tags",
            get_tag: "get_tag — Get tag with tasks. Params: tag_id",
            update_tag: "update_tag — Update tag. Params: tag_id, name, color, description",
            delete_tag: "delete_tag — Delete tag. Params: tag_id",
            create_label: "create_label — Create a label. Params: name, color, description",
            list_labels: "list_labels — List all labels",
            get_label: "get_label — Get label with tasks. Params: label_id",
            update_label: "update_label — Update label. Params: label_id, name, color, description",
            delete_label: "delete_label — Delete label. Params: label_id",
            add_task_dependency: "add_task_dependency — Add dependency. Params: task_id, depends_on",
            remove_task_dependency: "remove_task_dependency — Remove dependency. Params: task_id, depends_on",
            get_task_dependencies: "get_task_dependencies — Get dependency tree. Params: task_id, direction",
            add_task_relationship: "add_task_relationship — Add semantic relationship. Params: source_task_id, target_task_id, relationship_type, created_by",
            remove_task_relationship: "remove_task_relationship — Remove relationship. Params: id or source_task_id+target_task_id+type",
            get_task_relationships: "get_task_relationships — Get all relationships. Params: task_id, relationship_type",
            create_handoff: "create_handoff — Create local session handoff with tasks/files/runs. Params: agent_id, summary, task_ids, relevant_files, run_ids",
            list_handoffs: "list_handoffs — List local handoffs. Params: agent_id, project_id, unread_for, limit",
            read_handoff: "read_handoff — Read one handoff by ID or prefix. Params: handoff_id",
            acknowledge_handoff: "acknowledge_handoff — Mark a handoff read for an agent. Params: handoff_id, agent_id",
            recover_stale_session_handoff: "recover_stale_session_handoff — Capture active stale session context into a handoff. Params: agent_id, session_id, project_id",
            create_comment: "create_comment — Add comment. Params: task_id, body, author",
            list_comments: "list_comments — List comments. Params: task_id",
            get_comments: "get_comments — List recent comments by default. Params: task_id, detail=compact|full, limit",
            get_activity_timeline: "get_activity_timeline — Unified local timeline across comments, task history, and run evidence. Params: entity_type, entity_id, limit, offset, order, since, until",
            get_task_fields: "get_task_fields — Get local labels, priority, severity, owner, area, and custom fields. Params: task_id",
            set_task_fields: "set_task_fields — Set local labels, priority, severity, owner, area, and custom fields. Params: task_id, labels[], priority, severity, owner, area, custom, merge_custom",
            query_tasks_by_fields: "query_tasks_by_fields — Query tasks by local labels, priority, severity, owner, area, and custom fields. Params: labels[], priority, severity, owner, area, custom, limit",
            find_duplicate_tasks: "find_duplicate_tasks — Find likely duplicate local tasks. Params: threshold, limit, include_archived",
            merge_duplicate_task: "merge_duplicate_task — Merge a duplicate task into a primary task and archive the duplicate. Params: primary_task_id, duplicate_task_id, agent_id, reason",
            create_calendar_item: "create_calendar_item — Create a local reminder, milestone, or work block. Params: title, kind, starts_at, ends_at, timezone, task_id, plan_id, run_id",
            list_calendar_events: "list_calendar_events — List local calendar events from tasks, SLA thresholds, runs, and local items. Params: project_id, task_id, plan_id, kind, from, to, limit",
            export_calendar_ics: "export_calendar_ics — Export deterministic ICS text from local calendar events. Params: calendar_name, project_id, task_id, plan_id, kind, from, to, redact",
            import_calendar_ics: "import_calendar_ics — Import VEVENT entries from ICS text as local calendar items. Params: content",
            create_board: "create_board — Create a local task or plan kanban board with workflow lanes and WIP limits. Params: name, scope, project_id, task_list_id, plan_id, agent_id, lanes, filters",
            list_boards: "list_boards — List local kanban boards. Params: scope, project_id, agent_id, limit",
            get_board_snapshot: "get_board_snapshot — Render a local kanban board snapshot with WIP and blocked/ready badges. Params: board_id, format",
            move_board_card: "move_board_card — Move a task or plan card to a lane or status. Params: board_id, card_id, lane_id, status",
            log_time: "log_time — Log local task time and roll up actual_minutes. Params: task_id, minutes, run_id, focus_session_id, agent_id, started_at, ended_at, notes",
            start_focus_session: "start_focus_session — Start local focus timing for a task, plan, run, or agent. Params: task_id, plan_id, run_id, agent_id, title, started_at, idle_after_minutes",
            pause_focus_session: "pause_focus_session — Pause an active local focus session. Params: session_id, paused_at",
            resume_focus_session: "resume_focus_session — Resume a paused local focus session. Params: session_id, resumed_at",
            stop_focus_session: "stop_focus_session — Stop local focus timing and log task time when linked. Params: session_id, ended_at, notes, status",
            list_focus_sessions: "list_focus_sessions — List local focus sessions. Params: task_id, plan_id, run_id, agent_id, status, include_completed, limit",
            get_idle_focus_prompts: "get_idle_focus_prompts — Show active focus sessions that exceeded idle_after_minutes. Params: agent_id, now",
            get_time_report: "get_time_report — Report local actual time against estimates. Params: project_id, plan_id, agent_id, since, include_open, format",
            set_verification_provider: "set_verification_provider — Create/update a local verification provider. Params: name, kind, command, cwd, capabilities, retry",
            list_verification_providers: "list_verification_providers — List local verification provider adapters",
            get_verification_provider_capabilities: "get_verification_provider_capabilities — Describe provider capabilities. Params: name",
            run_verification_provider: "run_verification_provider — Run provider and optionally record task evidence. Params: name, task_id, log_text, artifact_path, command",
            remove_verification_provider: "remove_verification_provider — Remove a local verification provider. Params: name",
            update_comment: "update_comment — Edit comment. Params: comment_id, body",
            delete_comment: "delete_comment — Delete comment. Params: comment_id",
            lock_task: "lock_task — Acquire exclusive lock. Params: task_id, agent_id, ttl_seconds",
            unlock_task: "unlock_task — Release lock. Params: task_id, agent_id",
            check_task_lock: "check_task_lock — Check lock status. Params: task_id",
            bulk_update_tasks: "bulk_update_tasks — Update multiple tasks. Params: task_ids[], status, priority, assigned_to",
            bulk_create_tasks: "bulk_create_tasks — Create multiple tasks. Params: tasks[]",
            bulk_delete_tasks: "bulk_delete_tasks — Delete multiple tasks. Params: task_ids[], force",
            archive_completed: "archive_completed — Auto-archive old completed tasks. Params: days, project_id",
            get_archived_tasks: "get_archived_tasks — List archived tasks. Params: project_id, limit",
            unarchive_task: "unarchive_task — Restore archived task. Params: task_id",
            auto_assign_task: "auto_assign_task — Auto-assign based on capabilities. Params: task_id",
            get_my_workload: "get_my_workload — Get agent workload stats. Params: agent_id",
            rebalance_workload: "rebalance_workload — Rebalance tasks across agents. Params: project_id, max_per_agent",
            notify_upcoming_deadlines: "notify_upcoming_deadlines — Get tasks nearing deadline. Params: hours, project_id, agent_id",
            check_local_notifications: "check_local_notifications — Check local due, SLA, stale task, run, and reminder alerts. Params: project_id, agent_id, due_within_minutes, stale_minutes, emit_hooks, evaluate_terminal, quiet_hours",
            list_terminal_notification_rules: "list_terminal_notification_rules — List local terminal notification watch rules",
            set_terminal_notification_rule: "set_terminal_notification_rule — Create or update a terminal notification rule. Params: name, events, min_severity, format, bell, filters, quiet_hours",
            remove_terminal_notification_rule: "remove_terminal_notification_rule — Remove a terminal notification rule. Params: name",
            test_terminal_notification_rule: "test_terminal_notification_rule — Evaluate one terminal rule against a sample event. Params: name, event, payload, task_id",
            evaluate_terminal_watch_rules: "evaluate_terminal_watch_rules — Evaluate all terminal notification rules against a sample event. Params: event, payload",
            list_local_event_hooks: "list_local_event_hooks — List local event hooks",
            set_local_event_hook: "set_local_event_hook — Create or update a local event hook. Params: name, events, target, file_path, socket_path, command, retry",
            remove_local_event_hook: "remove_local_event_hook — Remove a local event hook. Params: name",
            test_local_event_hook: "test_local_event_hook — Deliver a test local event to one hook. Params: name, event, payload, task_id",
            get_stale_tasks: "get_stale_tasks — Get tasks not updated recently. Params: hours, minutes, project_id",
            get_blocked_tasks: "get_blocked_tasks — Get blocked tasks. Params: project_id",
            get_blocking_tasks: "get_blocking_tasks — Get tasks blocking others. Params: project_id",
            get_health: "get_health — Get system health stats",
            run_doctor: "run_doctor — Diagnose local schema, migration, integrity, metadata, permission, and project-root issues. Params: apply",
            approve_task: "approve_task — Approve a task. Params: task_id, approved_by, notes, version",
            fail_task: "fail_task — Mark task failed. Params: task_id, reason, agent_id, version",
            register_agent: "register_agent — Register an agent. Params: name, description, role, title, capabilities, session_id, working_dir, force",
            list_agents: "list_agents — List registered agents. Params: include_archived",
            get_agent: "get_agent — Get agent details. Params: agent_id, id, name",
            update_agent: "update_agent — Update an agent. Params: agent_id, id, name, description, role, title, level, capabilities, permissions, metadata",
            delete_agent: "delete_agent — Archive an agent. Params: agent_id, id, name",
            unarchive_agent: "unarchive_agent — Restore an archived agent. Params: agent_id, id, name",
            heartbeat: "heartbeat — Update an agent heartbeat. Params: agent_id",
            release_agent: "release_agent — Release an agent session/name. Params: agent_id, session_id",
            set_focus: "set_focus — Focus an agent on a project. Params: agent_id, project_id, task_list_id",
            get_focus: "get_focus — Get current agent focus. Params: agent_id",
            unfocus: "unfocus — Clear agent focus. Params: agent_id",
            suggest_agent_name: "suggest_agent_name — Suggest available agent names. Params: working_dir",
            get_org_chart: "get_org_chart — Get global org chart. Params: format",
            set_reports_to: "set_reports_to — Set org hierarchy. Params: agent_id, reports_to",
            extract_todos: "extract_todos — Scan code for TODO comments. Params: path, project_id, task_list_id, patterns, tags, assigned_to, agent_id, dry_run, extensions, exclude, respect_gitignore, include_index",
            watch_source_todos: "watch_source_todos — Run finite local source TODO watcher scans. Params: path, project_id, task_list_id, patterns, tags, assigned_to, agent_id, dry_run, extensions, exclude, respect_gitignore, interval_ms, max_runs",
          };

          if (toolDocs[tool_name]) {
            return { content: [{ type: "text" as const, text: toolDocs[tool_name] }] };
          }
          return { content: [{ type: "text" as const, text: `No documentation found for tool: ${tool_name}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
