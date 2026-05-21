import { getPackageVersion } from "./lib/package-version.js";

export type TodosJsonSurface = "cli" | "api" | "mcp" | "sdk";
export type TodosJsonStability = "stable" | "experimental";
export type TodosJsonFieldType = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

export interface CreateJsonContractsManifestOptions {
  version?: string;
  generatedAt?: string;
}

export interface TodosJsonContractPackageSource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosJsonFieldContract {
  type: TodosJsonFieldType | readonly TodosJsonFieldType[];
  description: string;
  nullable?: boolean;
}

export interface TodosJsonObjectContract {
  id: string;
  name: string;
  description: string;
  surfaces: TodosJsonSurface[];
  stability: TodosJsonStability;
  required: Record<string, TodosJsonFieldContract>;
  optional: Record<string, TodosJsonFieldContract>;
  additionalProperties: true;
  evolution: {
    additionalFields: "allowed";
    removingRequiredFields: "breaking";
    changingRequiredFieldTypes: "breaking";
    nullableToNonNullable: "breaking";
  };
}

export interface TodosJsonContractsManifest {
  schemaVersion: 1;
  generatedAt: string;
  package: TodosJsonContractPackageSource;
  contracts: TodosJsonObjectContract[];
}

export interface JsonContractValidationIssue {
  field: string;
  expected: readonly TodosJsonFieldType[];
  actual: string;
}

export interface JsonContractValidationResult {
  ok: boolean;
  contractId: string;
  missingRequired: string[];
  typeMismatches: JsonContractValidationIssue[];
}

function source(version: string): TodosJsonContractPackageSource {
  return {
    packageName: "@hasna/todos",
    repository: "hasna/todos",
    version,
  };
}

function field(
  type: TodosJsonFieldContract["type"],
  description: string,
  nullable = false,
): TodosJsonFieldContract {
  return { type, description, nullable };
}

function contract(input: Omit<TodosJsonObjectContract, "additionalProperties" | "evolution">): TodosJsonObjectContract {
  return {
    ...input,
    additionalProperties: true,
    evolution: {
      additionalFields: "allowed",
      removingRequiredFields: "breaking",
      changingRequiredFieldTypes: "breaking",
      nullableToNonNullable: "breaking",
    },
  };
}

const idField = field("string", "Stable UUID or short identifier.");
const nullableIdField = field(["string", "null"], "Stable identifier when attached to another object.", true);
const isoDateField = field("string", "ISO-8601 timestamp string.");
const nullableIsoDateField = field(["string", "null"], "ISO-8601 timestamp string, or null when not set.", true);
const metadataField = field("object", "JSON object metadata. Unknown keys are extension data.");
const tagsField = field("array", "Array of string tags.");

export const TODOS_JSON_CONTRACTS: TodosJsonObjectContract[] = [
  contract({
    id: "task",
    name: "Task",
    description: "Canonical task object returned by CLI JSON, SDK, API summaries, and MCP task tools.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      short_id: nullableIdField,
      title: field("string", "Human-readable task title."),
      description: field(["string", "null"], "Optional task description.", true),
      status: field("string", "Task lifecycle status."),
      priority: field("string", "Task priority."),
      project_id: nullableIdField,
      plan_id: nullableIdField,
      task_list_id: nullableIdField,
      agent_id: nullableIdField,
      assigned_to: field(["string", "null"], "Assigned agent name or id.", true),
      tags: tagsField,
      metadata: metadataField,
      version: field("integer", "Optimistic locking version."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {
      locked_by: field(["string", "null"], "Agent currently holding the task lock.", true),
      locked_at: nullableIsoDateField,
      started_at: nullableIsoDateField,
      completed_at: nullableIsoDateField,
      due_at: nullableIsoDateField,
      recurrence_rule: field(["string", "null"], "Local recurrence rule such as every day or every week.", true),
      recurrence_parent_id: nullableIdField,
      sla_minutes: field(["integer", "null"], "Local SLA threshold in minutes before escalation.", true),
    },
  }),
  contract({
    id: "project",
    name: "Project",
    description: "Project object used to scope tasks to a local repository or workspace.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Project display name."),
      path: field("string", "Canonical project path."),
      description: field(["string", "null"], "Optional project description.", true),
      task_list_id: nullableIdField,
      task_prefix: field(["string", "null"], "Optional task prefix.", true),
      task_counter: field("integer", "Monotonic project task counter."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {
      sources: field("array", "Optional project source records."),
    },
  }),
  contract({
    id: "local_task_fields",
    name: "Local Task Fields",
    description: "Local task metadata for labels, priority, severity, owner, area, and extension-defined custom fields.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      labels: field("array", "Sorted local labels attached to the task."),
      priority: field("string", "Canonical task priority mirrored from the task row."),
      severity: field(["string", "null"], "Local severity label, or null when unset.", true),
      owner: field(["string", "null"], "Local owner or responsible agent, or null when unset.", true),
      area: field(["string", "null"], "Local area or component, or null when unset.", true),
      custom: metadataField,
    },
    optional: {},
  }),
  contract({
    id: "duplicate_task_candidate",
    name: "Duplicate Task Candidate",
    description: "Likely duplicate task pair returned by local duplicate scans.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      primary_task: field("object", "Task selected as the primary record."),
      duplicate_task: field("object", "Task suggested as the duplicate record."),
      score: field("number", "Duplicate confidence score from 0 to 1."),
      reasons: field("array", "Human-readable reasons supporting the duplicate candidate."),
    },
    optional: {},
  }),
  contract({
    id: "task_merge_result",
    name: "Task Merge Result",
    description: "Result returned after merging a duplicate task into a primary task.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      primary_task: field("object", "Updated primary task."),
      archived_duplicate: field("object", "Duplicate task after cancellation and archive metadata are applied."),
      relationship_id: idField,
      moved: field("object", "Counts of local evidence and graph records moved to the primary task."),
    },
    optional: {},
  }),
  contract({
    id: "verification_provider",
    name: "Verification Provider",
    description: "Local verification provider adapter config for commands, testbox-style runners, CI logs, browser artifacts, and scripts.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      name: field("string", "Provider name."),
      kind: field("string", "Provider kind: command, testbox, ci_log, browser, or script."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {
      command: field("string", "Local command template when the provider executes a command."),
      cwd: field("string", "Working directory for command providers."),
      env: metadataField,
      capabilities: field("array", "Capability labels exposed by this provider."),
      retry: field("object", "Retry attempts and backoff configuration."),
      timeout_ms: field("integer", "Optional timeout hint in milliseconds."),
    },
  }),
  contract({
    id: "verification_provider_result",
    name: "Verification Provider Result",
    description: "Deterministic local result returned after running a verification provider.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      provider: field("string", "Provider name."),
      kind: field("string", "Provider kind."),
      status: field("string", "Result status: passed, failed, or unknown."),
      command: field("string", "Stable provider evidence command label."),
      attempts: field("integer", "Number of attempts made."),
      exit_code: field(["integer", "null"], "Process exit code for command providers, or null.", true),
      output_summary: field(["string", "null"], "Redacted output summary.", true),
      artifact_path: field(["string", "null"], "Local artifact path, or null.", true),
      run_at: isoDateField,
      task_id: nullableIdField,
      metadata: metadataField,
    },
    optional: {},
  }),
  contract({
    id: "local_extension_compatibility",
    name: "Local Extension Compatibility",
    description: "Local extension schema, permission, CLI/MCP compatibility, and sandbox dry-run diagnostics.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      source: field(["string", "null"], "Inspected extension source path, or null for in-memory manifests.", true),
      manifest: field("object", "Normalized extension manifest."),
      validation: field("object", "Schema, compatibility, permission, and sandbox validation details."),
      ok: field("boolean", "Whether the extension passed hard compatibility checks."),
      summary: field("object", "Counts for commands, MCP tools, hooks, permissions, sandbox checks, and failed dry-runs."),
      errors: field("array", "Hard validation or compatibility errors."),
      warnings: field("array", "Non-blocking diagnostics such as sandbox approval requirements."),
    },
    optional: {},
  }),
  contract({
    id: "agent",
    name: "Agent",
    description: "Registered agent identity and coordination metadata.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Normalized agent name."),
      description: field(["string", "null"], "Optional agent description.", true),
      role: field(["string", "null"], "Agent role.", true),
      permissions: field("array", "Permission labels."),
      capabilities: field("array", "Capability labels."),
      status: field("string", "Agent lifecycle status."),
      created_at: isoDateField,
      last_seen_at: isoDateField,
    },
    optional: {
      session_id: nullableIdField,
      working_dir: field(["string", "null"], "Current working directory.", true),
      active_project_id: nullableIdField,
    },
  }),
  contract({
    id: "handoff",
    name: "Agent Handoff",
    description: "Local session handoff with continuation context, referenced tasks, files, runs, and per-agent acknowledgement state.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      agent_id: nullableIdField,
      project_id: nullableIdField,
      session_id: nullableIdField,
      summary: field("string", "Redacted handoff summary."),
      completed: field(["array", "null"], "Completed items.", true),
      in_progress: field(["array", "null"], "In-progress items.", true),
      blockers: field(["array", "null"], "Known blockers.", true),
      next_steps: field(["array", "null"], "Recommended next actions.", true),
      task_ids: field(["array", "null"], "Referenced task IDs.", true),
      relevant_files: field(["array", "null"], "Relevant local file paths.", true),
      run_ids: field(["array", "null"], "Referenced local task run IDs.", true),
      acknowledged_by: field("array", "Agents that acknowledged the handoff."),
      created_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "template",
    name: "Task Template",
    description: "Task template object used to create repeatable task plans.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Template name."),
      title_pattern: field("string", "Task title pattern."),
      description: field(["string", "null"], "Optional template description.", true),
      priority: field("string", "Default task priority."),
      tags: tagsField,
      variables: field("array", "Template variable definitions."),
      version: field("integer", "Template version."),
      project_id: nullableIdField,
      plan_id: nullableIdField,
      metadata: metadataField,
      created_at: isoDateField,
    },
    optional: {
      tasks: field("array", "Expanded template task steps."),
    },
  }),
  contract({
    id: "task_list",
    name: "Task List",
    description: "Named task list, optionally scoped to a project.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      project_id: nullableIdField,
      slug: field("string", "Stable URL/CLI-safe list slug."),
      name: field("string", "Task list display name."),
      description: field(["string", "null"], "Optional list description.", true),
      metadata: metadataField,
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "comment",
    name: "Task Comment",
    description: "Comment, progress update, or note attached to a task.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      task_id: idField,
      agent_id: nullableIdField,
      session_id: nullableIdField,
      content: field("string", "Comment body."),
      type: field("string", "Comment type: comment, progress, or note."),
      progress_pct: field(["integer", "number", "null"], "Progress percentage for progress entries.", true),
      created_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "checkpoint",
    name: "Task Run Checkpoint",
    description: "Task runner checkpoint for a named execution step.",
    surfaces: ["api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      task_id: idField,
      agent_id: nullableIdField,
      step: field("string", "Runner step name."),
      status: field("string", "Checkpoint execution status."),
      data: metadataField,
      error: field(["string", "null"], "Step error message when failed.", true),
      attempt: field("integer", "Current attempt number."),
      max_attempts: field("integer", "Maximum allowed attempts."),
      started_at: nullableIsoDateField,
      completed_at: nullableIsoDateField,
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "dispatch",
    name: "Dispatch",
    description: "Queued or completed tmux dispatch/run request.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      title: field(["string", "null"], "Optional dispatch title.", true),
      target_window: field("string", "tmux target window."),
      task_ids: field("array", "Task IDs included in the dispatch."),
      task_list_id: nullableIdField,
      message: field(["string", "null"], "Preformatted message, or null when generated from tasks.", true),
      delay_ms: field(["integer", "null"], "Delay between send and Enter.", true),
      scheduled_at: nullableIsoDateField,
      status: field("string", "Dispatch status."),
      error: field(["string", "null"], "Dispatch error when failed.", true),
      created_at: isoDateField,
      sent_at: nullableIsoDateField,
    },
    optional: {},
  }),
  contract({
    id: "audit_history",
    name: "Audit History",
    description: "Audit log entry for a task mutation.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      task_id: idField,
      action: field("string", "Mutation action name."),
      field: field(["string", "null"], "Changed field name.", true),
      old_value: field(["string", "null"], "Previous value serialized as a string.", true),
      new_value: field(["string", "null"], "New value serialized as a string.", true),
      agent_id: nullableIdField,
      created_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "local_activity_timeline_entry",
    name: "Local Activity Timeline Entry",
    description: "Redacted local timeline entry derived from comments, task audit history, and run evidence.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      source: field("string", "Timeline source table or evidence family."),
      event_type: field("string", "Source-specific event type."),
      entity_type: field("string", "Primary entity type for the entry: task or run."),
      entity_id: idField,
      task_id: idField,
      project_id: nullableIdField,
      plan_id: nullableIdField,
      run_id: nullableIdField,
      agent_id: nullableIdField,
      created_at: isoDateField,
      title: field("string", "Short redacted title for the event."),
      message: field(["string", "null"], "Redacted event body or summary.", true),
      metadata: metadataField,
    },
    optional: {},
  }),
  contract({
    id: "status_summary",
    name: "Status Summary",
    description: "Queue status counts and lightweight next/active work summary.",
    surfaces: ["cli", "api", "mcp", "sdk"],
    stability: "stable",
    required: {
      pending: field("integer", "Pending task count."),
      in_progress: field("integer", "In-progress task count."),
      completed: field("integer", "Completed task count."),
      total: field("integer", "Total task count for the selected scope."),
      active_work: field("array", "Lightweight active work items."),
      next_task: field(["object", "null"], "Next available task, or null when none is available.", true),
      stale_count: field("integer", "Count of stale in-progress tasks."),
      overdue_recurring: field("integer", "Count of overdue recurring tasks."),
    },
    optional: {
      blocked_tasks: field("array", "Optional blocked task explanation list."),
    },
  }),
  contract({
    id: "context_pack",
    name: "Agent Context Pack",
    description: "Deterministic local task context bundle for agent run-start prompts.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schema_version: field("integer", "Context pack schema version."),
      profile: field("string", "Target agent profile."),
      as_of: isoDateField,
      agent_id: field(["string", "null"], "Agent receiving the context pack.", true),
      task: field("object", "Selected task state."),
      project: field(["object", "null"], "Selected project state.", true),
      plan: field(["object", "null"], "Selected plan state.", true),
      acceptance_criteria: field("array", "Acceptance criteria extracted from task metadata."),
      dependencies: field("object", "Upstream and downstream dependency summaries."),
      comments: field("object", "Recent redacted task comments."),
      relevant_files: field("array", "Relevant files from task, commit, and run evidence."),
      traceability: field("object", "Local commits, refs, and verification evidence."),
      runs: field("object", "Selected local run ledger summaries."),
      prompt_bundle: field("object", "Profile-specific prompt instructions."),
      limits: field("object", "Limits used to build the pack."),
      warnings: field("array", "Omission, staleness, and data-quality warnings."),
    },
    optional: {
      context_budget: field("object", "Local token estimate, budget pruning metadata, and deterministic summaries for omitted context."),
    },
  }),
  contract({
    id: "release_notes",
    name: "Release Notes",
    description: "Deterministic local changelog document generated from completed tasks, plans, commits, and verification evidence.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schema_version: field("integer", "Release notes schema version."),
      generated_at: isoDateField,
      title: field("string", "Release notes title."),
      version: field(["string", "null"], "Optional release version label.", true),
      local_only: field("boolean", "Always true; generation uses only local state."),
      scope: field("object", "Project, plan, task, tag, and date filters used to build the document."),
      summary: field("object", "Counts for tasks, plans, commits, verifications, breaking changes, and migration notes."),
      plans: field("array", "Plan summaries represented in the release."),
      tasks: field("array", "Completed tasks with local traceability evidence."),
      commits: field("array", "Flattened linked commits across release tasks."),
      verifications: field("array", "Flattened verification records across release tasks."),
      breaking_changes: field("array", "Task-linked breaking change notes from local metadata."),
      migration_notes: field("array", "Task-linked migration notes from local metadata."),
      warnings: field("array", "Scope or data-quality warnings."),
    },
    optional: {},
  }),
  contract({
    id: "source_todo_comment",
    name: "Source TODO Comment",
    description: "Local source comment found by TODO/FIXME/HACK/BUG/XXX/NOTE extraction and watcher scans.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      tag: field("string", "Comment tag such as TODO, FIXME, HACK, XXX, BUG, or NOTE."),
      message: field("string", "Extracted comment text."),
      file: field("string", "Repository-relative source path."),
      line: field("integer", "One-based source line number."),
      raw: field("string", "Original source line."),
      fingerprint: field("string", "Stable local fingerprint used for deduplication."),
    },
    optional: {
      symbol: field("string", "Nearest locally recognized source symbol."),
      symbol_kind: field("string", "Recognized symbol kind such as function, class, or variable."),
    },
  }),
  contract({
    id: "source_code_index",
    name: "Source Code Index",
    description: "Local codebase index generated during source TODO extraction and watcher scans.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      root: field("string", "Absolute scanned root path."),
      generated_at: isoDateField,
      files: field("array", "Indexed source files with checksums, symbols, and comments."),
      total_comments: field("integer", "Total extracted source comments."),
      total_symbols: field("integer", "Total locally recognized source symbols."),
      respects_gitignore: field("boolean", "Whether .gitignore patterns were applied."),
      excludes: field("array", "Additional exclude patterns used during indexing."),
    },
    optional: {},
  }),
  contract({
    id: "calendar_event",
    name: "Calendar Event",
    description: "Local calendar event derived from task due dates, SLA thresholds, runs, or local calendar items.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      kind: field("string", "Event kind such as task_due, task_sla, milestone, work_block, run, or imported."),
      title: field("string", "Calendar event summary."),
      description: field(["string", "null"], "Optional event description.", true),
      starts_at: isoDateField,
      ends_at: nullableIsoDateField,
      timezone: field(["string", "null"], "Timezone label when explicitly set.", true),
      project_id: nullableIdField,
      task_id: nullableIdField,
      plan_id: nullableIdField,
      run_id: nullableIdField,
      recurrence_rule: field(["string", "null"], "Local recurrence rule or ICS RRULE.", true),
      source: field("string", "Source table family: task, run, or local."),
      badges: field("array", "Local event badges such as priority, status, SLA, or run state."),
      metadata: metadataField,
    },
    optional: {},
  }),
  contract({
    id: "ics_export_result",
    name: "ICS Export Result",
    description: "Deterministic local ICS export envelope returned by CLI and MCP calendar export tools.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      filename: field("string", "Suggested ICS filename."),
      content: field("string", "Full text/calendar ICS content."),
      events: field("array", "Calendar events included in the export."),
    },
    optional: {},
  }),
  contract({
    id: "task_board",
    name: "Task Board",
    description: "Local kanban board definition for task or plan workflow states.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Board display name."),
      scope: field("string", "Board scope: tasks or plans."),
      project_id: nullableIdField,
      task_list_id: nullableIdField,
      plan_id: nullableIdField,
      agent_id: field(["string", "null"], "Optional agent filter.", true),
      lanes: field("array", "Ordered lane definitions with workflow statuses and WIP limits."),
      filters: metadataField,
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "board_snapshot",
    name: "Board Snapshot",
    description: "Rendered local kanban board state with cards, WIP limit state, and blocked/ready badges.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      board: field("object", "Task board definition used to build the snapshot."),
      generated_at: isoDateField,
      lanes: field("array", "Rendered lane snapshots and cards."),
      totals: field("object", "Card, blocked, ready, and WIP exceeded counts."),
      keyboard: field("object", "Terminal/TUI key bindings for agent-native board navigation."),
    },
    optional: {},
  }),
  contract({
    id: "focus_session",
    name: "Focus Session",
    description: "Local timer session for task, plan, run, or agent focus work.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      task_id: nullableIdField,
      plan_id: nullableIdField,
      run_id: nullableIdField,
      agent_id: field(["string", "null"], "Agent running the session.", true),
      title: field(["string", "null"], "Optional focus session title.", true),
      status: field("string", "active, paused, completed, or cancelled."),
      started_at: isoDateField,
      last_resumed_at: nullableIsoDateField,
      paused_at: nullableIsoDateField,
      ended_at: nullableIsoDateField,
      actual_minutes: field("integer", "Actual focused minutes accumulated locally."),
      idle_after_minutes: field(["integer", "null"], "Idle prompt threshold in minutes.", true),
      notes: field(["string", "null"], "Optional notes.", true),
      metadata: metadataField,
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "time_report_entry",
    name: "Time Report Entry",
    description: "Local actual-vs-estimate report row for task time logs and focus sessions.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      task_id: idField,
      title: field("string", "Task title."),
      project_id: nullableIdField,
      plan_id: nullableIdField,
      estimated_minutes: field(["integer", "null"], "Estimated minutes, if set.", true),
      actual_minutes: field(["integer", "null"], "Rolled-up actual minutes, if set.", true),
      logged_minutes: field("integer", "Total minutes in task_time_logs."),
      focus_minutes: field("integer", "Total minutes in focus sessions."),
      time_logs: field("array", "Task time log records."),
      focus_sessions: field("array", "Linked focus sessions."),
    },
    optional: {},
  }),
  contract({
    id: "environment_snapshot",
    name: "Environment Snapshot",
    description: "Local reproducibility snapshot for task and run verification context.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schema_version: field("integer", "Snapshot schema version."),
      id: field("string", "Content-derived snapshot identifier."),
      captured_at: isoDateField,
      root: field("string", "Canonical local project root inspected."),
      machine: field("object", "Local hostname, platform, and architecture metadata."),
      target: field("object", "Optional task, run, and agent attachment IDs."),
      runtime: field("object", "Bun, Node, and executable metadata."),
      package_manager: field("object", "Detected package manager, lockfile hashes, and redacted manifests."),
      git: field("object", "Local git branch, commit, dirty state, and porcelain status."),
      config_hashes: field("array", "SHA-256 hashes of relevant local config files."),
      command_env: field("object", "Redacted command and environment metadata."),
      warnings: field("array", "Warnings about missing or unavailable local data."),
    },
    optional: {},
  }),
  contract({
    id: "environment_snapshot_comparison",
    name: "Environment Snapshot Comparison",
    description: "Drift summary returned when comparing two local environment snapshots.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schema_version: field("integer", "Comparison schema version."),
      left_id: field("string", "Left snapshot ID."),
      right_id: field("string", "Right snapshot ID."),
      same_root: field("boolean", "Whether both snapshots were captured for the same root."),
      same_machine: field("boolean", "Whether hostname, platform, and architecture match."),
      same_runtime: field("boolean", "Whether Bun and Node versions match."),
      same_git_commit: field("boolean", "Whether git commit IDs match."),
      dirty_state_changed: field("boolean", "Whether the git dirty flag changed."),
      changed_config_hashes: field("array", "Changed config hash records."),
      changed_lockfiles: field("array", "Changed lockfile hash records."),
      changed_manifests: field("array", "Changed manifest hash records."),
      warnings: field("array", "Comparison warnings."),
    },
    optional: {},
  }),
  contract({
    id: "local_event_hook",
    name: "Local Event Hook",
    description: "Config-backed local-only event hook used by CLI and MCP automation triggers.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      name: field("string", "Stable hook name."),
      enabled: field("boolean", "Whether the hook is active."),
      events: field("array", "Event names this hook subscribes to, or * for all events."),
      target: field("string", "Local delivery target: stdout, file, socket, or script."),
    },
    optional: {
      file_path: field("string", "JSONL output path for file targets."),
      socket_path: field("string", "Unix domain socket path for socket targets."),
      command: field("string", "Local command for script targets."),
      cwd: field("string", "Working directory for script targets."),
      sandbox: field("string", "Runner sandbox profile used before script execution."),
      env: field("object", "Script environment additions."),
      retry: field("object", "Delivery retry and backoff settings."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
  }),
  contract({
    id: "local_event_hook_delivery",
    name: "Local Event Hook Delivery",
    description: "Delivery result for a local-only event hook test or dispatch.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      hook: field("string", "Hook name."),
      event_id: field("string", "Generated event envelope ID."),
      event_type: field("string", "Delivered event type."),
      target: field("string", "Delivery target."),
      status: field("string", "Delivery status: delivered, failed, or skipped."),
      attempts: field("integer", "Number of attempts used."),
      integrity: field("object", "SHA-256 integrity metadata for the redacted event envelope."),
    },
    optional: {
      output_summary: field("string", "Redacted output summary for stdout or script targets."),
      error: field("string", "Redacted delivery failure message."),
    },
  }),
  contract({
    id: "terminal_notification_rule",
    name: "Terminal Notification Rule",
    description: "Config-backed local-only terminal watch rule for task, run, plan, approval, import, or export events.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      name: field("string", "Stable rule name."),
      enabled: field("boolean", "Whether the rule is active."),
      events: field("array", "Event names this rule watches, or * for all events."),
      min_severity: field("string", "Minimum event severity: info, warning, or critical."),
      format: field("string", "Terminal rendering format: line or json."),
      bell: field("boolean", "Whether critical matches ring the terminal bell."),
    },
    optional: {
      task_statuses: field("array", "Task status filters."),
      priorities: field("array", "Task priority filters."),
      agent_ids: field("array", "Agent filters."),
      project_ids: field("array", "Project filters."),
      contains: field("array", "Payload text fragments that must match."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
  }),
  contract({
    id: "terminal_notification_evaluation",
    name: "Terminal Notification Evaluation",
    description: "Local watch-rule evaluation result and rendered notification payloads.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      rule: field("string", "Rule name."),
      matched: field("boolean", "Whether the input event matched the rule."),
      skipped_reasons: field("array", "Reasons a rule did not match."),
      notifications: field("array", "Terminal notifications generated by the rule."),
    },
    optional: {},
  }),
  contract({
    id: "branch_work_plan",
    name: "Branch Work Plan",
    description: "Local branch-safe work plan for task or plan execution with file conflicts and git status.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schema_version: field("integer", "Schema version."),
      local_only: field("boolean", "Always true for local branch plans."),
      generated_at: isoDateField,
      branch: field("string", "Branch name to create locally."),
      base_branch: field("string", "Base branch to start from."),
      root: field("string", "Local git root inspected for status."),
      task_id: field(["string", "null"], "Task scope, or null when plan scoped."),
      plan_id: field(["string", "null"], "Plan scope, or null when task scoped."),
      task_ids: field("array", "Tasks covered by the branch plan."),
      files: field("array", "Planned files for the branch."),
      conflicts: field("array", "Local task/file conflicts."),
      git_status: field("object", "Local git status summary."),
      safe_to_start: field("boolean", "Whether no hard local blockers were found."),
      reasons: field("array", "Reasons the branch is not safe yet."),
      commands: field("array", "Suggested local commands to start and link branch work."),
    },
    optional: {},
  }),
  contract({
    id: "natural_language_intake_preview",
    name: "Natural Language Intake Preview",
    description: "Deterministic local parse result for natural-language task intake with dry-run/apply metadata.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schema_version: field("integer", "Schema version."),
      local_only: field("boolean", "Always true for local parser output."),
      dry_run: field("boolean", "Whether parsed tasks were previewed without writes."),
      source_text: field("string", "Redacted source text parsed locally."),
      project_id: field(["string", "null"], "Project ID used for applied tasks, if any."),
      task_list_id: field(["string", "null"], "Task list ID used for applied tasks, if any."),
      detected_project_name: field(["string", "null"], "Project name detected in text but not resolved automatically."),
      detected_plan_name: field(["string", "null"], "Plan name detected in text."),
      project: field(["object", "null"], "Proposed local project to create when apply is true."),
      plan: field(["object", "null"], "Proposed local plan to create when apply is true."),
      tasks: field("array", "Task previews parsed from source text."),
      dependencies: field("array", "Proposed task dependency edges parsed from source text."),
      acceptance_criteria: field("array", "Global acceptance criteria parsed from source text."),
      created_project: field(["object", "null"], "Project created when apply is true and a project name was detected."),
      created_plan: field(["object", "null"], "Plan created when apply is true and a plan name was detected."),
      created_tasks: field("array", "Tasks created when apply is true."),
      warnings: field("array", "Parser warnings."),
      commands: field("array", "Equivalent local CLI commands for parsed tasks."),
    },
    optional: {},
  }),
  contract({
    id: "local_encryption_profile",
    name: "Local Encryption Profile",
    description: "Config-backed local encryption profile. Stores algorithm metadata and key environment variable name, never key material.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      name: field("string", "Stable profile name."),
      algorithm: field("string", "Encryption algorithm. Currently aes-256-gcm."),
      kdf: field("string", "Key derivation function. Currently scrypt."),
      key_env: field("string", "Environment variable that supplies key material."),
      salt: field("string", "Nonsecret base64 KDF salt."),
    },
    optional: {
      description: field("string", "Optional profile description."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
  }),
  contract({
    id: "local_encryption_envelope",
    name: "Local Encryption Envelope",
    description: "Encrypted local value envelope for sensitive metadata, evidence snippets, and MCP/CLI field operations.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Encryption envelope schema version."),
      kind: field("string", "Envelope kind identifier."),
      encryptedAt: isoDateField,
      profile: field("string", "Profile used to encrypt the value."),
      key_env: field("string", "Environment variable required to decrypt."),
      algorithm: field("string", "Encryption algorithm."),
      kdf: field("string", "Key derivation function."),
      salt: field("string", "Nonsecret KDF salt."),
      iv: field("string", "Base64 initialization vector."),
      auth_tag: field("string", "Base64 GCM authentication tag."),
      ciphertext: field("string", "Base64 ciphertext."),
      plaintext_sha256: field("string", "Plaintext checksum verified after decryption."),
    },
    optional: {},
  }),
  contract({
    id: "encrypted_local_bridge_bundle",
    name: "Encrypted Local Bridge Bundle",
    description: "Encrypted bridge export wrapper for moving local tasks, runs, evidence, artifacts, and metadata without plaintext JSON exposure.",
    surfaces: ["cli", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Encryption wrapper schema version."),
      kind: field("string", "Encrypted bridge bundle kind identifier."),
      encryptedAt: isoDateField,
      package: field("object", "Package source metadata."),
      plaintext: field("object", "Plaintext bundle kind, schema version, and checksum."),
      encryption: field("object", "Encryption envelope metadata and ciphertext."),
      warnings: field("array", "Operator warnings for key handling and decrypt/import."),
    },
    optional: {},
  }),
  contract({
    id: "structured_error",
    name: "Structured Error",
    description: "Structured MCP/SDK-style error response with a stable machine code.",
    surfaces: ["mcp", "sdk"],
    stability: "stable",
    required: {
      code: field("string", "Stable machine-readable error code."),
      message: field("string", "Human-readable error message."),
    },
    optional: {
      suggestion: field("string", "Optional recovery suggestion."),
      retryAfterSeconds: field("integer", "Optional retry delay for cooldown errors."),
    },
  }),
  contract({
    id: "api_error",
    name: "API Error",
    description: "HTTP API and CLI JSON error object for simple error responses.",
    surfaces: ["cli", "api"],
    stability: "stable",
    required: {
      error: field("string", "Human-readable error message."),
    },
    optional: {
      code: field("string", "Optional machine-readable error code."),
      conflict: field("boolean", "Optional conflict flag for registration errors."),
      suggestions: field("array", "Optional recovery suggestions."),
      retry_after: field("integer", "Optional retry delay for rate-limited responses."),
    },
  }),
  contract({
    id: "local_bridge_bundle",
    name: "Local Bridge Bundle",
    description: "Versioned local import/export bundle for moving tasks, projects, plans, runs, and evidence metadata between local stores.",
    surfaces: ["cli", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Bridge bundle schema version."),
      kind: field("string", "Bundle kind identifier."),
      exportedAt: isoDateField,
      package: field("object", "Package source metadata."),
      source: field("object", "Local source scope for the export."),
      data: field("object", "Exported local records grouped by object type."),
      stats: field("object", "Record counts by object type."),
    },
    optional: {},
  }),
  contract({
    id: "local_bridge_import_result",
    name: "Local Bridge Import Result",
    description: "Dry-run or applied import report with inserted counts, skipped counts, conflicts, and validation issues.",
    surfaces: ["cli", "sdk"],
    stability: "stable",
    required: {
      ok: field("boolean", "Whether the import bundle is valid and has no missing-dependency conflicts."),
      dry_run: field("boolean", "True when no local records were written."),
      inserted: field("object", "Records that would be or were inserted, grouped by object type."),
      skipped: field("object", "Records skipped because they already exist or have missing dependencies."),
      conflicts: field("array", "Conflict records with table, id, and reason."),
      issues: field("array", "Validation issue strings."),
    },
    optional: {
      merged: field("object", "Existing task records safely merged during multi-machine conflict resolution, grouped by object type."),
    },
  }),
  contract({
    id: "cli_mcp_parity_manifest",
    name: "CLI/MCP Parity Manifest",
    description: "Versioned local manifest mapping supported CLI domains to MCP tools, JSON contracts, and documented intentional gaps.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      schemaVersion: field("integer", "Parity manifest schema version."),
      generatedAt: isoDateField,
      package: field("object", "Package source metadata."),
      localOnly: field("boolean", "True when the manifest describes local-only package behavior."),
      noNetworkRequired: field("boolean", "True when manifest generation does not require network access."),
      parity: field("array", "Domain-level CLI/MCP parity entries."),
    },
    optional: {},
  }),
  contract({
    id: "project_bootstrap_result",
    name: "Project Bootstrap Result",
    description: "Local project bootstrap and workspace discovery output for CLI, MCP, and SDK callers.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      dryRun: field("boolean", "True when no local project state was written."),
      discovery: field("object", "Detected local workspace roots, package metadata, and monorepo markers."),
      project: field(["object", "null"], "Registered project, or null during dry-run.", true),
      taskList: field(["object", "null"], "Default task list, or null during dry-run.", true),
      sources: field("array", "Project source records after bootstrap."),
      created: field("object", "Flags and source types created by this bootstrap run."),
    },
    optional: {},
  }),
  contract({
    id: "saved_search_view",
    name: "Saved Search View",
    description: "Local saved search view for repeatable task, project, plan, run, comment, or cross-entity searches.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      id: idField,
      name: field("string", "Human-readable unique view name."),
      description: field(["string", "null"], "Optional view description.", true),
      scope: field("string", "Search scope: all, tasks, projects, plans, runs, or comments."),
      filters: field("object", "Saved local filter object."),
      created_at: isoDateField,
      updated_at: isoDateField,
    },
    optional: {},
  }),
  contract({
    id: "saved_search_run_result",
    name: "Saved Search Run Result",
    description: "Stable JSON envelope returned when running a saved search view or cross-entity search.",
    surfaces: ["cli", "mcp", "sdk"],
    stability: "stable",
    required: {
      scope: field("string", "Search scope used for the run."),
      filters: field("object", "Applied local filters."),
      count: field("integer", "Number of returned result records."),
      results: field("array", "Result records with entity_type and entity."),
    },
    optional: {
      view: field("object", "Saved view metadata when the run came from a named view."),
    },
  }),
];

function expectedTypes(contract: TodosJsonFieldContract): readonly TodosJsonFieldType[] {
  const types = Array.isArray(contract.type) ? [...contract.type] : [contract.type];
  if (contract.nullable && !types.includes("null")) return [...types, "null"];
  return types;
}

function actualType(value: unknown): TodosJsonFieldType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (typeof value === "object") return "object";
  return "string";
}

function matchesType(value: unknown, expected: readonly TodosJsonFieldType[]): boolean {
  const actual = actualType(value);
  if (expected.includes(actual)) return true;
  return actual === "integer" && expected.includes("number");
}

export function getJsonContract(contractId: string): TodosJsonObjectContract | null {
  return TODOS_JSON_CONTRACTS.find((contractItem) => contractItem.id === contractId) ?? null;
}

export function validateJsonContract(contractId: string, value: unknown): JsonContractValidationResult {
  const contractItem = getJsonContract(contractId);
  if (!contractItem) {
    throw new Error(`Unknown JSON contract: ${contractId}`);
  }

  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const missingRequired: string[] = [];
  const typeMismatches: JsonContractValidationIssue[] = [];

  for (const [fieldName, fieldContract] of Object.entries(contractItem.required)) {
    if (!(fieldName in record)) {
      missingRequired.push(fieldName);
      continue;
    }
    const expected = expectedTypes(fieldContract);
    const valueType = actualType(record[fieldName]);
    if (!matchesType(record[fieldName], expected)) {
      typeMismatches.push({ field: fieldName, expected, actual: valueType });
    }
  }

  return {
    ok: missingRequired.length === 0 && typeMismatches.length === 0,
    contractId,
    missingRequired,
    typeMismatches,
  };
}

export function createJsonContractsManifest(
  options: CreateJsonContractsManifestOptions = {},
): TodosJsonContractsManifest {
  const version = options.version ?? getPackageVersion(import.meta.url);
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    package: source(version),
    contracts: TODOS_JSON_CONTRACTS,
  };
}

export const TODOS_JSON_CONTRACTS_MANIFEST = createJsonContractsManifest({
  generatedAt: "1970-01-01T00:00:00.000Z",
});
