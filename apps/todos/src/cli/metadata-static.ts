/** Generated dependency-light CLI metadata. Do not edit by hand. */
import type { CliManual } from "../lib/cli-help.js";

export const TODOS_CLI_MANUAL: CliManual = {
  "title": "todos(1)",
  "synopsis": "todos [global options] <command> [command options]",
  "package_name": "@hasna/todos",
  "local_only": true,
  "install": [
    "bun install -g @hasna/todos"
  ],
  "update": [
    "bun install -g @hasna/todos",
    "todos upgrade"
  ],
  "completion_shells": [
    "bash",
    "zsh",
    "fish"
  ],
  "examples": [
    "todos project-bootstrap . --json",
    "todos add \"Ship CLI help\" --priority high --json",
    "todos ready --json",
    "todos usage report --max-tasks 1000 --max-projects 10 --json",
    "todos runs command <run-id> \"bun test\" --status passed --summary \"1836 pass, 0 fail\"",
    "todos mcp"
  ],
  "json_contracts": [
    "local_task",
    "local_project",
    "task_run",
    "local_usage_ledger",
    "structured_error",
    "api_error"
  ],
  "error_codes": [
    {
      "code": "0",
      "meaning": "Command completed successfully."
    },
    {
      "code": "1",
      "meaning": "Validation, lookup, database, or runtime failure. In JSON mode the CLI prints {\"error\":\"message\"}."
    },
    {
      "code": "structured_error",
      "meaning": "Machine-readable error contract used by local MCP and SDK surfaces."
    },
    {
      "code": "api_error",
      "meaning": "HTTP API error envelope for the optional local server."
    }
  ],
  "commands": [
    {
      "path": [
        "add"
      ],
      "command": "add",
      "description": "Create a new task",
      "aliases": [],
      "usage": "[options] <title>",
      "options": [
        {
          "flags": "-d, --description <text>",
          "description": "Task description",
          "longFlag": "--description",
          "shortFlag": "-d"
        },
        {
          "flags": "-p, --priority <level>",
          "description": "Priority: low, medium, high, critical",
          "longFlag": "--priority",
          "shortFlag": "-p"
        },
        {
          "flags": "--parent <id>",
          "description": "Parent task ID",
          "longFlag": "--parent",
          "shortFlag": null
        },
        {
          "flags": "-t, --tags <tags>",
          "description": "Comma-separated tags",
          "longFlag": "--tags",
          "shortFlag": "-t"
        },
        {
          "flags": "--tag <tags>",
          "description": "Comma-separated tags (alias for --tags)",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Assign to a plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--assign <agent>",
          "description": "Assign to agent",
          "longFlag": "--assign",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Initial status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Task list ID (alias for --list)",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--estimated <minutes>",
          "description": "Estimated time in minutes",
          "longFlag": "--estimated",
          "shortFlag": null
        },
        {
          "flags": "--sla-minutes <minutes>",
          "description": "SLA minutes before unfinished work is escalated",
          "longFlag": "--sla-minutes",
          "shortFlag": null
        },
        {
          "flags": "--sla <minutes>",
          "description": "Alias for --sla-minutes",
          "longFlag": "--sla",
          "shortFlag": null
        },
        {
          "flags": "--approval",
          "description": "Require approval before completion",
          "longFlag": "--approval",
          "shortFlag": null
        },
        {
          "flags": "--recurrence <rule>",
          "description": "Recurrence rule, e.g. 'every day', 'every weekday', 'every 2 weeks'",
          "longFlag": "--recurrence",
          "shortFlag": null
        },
        {
          "flags": "--due <date>",
          "description": "Due date (ISO string or YYYY-MM-DD)",
          "longFlag": "--due",
          "shortFlag": null
        },
        {
          "flags": "--reason <text>",
          "description": "Why this task exists",
          "longFlag": "--reason",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Assign to project by ID or slug (overrides auto-detect)",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "task"
      ],
      "command": "task",
      "description": "Task subcommands for deterministic automation",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "task",
        "upsert"
      ],
      "command": "task upsert",
      "description": "Create or update a task by stable metadata fingerprint",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--fingerprint <key>",
          "description": "Stable dedupe fingerprint",
          "longFlag": "--fingerprint",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Task title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "-d, --description <text>",
          "description": "Task description",
          "longFlag": "--description",
          "shortFlag": "-d"
        },
        {
          "flags": "-p, --priority <level>",
          "description": "Priority: low, medium, high, critical",
          "longFlag": "--priority",
          "shortFlag": "-p"
        },
        {
          "flags": "-s, --status <status>",
          "description": "Task status",
          "longFlag": "--status",
          "shortFlag": "-s"
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Task list ID (alias for --list)",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "-t, --tags <tags>",
          "description": "Comma-separated tags",
          "longFlag": "--tags",
          "shortFlag": "-t"
        },
        {
          "flags": "--tag <tags>",
          "description": "Comma-separated tags (alias for --tags)",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--metadata-json <json>",
          "description": "JSON object merged into task metadata",
          "longFlag": "--metadata-json",
          "shortFlag": null
        },
        {
          "flags": "--working-dir <path>",
          "description": "Working directory to store on create/update",
          "longFlag": "--working-dir",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Assign to project by ID, slug, or path",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--assign <agent>",
          "description": "Assign to agent",
          "longFlag": "--assign",
          "shortFlag": null
        },
        {
          "flags": "--expectation-id <id>",
          "description": "Expectation metadata ID",
          "longFlag": "--expectation-id",
          "shortFlag": null
        },
        {
          "flags": "--expectation-fingerprint <key>",
          "description": "Expectation metadata fingerprint",
          "longFlag": "--expectation-fingerprint",
          "shortFlag": null
        },
        {
          "flags": "--evidence-paths <paths>",
          "description": "Comma-separated evidence paths",
          "longFlag": "--evidence-paths",
          "shortFlag": null
        },
        {
          "flags": "--origin-loop-id <id>",
          "description": "Origin loop ID",
          "longFlag": "--origin-loop-id",
          "shortFlag": null
        },
        {
          "flags": "--origin-run-id <id>",
          "description": "Origin run ID",
          "longFlag": "--origin-run-id",
          "shortFlag": null
        },
        {
          "flags": "--expected <json-or-text>",
          "description": "Expected value metadata",
          "longFlag": "--expected",
          "shortFlag": null
        },
        {
          "flags": "--observed <json-or-text>",
          "description": "Observed value metadata",
          "longFlag": "--observed",
          "shortFlag": null
        },
        {
          "flags": "--acceptance <json-or-text>",
          "description": "Acceptance metadata",
          "longFlag": "--acceptance",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "task",
        "route-state"
      ],
      "command": "task route-state",
      "description": "Show deterministic routing eligibility and workflow pointers for a task",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--verify-project-root",
          "description": "Filesystem-check the resolved project root and surface missing_project_root before admission",
          "longFlag": "--verify-project-root",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "task",
        "workflow-pointers"
      ],
      "command": "task workflow-pointers",
      "description": "Update OpenLoops workflow invocation/run artifact pointers on a task",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--invocation <id>",
          "description": "Current workflow invocation ID",
          "longFlag": "--invocation",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Current workflow run ID",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--manifest <path>",
          "description": "Latest run manifest path",
          "longFlag": "--manifest",
          "shortFlag": null
        },
        {
          "flags": "--evaluation <path>",
          "description": "Latest evaluator artifact path",
          "longFlag": "--evaluation",
          "shortFlag": null
        },
        {
          "flags": "--state <state>",
          "description": "Human-visible workflow state",
          "longFlag": "--state",
          "shortFlag": null
        },
        {
          "flags": "--actor <agent>",
          "description": "Agent or workflow updating the pointers",
          "longFlag": "--actor",
          "shortFlag": null
        },
        {
          "flags": "--clear",
          "description": "Clear all workflow pointers before applying explicit pointer values",
          "longFlag": "--clear",
          "shortFlag": null
        },
        {
          "flags": "--clear-invocation",
          "description": "Clear current workflow invocation ID",
          "longFlag": "--clear-invocation",
          "shortFlag": null
        },
        {
          "flags": "--clear-run",
          "description": "Clear current workflow run ID",
          "longFlag": "--clear-run",
          "shortFlag": null
        },
        {
          "flags": "--clear-manifest",
          "description": "Clear latest run manifest path",
          "longFlag": "--clear-manifest",
          "shortFlag": null
        },
        {
          "flags": "--clear-evaluation",
          "description": "Clear latest evaluator artifact path",
          "longFlag": "--clear-evaluation",
          "shortFlag": null
        },
        {
          "flags": "--clear-state",
          "description": "Clear human-visible workflow state",
          "longFlag": "--clear-state",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "list"
      ],
      "command": "list",
      "description": "List tasks",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-s, --status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": "-s"
        },
        {
          "flags": "-p, --priority <priority>",
          "description": "Filter by priority",
          "longFlag": "--priority",
          "shortFlag": "-p"
        },
        {
          "flags": "--assigned <agent>",
          "description": "Filter by assigned agent",
          "longFlag": "--assigned",
          "shortFlag": null
        },
        {
          "flags": "--tags <tags>",
          "description": "Filter by tags (comma-separated)",
          "longFlag": "--tags",
          "shortFlag": null
        },
        {
          "flags": "--tag <tags>",
          "description": "Filter by tags (alias for --tags)",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "-a, --all",
          "description": "Show all tasks (including completed/cancelled)",
          "longFlag": "--all",
          "shortFlag": "-a"
        },
        {
          "flags": "--list <ref>",
          "description": "Filter by task list UUID, unique UUID prefix, or project-scoped slug",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--task-list <ref>",
          "description": "Filter by task list UUID, unique UUID prefix, or project-scoped slug (alias for --list)",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--project-name <name>",
          "description": "Filter by project name",
          "longFlag": "--project-name",
          "shortFlag": null
        },
        {
          "flags": "--agent-name <name>",
          "description": "Filter by agent name/assigned",
          "longFlag": "--agent-name",
          "shortFlag": null
        },
        {
          "flags": "--sort <field>",
          "description": "Sort by: updated, created, priority, status",
          "longFlag": "--sort",
          "shortFlag": null
        },
        {
          "flags": "--format <fmt>",
          "description": "Output format: table (default), compact, csv, json",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "--due-today",
          "description": "Only tasks due today or earlier",
          "longFlag": "--due-today",
          "shortFlag": null
        },
        {
          "flags": "--overdue",
          "description": "Only overdue tasks (past due_at)",
          "longFlag": "--overdue",
          "shortFlag": null
        },
        {
          "flags": "--recurring",
          "description": "Only recurring tasks",
          "longFlag": "--recurring",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max tasks to return",
          "longFlag": "--limit",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "count"
      ],
      "command": "count",
      "description": "Show task count by status",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "show"
      ],
      "command": "show",
      "description": "Show full task details",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "inspect"
      ],
      "command": "inspect",
      "description": "Full orientation for a task — details, description, dependencies, blocker, files, commits, comments. If no ID given, shows current in-progress task for --agent.",
      "aliases": [],
      "usage": "[options] [id]",
      "options": []
    },
    {
      "path": [
        "history"
      ],
      "command": "history",
      "description": "Show change history for a task (audit log)",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "update"
      ],
      "command": "update",
      "description": "Update a task",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--title <text>",
          "description": "New title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "-d, --description <text>",
          "description": "New description",
          "longFlag": "--description",
          "shortFlag": "-d"
        },
        {
          "flags": "-s, --status <status>",
          "description": "New status",
          "longFlag": "--status",
          "shortFlag": "-s"
        },
        {
          "flags": "-p, --priority <priority>",
          "description": "New priority",
          "longFlag": "--priority",
          "shortFlag": "-p"
        },
        {
          "flags": "--assign <agent>",
          "description": "Assign to agent",
          "longFlag": "--assign",
          "shortFlag": null
        },
        {
          "flags": "--tags <tags>",
          "description": "New tags (comma-separated)",
          "longFlag": "--tags",
          "shortFlag": null
        },
        {
          "flags": "--tag <tags>",
          "description": "New tags (alias for --tags)",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Move to a task list (UUID authoritative; project-scoped slug accepted)",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Move to a task list (alias for --list)",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--clear-list",
          "description": "Detach from its task list (reset task_list_id to null)",
          "longFlag": "--clear-list",
          "shortFlag": null
        },
        {
          "flags": "--working-dir <path>",
          "description": "Repair the task's working_dir to a specific path (routing metadata)",
          "longFlag": "--working-dir",
          "shortFlag": null
        },
        {
          "flags": "--clear-working-dir",
          "description": "Reset the task's working_dir to null (undo path for routing repairs)",
          "longFlag": "--clear-working-dir",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Move to a plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--clear-plan",
          "description": "Remove from its current plan",
          "longFlag": "--clear-plan",
          "shortFlag": null
        },
        {
          "flags": "--estimated <minutes>",
          "description": "Estimated time in minutes",
          "longFlag": "--estimated",
          "shortFlag": null
        },
        {
          "flags": "--sla-minutes <minutes>",
          "description": "SLA minutes before unfinished work is escalated",
          "longFlag": "--sla-minutes",
          "shortFlag": null
        },
        {
          "flags": "--sla <minutes>",
          "description": "Alias for --sla-minutes",
          "longFlag": "--sla",
          "shortFlag": null
        },
        {
          "flags": "--due <date>",
          "description": "Due date (ISO string or YYYY-MM-DD), empty to clear",
          "longFlag": "--due",
          "shortFlag": null
        },
        {
          "flags": "--recurrence <rule>",
          "description": "Recurrence rule, empty to clear",
          "longFlag": "--recurrence",
          "shortFlag": null
        },
        {
          "flags": "--approval",
          "description": "Require approval before completion",
          "longFlag": "--approval",
          "shortFlag": null
        },
        {
          "flags": "--clear-approval",
          "description": "Remove the approval requirement",
          "longFlag": "--clear-approval",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "done"
      ],
      "command": "done",
      "description": "Mark a task as completed",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--attach-ids <ids>",
          "description": "Comma-separated @hasna/attachments IDs to link as evidence",
          "longFlag": "--attach-ids",
          "shortFlag": null
        },
        {
          "flags": "--files-changed <files>",
          "description": "Comma-separated list of files changed",
          "longFlag": "--files-changed",
          "shortFlag": null
        },
        {
          "flags": "--test-results <results>",
          "description": "Test results summary",
          "longFlag": "--test-results",
          "shortFlag": null
        },
        {
          "flags": "--commit-hash <hash>",
          "description": "Git commit hash",
          "longFlag": "--commit-hash",
          "shortFlag": null
        },
        {
          "flags": "--notes <notes>",
          "description": "Completion notes",
          "longFlag": "--notes",
          "shortFlag": null
        },
        {
          "flags": "--confidence <0-1>",
          "description": "Agent's confidence 0.0-1.0 that the task is fully complete (default: 1.0, <0.7 flagged for review)",
          "longFlag": "--confidence",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "approve"
      ],
      "command": "approve",
      "description": "Approve a task that requires approval",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "start"
      ],
      "command": "start",
      "description": "Claim, lock, and start a task",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "lock"
      ],
      "command": "lock",
      "description": "Acquire exclusive lock on a task",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "unlock"
      ],
      "command": "unlock",
      "description": "Release lock on a task",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "delete"
      ],
      "command": "delete",
      "description": "Delete a task",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "remove"
      ],
      "command": "remove",
      "description": "Remove/delete a task (alias for delete)",
      "aliases": [],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "bulk"
      ],
      "command": "bulk",
      "description": "Bulk operation on multiple tasks (done, start, delete, plan)",
      "aliases": [],
      "usage": "[options] <action> <ids...>",
      "options": [
        {
          "flags": "--plan <id>",
          "description": "Plan ID for the plan/move-plan action",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--clear-plan",
          "description": "Remove plan assignment for the plan/move-plan action",
          "longFlag": "--clear-plan",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "plans"
      ],
      "command": "plans",
      "description": "List and manage plans",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--add <name>",
          "description": "Create a plan",
          "longFlag": "--add",
          "shortFlag": null
        },
        {
          "flags": "--slug <slug>",
          "description": "Readable plan slug (with --add)",
          "longFlag": "--slug",
          "shortFlag": null
        },
        {
          "flags": "-d, --description <text>",
          "description": "Plan description (with --add)",
          "longFlag": "--description",
          "shortFlag": "-d"
        },
        {
          "flags": "--show <id-or-slug>",
          "description": "Show plan details with its tasks",
          "longFlag": "--show",
          "shortFlag": null
        },
        {
          "flags": "--artifact <id-or-slug>",
          "description": "Show local Markdown artifact diagnostics for a plan",
          "longFlag": "--artifact",
          "shortFlag": null
        },
        {
          "flags": "--write-artifacts",
          "description": "Write local Markdown artifacts for all project-scoped plans in scope",
          "longFlag": "--write-artifacts",
          "shortFlag": null
        },
        {
          "flags": "--delete <id>",
          "description": "Delete a plan",
          "longFlag": "--delete",
          "shortFlag": null
        },
        {
          "flags": "--complete <id>",
          "description": "Mark a plan as completed",
          "longFlag": "--complete",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "templates"
      ],
      "command": "templates",
      "description": "List and manage task templates",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--add <name>",
          "description": "Create a template",
          "longFlag": "--add",
          "shortFlag": null
        },
        {
          "flags": "--title <pattern>",
          "description": "Title pattern (with --add)",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "-d, --description <text>",
          "description": "Default description",
          "longFlag": "--description",
          "shortFlag": "-d"
        },
        {
          "flags": "-p, --priority <level>",
          "description": "Default priority",
          "longFlag": "--priority",
          "shortFlag": "-p"
        },
        {
          "flags": "-t, --tags <tags>",
          "description": "Default tags (comma-separated)",
          "longFlag": "--tags",
          "shortFlag": "-t"
        },
        {
          "flags": "--delete <id>",
          "description": "Delete a template",
          "longFlag": "--delete",
          "shortFlag": null
        },
        {
          "flags": "--update <id>",
          "description": "Update a template",
          "longFlag": "--update",
          "shortFlag": null
        },
        {
          "flags": "--use <id>",
          "description": "Create a task from a template",
          "longFlag": "--use",
          "shortFlag": null
        },
        {
          "flags": "--var <vars...>",
          "description": "Variable substitutions: key=value (e.g. --var feature=login)",
          "longFlag": "--var",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "template-init"
      ],
      "command": "template-init",
      "description": "Initialize the bundled local template library",
      "aliases": [
        "templates-init"
      ],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "template-library"
      ],
      "command": "template-library",
      "description": "List, show, or write the bundled local template library as editable JSON files",
      "aliases": [
        "templates-library"
      ],
      "usage": "[options]",
      "options": [
        {
          "flags": "--show <name>",
          "description": "Show one bundled template as JSON",
          "longFlag": "--show",
          "shortFlag": null
        },
        {
          "flags": "--write <dir>",
          "description": "Write all bundled templates to editable JSON files",
          "longFlag": "--write",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "template-preview"
      ],
      "command": "template-preview",
      "description": "Preview a template without creating tasks — shows resolved titles, deps, and priorities",
      "aliases": [
        "templates-preview"
      ],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--var <vars...>",
          "description": "Variable substitution in key=value format (e.g. --var name=invoices)",
          "longFlag": "--var",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "template-export"
      ],
      "command": "template-export",
      "description": "Export a template as JSON to stdout",
      "aliases": [
        "templates-export"
      ],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "template-import"
      ],
      "command": "template-import",
      "description": "Import a template from a JSON file",
      "aliases": [
        "templates-import"
      ],
      "usage": "[options] [file]",
      "options": [
        {
          "flags": "--file <path>",
          "description": "Path to template JSON file (alternative to positional arg)",
          "longFlag": "--file",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "template-history"
      ],
      "command": "template-history",
      "description": "Show version history of a template",
      "aliases": [
        "templates-history"
      ],
      "usage": "[options] <id>",
      "options": []
    },
    {
      "path": [
        "project-bootstrap"
      ],
      "command": "project-bootstrap",
      "description": "Discover a local workspace and initialize project task state",
      "aliases": [],
      "usage": "[options] [path]",
      "options": [
        {
          "flags": "--name <name>",
          "description": "Project display name",
          "longFlag": "--name",
          "shortFlag": null
        },
        {
          "flags": "--task-list <slug>",
          "description": "Default task list slug",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--route-enabled",
          "description": "Mark the default task list as eligible for OpenLoops task-created routing",
          "longFlag": "--route-enabled",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Show discovery without writing local state",
          "longFlag": "--dry-run",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "comment"
      ],
      "command": "comment",
      "description": "Add a comment to a task (alias: log-progress, for recording intermediate progress)",
      "aliases": [
        "log-progress"
      ],
      "usage": "[options] <id> <text>",
      "options": [
        {
          "flags": "--pct <percent>",
          "description": "Progress percentage (0-100) to record alongside the note",
          "longFlag": "--pct",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "search"
      ],
      "command": "search",
      "description": "Search local tasks, or run/save a cross-entity search view",
      "aliases": [],
      "usage": "[options] <query>",
      "options": [
        {
          "flags": "--status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--priority <p>",
          "description": "Filter by priority",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--assigned <agent>",
          "description": "Filter by assigned agent",
          "longFlag": "--assigned",
          "shortFlag": null
        },
        {
          "flags": "--agent-id <agent>",
          "description": "Filter by creator/run/comment agent",
          "longFlag": "--agent-id",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Filter by task list",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Filter runs/comments by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Filter by task tag (repeatable or comma-separated)",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--field-label <label>",
          "description": "Filter by local field label (repeatable or comma-separated)",
          "longFlag": "--field-label",
          "shortFlag": null
        },
        {
          "flags": "--field-owner <owner>",
          "description": "Filter by local field owner",
          "longFlag": "--field-owner",
          "shortFlag": null
        },
        {
          "flags": "--field-area <area>",
          "description": "Filter by local field area",
          "longFlag": "--field-area",
          "shortFlag": null
        },
        {
          "flags": "--field-severity <severity>",
          "description": "Filter by local field severity",
          "longFlag": "--field-severity",
          "shortFlag": null
        },
        {
          "flags": "--field-custom <json>",
          "description": "Filter by local custom fields as JSON",
          "longFlag": "--field-custom",
          "shortFlag": null
        },
        {
          "flags": "--since <date>",
          "description": "Only tasks updated after this date (ISO)",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--created-after <date>",
          "description": "Only records created after this date (ISO)",
          "longFlag": "--created-after",
          "shortFlag": null
        },
        {
          "flags": "--blocked",
          "description": "Only blocked tasks (incomplete dependencies)",
          "longFlag": "--blocked",
          "shortFlag": null
        },
        {
          "flags": "--has-deps",
          "description": "Only tasks with dependencies",
          "longFlag": "--has-deps",
          "shortFlag": null
        },
        {
          "flags": "--depends-on <id>",
          "description": "Only tasks that depend on a task",
          "longFlag": "--depends-on",
          "shortFlag": null
        },
        {
          "flags": "--blocks <id>",
          "description": "Only tasks that block a task",
          "longFlag": "--blocks",
          "shortFlag": null
        },
        {
          "flags": "--scope <scope>",
          "description": "Search scope: tasks, projects, plans, runs, comments, all",
          "longFlag": "--scope",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum results",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--filter <json>",
          "description": "Merge an advanced saved-search filter JSON object",
          "longFlag": "--filter",
          "shortFlag": null
        },
        {
          "flags": "--save-as <name>",
          "description": "Save this search as a named view",
          "longFlag": "--save-as",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Saved view description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--all-projects",
          "description": "Do not auto-scope the search to the current project",
          "longFlag": "--all-projects",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "views"
      ],
      "command": "views",
      "description": "Manage local saved search views",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "views",
        "save"
      ],
      "command": "views save",
      "description": "Save a local search view",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--query <query>",
          "description": "Search query",
          "longFlag": "--query",
          "shortFlag": null
        },
        {
          "flags": "--scope <scope>",
          "description": "Search scope: tasks, projects, plans, runs, comments, all",
          "longFlag": "--scope",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--priority <p>",
          "description": "Filter by priority",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--assigned <agent>",
          "description": "Filter by assigned agent",
          "longFlag": "--assigned",
          "shortFlag": null
        },
        {
          "flags": "--agent-id <agent>",
          "description": "Filter by creator/run/comment agent",
          "longFlag": "--agent-id",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Filter by task list",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Filter runs/comments by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Filter by task tag (repeatable or comma-separated)",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--field-label <label>",
          "description": "Filter by local field label (repeatable or comma-separated)",
          "longFlag": "--field-label",
          "shortFlag": null
        },
        {
          "flags": "--field-owner <owner>",
          "description": "Filter by local field owner",
          "longFlag": "--field-owner",
          "shortFlag": null
        },
        {
          "flags": "--field-area <area>",
          "description": "Filter by local field area",
          "longFlag": "--field-area",
          "shortFlag": null
        },
        {
          "flags": "--field-severity <severity>",
          "description": "Filter by local field severity",
          "longFlag": "--field-severity",
          "shortFlag": null
        },
        {
          "flags": "--field-custom <json>",
          "description": "Filter by local custom fields as JSON",
          "longFlag": "--field-custom",
          "shortFlag": null
        },
        {
          "flags": "--since <date>",
          "description": "Only records updated after this date (ISO)",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--created-after <date>",
          "description": "Only records created after this date (ISO)",
          "longFlag": "--created-after",
          "shortFlag": null
        },
        {
          "flags": "--blocked",
          "description": "Only blocked tasks",
          "longFlag": "--blocked",
          "shortFlag": null
        },
        {
          "flags": "--has-deps",
          "description": "Only tasks with dependencies",
          "longFlag": "--has-deps",
          "shortFlag": null
        },
        {
          "flags": "--depends-on <id>",
          "description": "Only tasks that depend on a task",
          "longFlag": "--depends-on",
          "shortFlag": null
        },
        {
          "flags": "--blocks <id>",
          "description": "Only tasks that block a task",
          "longFlag": "--blocks",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum results",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--filter <json>",
          "description": "Merge an advanced saved-search filter JSON object",
          "longFlag": "--filter",
          "shortFlag": null
        },
        {
          "flags": "--all-projects",
          "description": "Do not auto-scope the view to the current project",
          "longFlag": "--all-projects",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "views",
        "list"
      ],
      "command": "views list",
      "description": "List local saved search views",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--scope <scope>",
          "description": "Filter by scope",
          "longFlag": "--scope",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "views",
        "run"
      ],
      "command": "views run",
      "description": "Run a local saved search view",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "views",
        "delete"
      ],
      "command": "views delete",
      "description": "Delete a local saved search view",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "deps"
      ],
      "command": "deps",
      "description": "Manage task dependencies",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--needs <dep-id>",
          "description": "Add dependency (this task needs dep-id)",
          "longFlag": "--needs",
          "shortFlag": null
        },
        {
          "flags": "--remove <dep-id>",
          "description": "Remove dependency",
          "longFlag": "--remove",
          "shortFlag": null
        },
        {
          "flags": "--graph",
          "description": "Show the dependency graph instead of direct edges",
          "longFlag": "--graph",
          "shortFlag": null
        },
        {
          "flags": "--direction <direction>",
          "description": "Graph direction: up, down, or both",
          "longFlag": "--direction",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "projects"
      ],
      "command": "projects",
      "description": "List and manage projects",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--add <path>",
          "description": "Register a project by path",
          "longFlag": "--add",
          "shortFlag": null
        },
        {
          "flags": "--show <project>",
          "description": "Resolve and show a project",
          "longFlag": "--show",
          "shortFlag": null
        },
        {
          "flags": "--update <project>",
          "description": "Update a project's name, path, or description",
          "longFlag": "--update",
          "shortFlag": null
        },
        {
          "flags": "--deregister <project>",
          "description": "Deregister a project without deleting its tasks; refuses projects with incomplete tasks",
          "longFlag": "--deregister",
          "shortFlag": null
        },
        {
          "flags": "--path-prefix <prefix>",
          "description": "Require deregistered project path to start with this prefix",
          "longFlag": "--path-prefix",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Show what would change without modifying local state",
          "longFlag": "--dry-run",
          "shortFlag": null
        },
        {
          "flags": "--name <name>",
          "description": "Project name (with --add)",
          "longFlag": "--name",
          "shortFlag": null
        },
        {
          "flags": "--path <path>",
          "description": "Project path (with --update)",
          "longFlag": "--path",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Project description (with --add or --update)",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--task-list-id <id>",
          "description": "Custom task list ID (with --add)",
          "longFlag": "--task-list-id",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "project-panel"
      ],
      "command": "project-panel",
      "description": "Emit a contract-valid project dashboard panel for todos",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <project>",
          "description": "Project path, id, task-list slug, or name. Defaults to the detected project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum panel items/resources",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--contract",
          "description": "Emit hasna.project_panel.v1 contract JSON",
          "longFlag": "--contract",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "project-rename"
      ],
      "command": "project-rename",
      "description": "Rename a project slug. Cascades to matching task lists. Task prefixes (e.g. APP-00001) are unchanged.",
      "aliases": [],
      "usage": "[options] <id-or-slug> <new-slug>",
      "options": [
        {
          "flags": "--name <name>",
          "description": "Also update the project display name",
          "longFlag": "--name",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "projects-path"
      ],
      "command": "projects-path",
      "description": "Manage machine-local path overrides for projects",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "projects-path",
        "set"
      ],
      "command": "projects-path set",
      "description": "Set the local path for a project on this machine",
      "aliases": [],
      "usage": "[options] <project-id> <path>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "projects-path",
        "list"
      ],
      "command": "projects-path list",
      "description": "List all machine path overrides for a project",
      "aliases": [],
      "usage": "[options] <project-id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "projects-path",
        "remove"
      ],
      "command": "projects-path remove",
      "description": "Remove the local path override for a project on this machine",
      "aliases": [],
      "usage": "[options] <project-id>",
      "options": [
        {
          "flags": "--machine <id>",
          "description": "Machine ID to remove override for (default: this machine)",
          "longFlag": "--machine",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "extract"
      ],
      "command": "extract",
      "description": "Extract TODO/FIXME/HACK/BUG/XXX/NOTE comments from source files and create tasks",
      "aliases": [],
      "usage": "[options] <path>",
      "options": [
        {
          "flags": "--dry-run",
          "description": "Show extracted comments without creating tasks",
          "longFlag": "--dry-run",
          "shortFlag": null
        },
        {
          "flags": "--pattern <tags>",
          "description": "Comma-separated tags to look for (default: TODO,FIXME,HACK,XXX,BUG,NOTE)",
          "longFlag": "--pattern",
          "shortFlag": null
        },
        {
          "flags": "-t, --tags <tags>",
          "description": "Extra comma-separated tags to add to created tasks",
          "longFlag": "--tags",
          "shortFlag": "-t"
        },
        {
          "flags": "--assign <agent>",
          "description": "Assign extracted tasks to an agent",
          "longFlag": "--assign",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--ext <extensions>",
          "description": "Comma-separated file extensions to scan (e.g. ts,py,go)",
          "longFlag": "--ext",
          "shortFlag": null
        },
        {
          "flags": "--exclude <patterns>",
          "description": "Comma-separated gitignore-style path patterns to skip",
          "longFlag": "--exclude",
          "shortFlag": null
        },
        {
          "flags": "--no-gitignore",
          "description": "Do not read .gitignore from the scanned root",
          "longFlag": "--no-gitignore",
          "shortFlag": null
        },
        {
          "flags": "--index",
          "description": "Include a local source index in JSON output",
          "longFlag": "--index",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "extract-watch"
      ],
      "command": "extract-watch",
      "description": "Poll a local source tree for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks",
      "aliases": [],
      "usage": "[options] <path>",
      "options": [
        {
          "flags": "--dry-run",
          "description": "Show extracted comments without creating tasks",
          "longFlag": "--dry-run",
          "shortFlag": null
        },
        {
          "flags": "--once",
          "description": "Run a single watcher scan and exit",
          "longFlag": "--once",
          "shortFlag": null
        },
        {
          "flags": "--max-runs <n>",
          "description": "Maximum watcher scans before exiting",
          "longFlag": "--max-runs",
          "shortFlag": null
        },
        {
          "flags": "--interval <ms>",
          "description": "Polling interval in milliseconds",
          "longFlag": "--interval",
          "shortFlag": null
        },
        {
          "flags": "--pattern <tags>",
          "description": "Comma-separated tags to look for",
          "longFlag": "--pattern",
          "shortFlag": null
        },
        {
          "flags": "-t, --tags <tags>",
          "description": "Extra comma-separated tags to add to created tasks",
          "longFlag": "--tags",
          "shortFlag": "-t"
        },
        {
          "flags": "--assign <agent>",
          "description": "Assign extracted tasks to an agent",
          "longFlag": "--assign",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--ext <extensions>",
          "description": "Comma-separated file extensions to scan",
          "longFlag": "--ext",
          "shortFlag": null
        },
        {
          "flags": "--exclude <patterns>",
          "description": "Comma-separated gitignore-style path patterns to skip",
          "longFlag": "--exclude",
          "shortFlag": null
        },
        {
          "flags": "--no-gitignore",
          "description": "Do not read .gitignore from the watched root",
          "longFlag": "--no-gitignore",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "export"
      ],
      "command": "export",
      "description": "Export tasks",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-f, --format <format>",
          "description": "Format: json, md, todos.md, or bridge",
          "longFlag": "--format",
          "shortFlag": "-f"
        },
        {
          "flags": "-o, --output <path>",
          "description": "Write export output to a file",
          "longFlag": "--output",
          "shortFlag": "-o"
        },
        {
          "flags": "--encrypt",
          "description": "Encrypt bridge exports with a local encryption profile",
          "longFlag": "--encrypt",
          "shortFlag": null
        },
        {
          "flags": "--encryption-profile <name>",
          "description": "Encryption profile name",
          "longFlag": "--encryption-profile",
          "shortFlag": null
        },
        {
          "flags": "--allow-plaintext-sensitive",
          "description": "Suppress plaintext bridge export warning",
          "longFlag": "--allow-plaintext-sensitive",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "bridge-import"
      ],
      "command": "bridge-import",
      "description": "Dry-run or apply a local hasna/todos bridge export bundle",
      "aliases": [],
      "usage": "[options] <file>",
      "options": [
        {
          "flags": "--apply",
          "description": "Apply the import. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--decrypt",
          "description": "Decrypt an encrypted bridge export before importing",
          "longFlag": "--decrypt",
          "shortFlag": null
        },
        {
          "flags": "--resolve-conflicts",
          "description": "Safely merge existing local tasks by filling blank fields, unioning tags, and recording unresolved divergences",
          "longFlag": "--resolve-conflicts",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "todos-md-import"
      ],
      "command": "todos-md-import",
      "description": "Dry-run or apply a local todos.md Markdown import",
      "aliases": [
        "markdown-import",
        "import-md"
      ],
      "usage": "[options] <file>",
      "options": [
        {
          "flags": "--apply",
          "description": "Apply the import. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--resolve-conflicts",
          "description": "Safely merge embedded bridge task conflicts while preserving local divergent fields",
          "longFlag": "--resolve-conflicts",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "sync"
      ],
      "command": "sync",
      "description": "Sync tasks with an agent task list (Claude uses native task list; others use JSON lists)",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--task-list <id>",
          "description": "Task list ID (Claude auto-detects from CLAUDE_CODE_TASK_LIST_ID or CLAUDE_CODE_SESSION_ID)",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent/provider to sync (default: claude)",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--all",
          "description": "Sync across all configured agents (TODOS_SYNC_AGENTS or default: claude,codex,gemini)",
          "longFlag": "--all",
          "shortFlag": null
        },
        {
          "flags": "--push",
          "description": "One-way: push SQLite tasks to agent task list",
          "longFlag": "--push",
          "shortFlag": null
        },
        {
          "flags": "--pull",
          "description": "One-way: pull agent task list into SQLite",
          "longFlag": "--pull",
          "shortFlag": null
        },
        {
          "flags": "--prefer <side>",
          "description": "Conflict strategy: local or remote",
          "longFlag": "--prefer",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "init"
      ],
      "command": "init",
      "description": "Register an agents and get a short UUID",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "-d, --description <text>",
          "description": "Agent description",
          "longFlag": "--description",
          "shortFlag": "-d"
        }
      ]
    },
    {
      "path": [
        "heartbeat"
      ],
      "command": "heartbeat",
      "description": "Update last_seen_at to signal you're still active",
      "aliases": [],
      "usage": "[options] [agent]",
      "options": []
    },
    {
      "path": [
        "release"
      ],
      "command": "release",
      "description": "Release/logout an agent — clears session binding so the name is immediately available",
      "aliases": [],
      "usage": "[options] [agent]",
      "options": [
        {
          "flags": "--session-id <id>",
          "description": "Only release if session ID matches",
          "longFlag": "--session-id",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "focus"
      ],
      "command": "focus",
      "description": "Focus on a project (or clear focus if no project given)",
      "aliases": [],
      "usage": "[options] [project]",
      "options": []
    },
    {
      "path": [
        "agents"
      ],
      "command": "agents",
      "description": "List registered agents",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "agents-normalize"
      ],
      "command": "agents-normalize",
      "description": "Rename invalid/generated agent names (agent, agent-1, name-2, two-word names) to safe one-word names",
      "aliases": [
        "normalize-agents"
      ],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "agent-update"
      ],
      "command": "agent-update",
      "description": "Update an agent's description, role, or other fields",
      "aliases": [
        "agents-update"
      ],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--description <text>",
          "description": "New description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--role <role>",
          "description": "New role",
          "longFlag": "--role",
          "shortFlag": null
        },
        {
          "flags": "--title <title>",
          "description": "New title",
          "longFlag": "--title",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "agent"
      ],
      "command": "agent",
      "description": "Show all info about an agent: tasks, status, last seen, stats",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "org"
      ],
      "command": "org",
      "description": "Show agent org chart — who reports to who",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--set <agent=manager>",
          "description": "Set reporting: 'seneca=julius' or 'seneca=' to clear",
          "longFlag": "--set",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "lists"
      ],
      "command": "lists",
      "description": "List and manage task lists",
      "aliases": [
        "task-lists",
        "tl"
      ],
      "usage": "[options]",
      "options": [
        {
          "flags": "--add <name>",
          "description": "Create a task list",
          "longFlag": "--add",
          "shortFlag": null
        },
        {
          "flags": "--show <id>",
          "description": "Resolve and show a task list",
          "longFlag": "--show",
          "shortFlag": null
        },
        {
          "flags": "--update <id>",
          "description": "Update a task list",
          "longFlag": "--update",
          "shortFlag": null
        },
        {
          "flags": "--name <name>",
          "description": "Name (with --update)",
          "longFlag": "--name",
          "shortFlag": null
        },
        {
          "flags": "--slug <slug>",
          "description": "Custom slug (with --add or --update)",
          "longFlag": "--slug",
          "shortFlag": null
        },
        {
          "flags": "-d, --description <text>",
          "description": "Description (with --add or --update)",
          "longFlag": "--description",
          "shortFlag": "-d"
        },
        {
          "flags": "--delete <id>",
          "description": "Delete a task list",
          "longFlag": "--delete",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "upgrade"
      ],
      "command": "upgrade",
      "description": "Update todos to the latest version",
      "aliases": [
        "self-update"
      ],
      "usage": "[options]",
      "options": [
        {
          "flags": "--check",
          "description": "Only check for updates, don't install",
          "longFlag": "--check",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "config"
      ],
      "command": "config",
      "description": "View or update configuration",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--get <key>",
          "description": "Get a config value",
          "longFlag": "--get",
          "shortFlag": null
        },
        {
          "flags": "--set <key=value>",
          "description": "Set a config value (e.g. completion_guard.enabled=true)",
          "longFlag": "--set",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "encryption"
      ],
      "command": "encryption",
      "description": "Manage local encryption profiles for fields and secure exports",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "encryption",
        "list"
      ],
      "command": "encryption list",
      "description": "List local encryption profiles",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "encryption",
        "set"
      ],
      "command": "encryption set",
      "description": "Create or update a local encryption profile",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--key-env <name>",
          "description": "Environment variable that supplies the encryption key",
          "longFlag": "--key-env",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Profile description",
          "longFlag": "--description",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "encryption",
        "status"
      ],
      "command": "encryption status",
      "description": "Show whether a local encryption profile is locked or unlocked",
      "aliases": [],
      "usage": "[options] [name]",
      "options": []
    },
    {
      "path": [
        "encryption",
        "remove"
      ],
      "command": "encryption remove",
      "description": "Remove a local encryption profile",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "encryption",
        "test"
      ],
      "command": "encryption test",
      "description": "Encrypt and decrypt a local test payload without storing key material",
      "aliases": [],
      "usage": "[options] [name]",
      "options": [
        {
          "flags": "--text <text>",
          "description": "Payload text",
          "longFlag": "--text",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "redaction"
      ],
      "command": "redaction",
      "description": "Manage local secret redaction patterns and scans",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "redaction",
        "status"
      ],
      "command": "redaction status",
      "description": "Show local secret redaction configuration",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "redaction",
        "add"
      ],
      "command": "redaction add",
      "description": "Add local secret redaction regex patterns or object key names",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--pattern <list>",
          "description": "Comma-separated regex patterns to redact from text",
          "longFlag": "--pattern",
          "shortFlag": null
        },
        {
          "flags": "--key <list>",
          "description": "Comma-separated metadata/object key names to redact",
          "longFlag": "--key",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "redaction",
        "scan"
      ],
      "command": "redaction scan",
      "description": "Scan text or a file for secret-like values without printing values",
      "aliases": [],
      "usage": "[options] [text]",
      "options": [
        {
          "flags": "--file <path>",
          "description": "File to scan",
          "longFlag": "--file",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "retention"
      ],
      "command": "retention",
      "description": "Preview or apply local retention cleanup for old comments, runs, verification evidence, and expired artifact files",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "retention",
        "cleanup"
      ],
      "command": "retention cleanup",
      "description": "Dry-run by default; add --apply and the exact --confirm value to delete local retention data",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--older-than-days <days>",
          "description": "Prune records older than this many days",
          "longFlag": "--older-than-days",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID to scope cleanup",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task-status <list>",
          "description": "Comma-separated task statuses to include",
          "longFlag": "--task-status",
          "shortFlag": null
        },
        {
          "flags": "--run-status <list>",
          "description": "Comma-separated run statuses to include",
          "longFlag": "--run-status",
          "shortFlag": null
        },
        {
          "flags": "--include <list>",
          "description": "Comma-separated scopes: comments,runs,verifications,expired-artifacts",
          "longFlag": "--include",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Apply the cleanup. Without this flag the command only previews.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--confirm <value>",
          "description": "Required exact confirmation for --apply",
          "longFlag": "--confirm",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "trust"
      ],
      "command": "trust",
      "description": "Manage local workspace trust and permission profiles",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "trust",
        "list"
      ],
      "command": "trust list",
      "description": "List local workspace trust profiles",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "trust",
        "status"
      ],
      "command": "trust status",
      "description": "Show local trust status for a workspace path",
      "aliases": [],
      "usage": "[options] [path]",
      "options": []
    },
    {
      "path": [
        "trust",
        "add"
      ],
      "command": "trust add",
      "description": "Add or update a local workspace trust profile",
      "aliases": [],
      "usage": "[options] <path>",
      "options": [
        {
          "flags": "--preset <preset>",
          "description": "restricted, readonly, standard, or trusted",
          "longFlag": "--preset",
          "shortFlag": null
        },
        {
          "flags": "--trusted <value>",
          "description": "Override trusted boolean",
          "longFlag": "--trusted",
          "shortFlag": null
        },
        {
          "flags": "--allow-command <list>",
          "description": "Comma-separated command prefixes or patterns",
          "longFlag": "--allow-command",
          "shortFlag": null
        },
        {
          "flags": "--deny-command <list>",
          "description": "Comma-separated denied command substrings or patterns",
          "longFlag": "--deny-command",
          "shortFlag": null
        },
        {
          "flags": "--tool <list>",
          "description": "Comma-separated tool permission names",
          "longFlag": "--tool",
          "shortFlag": null
        },
        {
          "flags": "--write-scope <list>",
          "description": "Comma-separated allowed write scopes relative to the root",
          "longFlag": "--write-scope",
          "shortFlag": null
        },
        {
          "flags": "--redact-env <list>",
          "description": "Comma-separated environment key patterns to redact",
          "longFlag": "--redact-env",
          "shortFlag": null
        },
        {
          "flags": "--no-prompt",
          "description": "Do not require prompts for unsafe checks",
          "longFlag": "--no-prompt",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "trust",
        "remove"
      ],
      "command": "trust remove",
      "description": "Remove a local workspace trust profile",
      "aliases": [],
      "usage": "[options] <path>",
      "options": []
    },
    {
      "path": [
        "trust",
        "check"
      ],
      "command": "trust check",
      "description": "Check whether a local command, tool, or write path is allowed",
      "aliases": [],
      "usage": "[options] [path]",
      "options": [
        {
          "flags": "--command <command>",
          "description": "Command line to check",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--tool <tool>",
          "description": "Tool permission to check",
          "longFlag": "--tool",
          "shortFlag": null
        },
        {
          "flags": "--write <path>",
          "description": "Write path to check",
          "longFlag": "--write",
          "shortFlag": null
        },
        {
          "flags": "--env <list>",
          "description": "Comma-separated environment keys to test for redaction",
          "longFlag": "--env",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "sandbox"
      ],
      "command": "sandbox",
      "description": "Manage local runner sandbox profiles and dry-run checks",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "sandbox",
        "list"
      ],
      "command": "sandbox list",
      "description": "List local runner sandbox profiles",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "sandbox",
        "set"
      ],
      "command": "sandbox set",
      "description": "Add or update a local runner sandbox profile",
      "aliases": [],
      "usage": "[options] <name> [root]",
      "options": [
        {
          "flags": "--allow-command <list>",
          "description": "Comma-separated command prefixes or patterns",
          "longFlag": "--allow-command",
          "shortFlag": null
        },
        {
          "flags": "--deny-command <list>",
          "description": "Comma-separated denied command substrings or patterns",
          "longFlag": "--deny-command",
          "shortFlag": null
        },
        {
          "flags": "--cwd-boundary <path>",
          "description": "Directory boundary for command cwd",
          "longFlag": "--cwd-boundary",
          "shortFlag": null
        },
        {
          "flags": "--write-scope <list>",
          "description": "Comma-separated allowed write scopes relative to the root",
          "longFlag": "--write-scope",
          "shortFlag": null
        },
        {
          "flags": "--env-allow <list>",
          "description": "Comma-separated environment keys or patterns to pass through",
          "longFlag": "--env-allow",
          "shortFlag": null
        },
        {
          "flags": "--redact-env <list>",
          "description": "Comma-separated environment key patterns to redact",
          "longFlag": "--redact-env",
          "shortFlag": null
        },
        {
          "flags": "--network <policy>",
          "description": "Network policy: none, local, or full",
          "longFlag": "--network",
          "shortFlag": null
        },
        {
          "flags": "--no-approval",
          "description": "Do not require approval when checks fail",
          "longFlag": "--no-approval",
          "shortFlag": null
        },
        {
          "flags": "--no-audit",
          "description": "Do not include audit evidence in check output",
          "longFlag": "--no-audit",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "sandbox",
        "remove"
      ],
      "command": "sandbox remove",
      "description": "Remove a local runner sandbox profile",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "sandbox",
        "check"
      ],
      "command": "sandbox check",
      "description": "Check whether a local runner action is allowed",
      "aliases": [],
      "usage": "[options] [name]",
      "options": [
        {
          "flags": "--path <path>",
          "description": "Workspace path to evaluate",
          "longFlag": "--path",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Command working directory",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--command <command>",
          "description": "Command line to check",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--write <list>",
          "description": "Comma-separated write paths to check",
          "longFlag": "--write",
          "shortFlag": null
        },
        {
          "flags": "--env <list>",
          "description": "Comma-separated environment keys to test",
          "longFlag": "--env",
          "shortFlag": null
        },
        {
          "flags": "--network",
          "description": "Request network access",
          "longFlag": "--network",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "sandbox",
        "explain"
      ],
      "command": "sandbox explain",
      "description": "Dry-run explain output for a local runner sandbox check",
      "aliases": [],
      "usage": "[options] [name]",
      "options": [
        {
          "flags": "--path <path>",
          "description": "Workspace path to evaluate",
          "longFlag": "--path",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Command working directory",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--command <command>",
          "description": "Command line to check",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--write <list>",
          "description": "Comma-separated write paths to check",
          "longFlag": "--write",
          "shortFlag": null
        },
        {
          "flags": "--env <list>",
          "description": "Comma-separated environment keys to test",
          "longFlag": "--env",
          "shortFlag": null
        },
        {
          "flags": "--network",
          "description": "Request network access",
          "longFlag": "--network",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "extensions"
      ],
      "command": "extensions",
      "description": "Manage local workflow extension registry",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "extensions",
        "list"
      ],
      "command": "extensions list",
      "description": "List installed local extensions",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "extensions",
        "discover"
      ],
      "command": "extensions discover",
      "description": "Discover local extension manifests from config and project .todos folders",
      "aliases": [],
      "usage": "[options] [project]",
      "options": [
        {
          "flags": "--no-installed",
          "description": "Do not include installed extension registry records",
          "longFlag": "--no-installed",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "extensions",
        "inspect"
      ],
      "command": "extensions inspect",
      "description": "Validate a local extension manifest, directory, or offline bundle without installing it",
      "aliases": [],
      "usage": "[options] <source>",
      "options": []
    },
    {
      "path": [
        "extensions",
        "install"
      ],
      "command": "extensions install",
      "description": "Install or update a local extension from a manifest, directory, or offline bundle",
      "aliases": [],
      "usage": "[options] <source>",
      "options": [
        {
          "flags": "--trust",
          "description": "Mark the extension trusted immediately",
          "longFlag": "--trust",
          "shortFlag": null
        },
        {
          "flags": "--checksum <sha256>",
          "description": "Expected sha256:<hex> checksum for the source manifest or bundle",
          "longFlag": "--checksum",
          "shortFlag": null
        },
        {
          "flags": "--signature <value>",
          "description": "Optional detached signature over the checksum",
          "longFlag": "--signature",
          "shortFlag": null
        },
        {
          "flags": "--public-key <pem>",
          "description": "Public key PEM string used to verify --signature",
          "longFlag": "--public-key",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "extensions",
        "compat"
      ],
      "command": "extensions compat",
      "description": "Run local CLI/MCP compatibility checks and runner sandbox dry-runs for an extension",
      "aliases": [],
      "usage": "[options] <source>",
      "options": []
    },
    {
      "path": [
        "extensions",
        "verify"
      ],
      "command": "extensions verify",
      "description": "Verify a local extension source checksum and optional signature without installing it",
      "aliases": [],
      "usage": "[options] <source>",
      "options": [
        {
          "flags": "--checksum <sha256>",
          "description": "Expected sha256:<hex> checksum for the source manifest or bundle",
          "longFlag": "--checksum",
          "shortFlag": null
        },
        {
          "flags": "--signature <value>",
          "description": "Optional detached signature over the checksum",
          "longFlag": "--signature",
          "shortFlag": null
        },
        {
          "flags": "--public-key <pem>",
          "description": "Public key PEM string used to verify --signature",
          "longFlag": "--public-key",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "extensions",
        "remove"
      ],
      "command": "extensions remove",
      "description": "Remove a local extension from the registry",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "workflows"
      ],
      "command": "workflows",
      "description": "List and render local guided workflow prompts",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "workflows",
        "list"
      ],
      "command": "workflows list",
      "description": "List bundled local workflow prompts",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "workflows",
        "show"
      ],
      "command": "workflows show",
      "description": "Render a guided workflow prompt as Markdown or JSON",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--objective <text>",
          "description": "Objective or goal text",
          "longFlag": "--objective",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task ID to ground the workflow",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent identity",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--context <text>",
          "description": "Additional local context",
          "longFlag": "--context",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "Output format: markdown or json",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "workflows",
        "export"
      ],
      "command": "workflows export",
      "description": "Export bundled local workflow prompt metadata",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--format <format>",
          "description": "Output format: json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "policies"
      ],
      "command": "policies",
      "description": "Manage local policy packs for task done gates",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "policies",
        "list"
      ],
      "command": "policies list",
      "description": "List local policy packs",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "policies",
        "set"
      ],
      "command": "policies set",
      "description": "Add or update a local policy pack",
      "aliases": [],
      "usage": "[options] <name> [root]",
      "options": [
        {
          "flags": "--version <number>",
          "description": "Policy pack version",
          "longFlag": "--version",
          "shortFlag": null
        },
        {
          "flags": "--required-command <list>",
          "description": "Comma-separated passed command patterns required for the task",
          "longFlag": "--required-command",
          "shortFlag": null
        },
        {
          "flags": "--prohibited-command <list>",
          "description": "Comma-separated command patterns that must not appear in evidence",
          "longFlag": "--prohibited-command",
          "shortFlag": null
        },
        {
          "flags": "--prohibited-path <list>",
          "description": "Comma-separated changed file or artifact path patterns that must not appear",
          "longFlag": "--prohibited-path",
          "shortFlag": null
        },
        {
          "flags": "--required-status <list>",
          "description": "Comma-separated allowed task statuses",
          "longFlag": "--required-status",
          "shortFlag": null
        },
        {
          "flags": "--require-passed-verification",
          "description": "Require at least one passed verification record",
          "longFlag": "--require-passed-verification",
          "shortFlag": null
        },
        {
          "flags": "--require-commit",
          "description": "Require at least one linked commit",
          "longFlag": "--require-commit",
          "shortFlag": null
        },
        {
          "flags": "--require-pr",
          "description": "Require at least one linked pull request",
          "longFlag": "--require-pr",
          "shortFlag": null
        },
        {
          "flags": "--require-approval",
          "description": "Require task approval fields",
          "longFlag": "--require-approval",
          "shortFlag": null
        },
        {
          "flags": "--require-run",
          "description": "Require at least one local run ledger",
          "longFlag": "--require-run",
          "shortFlag": null
        },
        {
          "flags": "--require-artifact",
          "description": "Require at least one verification or run artifact",
          "longFlag": "--require-artifact",
          "shortFlag": null
        },
        {
          "flags": "--evidence-min <number>",
          "description": "Minimum total evidence record count",
          "longFlag": "--evidence-min",
          "shortFlag": null
        },
        {
          "flags": "--branch-pattern <pattern>",
          "description": "Require a linked branch matching a string, wildcard, or /regex/",
          "longFlag": "--branch-pattern",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "policies",
        "remove"
      ],
      "command": "policies remove",
      "description": "Remove a local policy pack",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "policies",
        "validate"
      ],
      "command": "policies validate",
      "description": "Validate a task against a local policy pack",
      "aliases": [],
      "usage": "[options] <name> <task-id>",
      "options": []
    },
    {
      "path": [
        "policies",
        "explain"
      ],
      "command": "policies explain",
      "description": "Dry-run explain output for local policy-pack validation",
      "aliases": [],
      "usage": "[options] <name> <task-id>",
      "options": []
    },
    {
      "path": [
        "approvals"
      ],
      "command": "approvals",
      "description": "Manage local approval gates and manual checkpoints",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "approvals",
        "require"
      ],
      "command": "approvals require",
      "description": "Require a local manual approval gate before risky work",
      "aliases": [],
      "usage": "[options] <task-id> <gate>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Expected reviewer",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--requester <name>",
          "description": "Requester or agent creating the gate",
          "longFlag": "--requester",
          "shortFlag": null
        },
        {
          "flags": "--reason <text>",
          "description": "Why this gate is required",
          "longFlag": "--reason",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Related local plan ID",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Related local run ledger ID",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--expires-at <iso>",
          "description": "ISO timestamp when this pending gate expires",
          "longFlag": "--expires-at",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "approvals",
        "approve"
      ],
      "command": "approvals approve",
      "description": "Approve a local approval gate",
      "aliases": [],
      "usage": "[options] <task-id> <gate>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer or approver",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--note <text>",
          "description": "Approval note",
          "longFlag": "--note",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "approvals",
        "reject"
      ],
      "command": "approvals reject",
      "description": "Reject a local approval gate",
      "aliases": [],
      "usage": "[options] <task-id> <gate>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer or approver",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--reason <text>",
          "description": "Rejection reason",
          "longFlag": "--reason",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "approvals",
        "expire"
      ],
      "command": "approvals expire",
      "description": "Expire a pending local approval gate",
      "aliases": [],
      "usage": "[options] <task-id> <gate>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer or agent expiring the gate",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--reason <text>",
          "description": "Expiration reason",
          "longFlag": "--reason",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "approvals",
        "check"
      ],
      "command": "approvals check",
      "description": "Check whether a local approval gate allows work to proceed",
      "aliases": [],
      "usage": "[options] <task-id> <gate>",
      "options": []
    },
    {
      "path": [
        "approvals",
        "list"
      ],
      "command": "approvals list",
      "description": "List local approval gates for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": []
    },
    {
      "path": [
        "event-hooks"
      ],
      "command": "event-hooks",
      "description": "Manage local event hooks and automation triggers",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "event-hooks",
        "list"
      ],
      "command": "event-hooks list",
      "description": "List local event hooks",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "event-hooks",
        "set"
      ],
      "command": "event-hooks set",
      "description": "Add or update a local event hook",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--event <list>",
          "description": "Comma-separated events, or *",
          "longFlag": "--event",
          "shortFlag": null
        },
        {
          "flags": "--target <target>",
          "description": "stdout, file, socket, or script",
          "longFlag": "--target",
          "shortFlag": null
        },
        {
          "flags": "--file <path>",
          "description": "Append JSONL events to this file for file targets",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--socket <path>",
          "description": "Unix socket path for socket targets",
          "longFlag": "--socket",
          "shortFlag": null
        },
        {
          "flags": "--command <command>",
          "description": "Local script command for script targets",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Working directory for script targets",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--sandbox <name>",
          "description": "Runner sandbox profile used before script execution",
          "longFlag": "--sandbox",
          "shortFlag": null
        },
        {
          "flags": "--env <list>",
          "description": "Comma-separated KEY=value environment entries for script targets",
          "longFlag": "--env",
          "shortFlag": null
        },
        {
          "flags": "--attempts <number>",
          "description": "Delivery attempts for socket/script targets",
          "longFlag": "--attempts",
          "shortFlag": null
        },
        {
          "flags": "--backoff-ms <number>",
          "description": "Backoff between retry attempts in milliseconds",
          "longFlag": "--backoff-ms",
          "shortFlag": null
        },
        {
          "flags": "--disabled",
          "description": "Store hook disabled",
          "longFlag": "--disabled",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "event-hooks",
        "remove"
      ],
      "command": "event-hooks remove",
      "description": "Remove a local event hook",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "event-hooks",
        "test"
      ],
      "command": "event-hooks test",
      "description": "Deliver a test event to one local event hook",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--event <event>",
          "description": "Event type to emit",
          "longFlag": "--event",
          "shortFlag": null
        },
        {
          "flags": "--payload <json>",
          "description": "JSON payload for the test event",
          "longFlag": "--payload",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task ID to include in the payload",
          "longFlag": "--task",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "terminal-notifications"
      ],
      "command": "terminal-notifications",
      "description": "Manage local terminal notification watch rules",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "terminal-notifications",
        "list"
      ],
      "command": "terminal-notifications list",
      "description": "List local terminal notification rules",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "terminal-notifications",
        "set"
      ],
      "command": "terminal-notifications set",
      "description": "Add or update a local terminal notification watch rule",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--event <list>",
          "description": "Comma-separated events, or *",
          "longFlag": "--event",
          "shortFlag": null
        },
        {
          "flags": "--min-severity <level>",
          "description": "info, warning, or critical",
          "longFlag": "--min-severity",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "line or json",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "--status <list>",
          "description": "Comma-separated task statuses to match",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--priority <list>",
          "description": "Comma-separated priorities to match",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--agent <list>",
          "description": "Comma-separated agent IDs to match",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--project <list>",
          "description": "Comma-separated project IDs to match",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--contains <list>",
          "description": "Comma-separated payload text fragments to match",
          "longFlag": "--contains",
          "shortFlag": null
        },
        {
          "flags": "--quiet-hours <range>",
          "description": "Suppress notifications during HH:MM-HH:MM",
          "longFlag": "--quiet-hours",
          "shortFlag": null
        },
        {
          "flags": "--quiet-timezone <tz>",
          "description": "Quiet hours timezone: local or utc",
          "longFlag": "--quiet-timezone",
          "shortFlag": null
        },
        {
          "flags": "--bell",
          "description": "Ring the terminal bell for critical matches",
          "longFlag": "--bell",
          "shortFlag": null
        },
        {
          "flags": "--disabled",
          "description": "Store rule disabled",
          "longFlag": "--disabled",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "terminal-notifications",
        "remove"
      ],
      "command": "terminal-notifications remove",
      "description": "Remove a local terminal notification rule",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "terminal-notifications",
        "test"
      ],
      "command": "terminal-notifications test",
      "description": "Evaluate a local terminal notification rule against a sample event",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--event <event>",
          "description": "Event type to emit",
          "longFlag": "--event",
          "shortFlag": null
        },
        {
          "flags": "--payload <json>",
          "description": "JSON payload for the test event",
          "longFlag": "--payload",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task ID to include in the payload",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--timestamp <iso>",
          "description": "Timestamp to use for quiet-hours evaluation",
          "longFlag": "--timestamp",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "serve"
      ],
      "command": "serve",
      "description": "Start the web dashboard",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--port <port>",
          "description": "Port number",
          "longFlag": "--port",
          "shortFlag": null
        },
        {
          "flags": "--host <host>",
          "description": "Host to bind (default: 127.0.0.1 localhost only, use 0.0.0.0 for all interfaces)",
          "longFlag": "--host",
          "shortFlag": null
        },
        {
          "flags": "--api-key <key>",
          "description": "Require this API key for /api/* requests",
          "longFlag": "--api-key",
          "shortFlag": null
        },
        {
          "flags": "--no-open",
          "description": "Don't open browser automatically",
          "longFlag": "--no-open",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "watch"
      ],
      "command": "watch",
      "description": "Live-updating task list (refreshes every few seconds)",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-s, --status <status>",
          "description": "Filter by status (default: pending,in_progress)",
          "longFlag": "--status",
          "shortFlag": "-s"
        },
        {
          "flags": "-i, --interval <seconds>",
          "description": "Refresh interval in seconds",
          "longFlag": "--interval",
          "shortFlag": "-i"
        }
      ]
    },
    {
      "path": [
        "stream"
      ],
      "command": "stream",
      "description": "Subscribe to real-time task events via SSE (requires todos serve)",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Filter to events for a specific agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--events <list>",
          "description": "Comma-separated event types (default: all)",
          "longFlag": "--events",
          "shortFlag": null
        },
        {
          "flags": "--port <n>",
          "description": "Server port",
          "longFlag": "--port",
          "shortFlag": null
        },
        {
          "flags": "--json",
          "description": "Output raw JSON events",
          "longFlag": "--json",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "interactive"
      ],
      "command": "interactive",
      "description": "Launch interactive TUI",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "blame"
      ],
      "command": "blame",
      "description": "Show which tasks/agents touched a file and why — combines task_files + task_commits",
      "aliases": [],
      "usage": "[options] <file>",
      "options": []
    },
    {
      "path": [
        "dashboard"
      ],
      "command": "dashboard",
      "description": "Live-updating dashboard showing project health, agents, task flow",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--refresh <ms>",
          "description": "Refresh interval in ms (default: 2000)",
          "longFlag": "--refresh",
          "shortFlag": null
        },
        {
          "flags": "--snapshot",
          "description": "Print a deterministic local dashboard snapshot instead of launching the TUI",
          "longFlag": "--snapshot",
          "shortFlag": null
        },
        {
          "flags": "--view <view>",
          "description": "Snapshot/TUI view: overview, projects, tasks, plans, runs, dependencies, inbox, search",
          "longFlag": "--view",
          "shortFlag": null
        },
        {
          "flags": "--search <query>",
          "description": "Populate the search view with a local task search",
          "longFlag": "--search",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Rows per dashboard section in snapshot mode",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "Snapshot format: markdown or json",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output snapshot as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "references"
      ],
      "command": "references",
      "description": "Resolve local file, symbol, git, plan, run, task, and agent references",
      "aliases": [
        "refs"
      ],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "references",
        "resolve"
      ],
      "command": "references resolve",
      "description": "Resolve mentions using only local workspace, git, and todos state",
      "aliases": [],
      "usage": "[options] <mentions...>",
      "options": [
        {
          "flags": "--workspace <path>",
          "description": "Workspace root for file, symbol, and git references",
          "longFlag": "--workspace",
          "shortFlag": null
        },
        {
          "flags": "--max-symbol-matches <n>",
          "description": "Maximum symbol matches per symbol mention",
          "longFlag": "--max-symbol-matches",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "next"
      ],
      "command": "next",
      "description": "Show the best pending task to work on next",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Prefer tasks assigned to this agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "claim"
      ],
      "command": "claim",
      "description": "Atomically claim the best pending task for an agent",
      "aliases": [],
      "usage": "[options] <agent>",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--steal-stale",
          "description": "Steal the highest-priority stale task when no pending task is available",
          "longFlag": "--steal-stale",
          "shortFlag": null
        },
        {
          "flags": "--stale-minutes <n>",
          "description": "How long a task must be stale before stealing (default: 30)",
          "longFlag": "--stale-minutes",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "steal"
      ],
      "command": "steal",
      "description": "Work-stealing: take the highest-priority stale task from another agent",
      "aliases": [],
      "usage": "[options] <agent>",
      "options": [
        {
          "flags": "--stale-minutes <n>",
          "description": "How long a task must be stale (default: 30)",
          "longFlag": "--stale-minutes",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "status"
      ],
      "command": "status",
      "description": "Show full project health snapshot",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Include next task for this agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "recap"
      ],
      "command": "recap",
      "description": "Show what happened in the last N hours — completed tasks, new tasks, agent activity, blockers",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--hours <n>",
          "description": "Look back N hours (default: 8)",
          "longFlag": "--hours",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "standup"
      ],
      "command": "standup",
      "description": "Generate standup notes — completed since yesterday, in progress, blocked. Grouped by agent.",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--since <date>",
          "description": "ISO date or 'yesterday' (default: yesterday)",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "fail"
      ],
      "command": "fail",
      "description": "Mark a task as failed with optional reason and retry",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--reason <text>",
          "description": "Why it failed",
          "longFlag": "--reason",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent reporting the failure",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--retry",
          "description": "Auto-create a retry copy",
          "longFlag": "--retry",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "active"
      ],
      "command": "active",
      "description": "Show all currently in-progress tasks",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "stale"
      ],
      "command": "stale",
      "description": "Find tasks stuck in_progress with no recent activity",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--minutes <n>",
          "description": "Stale threshold in minutes",
          "longFlag": "--minutes",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "redistribute"
      ],
      "command": "redistribute",
      "description": "Release stale in-progress tasks and claim the best one (work-stealing)",
      "aliases": [],
      "usage": "[options] <agent>",
      "options": [
        {
          "flags": "--max-age <minutes>",
          "description": "Stale threshold in minutes",
          "longFlag": "--max-age",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Limit to a specific project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max stale tasks to release",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "assign"
      ],
      "command": "assign",
      "description": "Assign a task to an agent",
      "aliases": [],
      "usage": "[options] <id> <agent>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "unassign"
      ],
      "command": "unassign",
      "description": "Remove task assignment",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "tag"
      ],
      "command": "tag",
      "description": "Add a tag to a task",
      "aliases": [],
      "usage": "[options] <id> <tag>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "untag"
      ],
      "command": "untag",
      "description": "Remove a tag from a task",
      "aliases": [],
      "usage": "[options] <id> <tag>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "pin"
      ],
      "command": "pin",
      "description": "Escalate task to critical priority",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "summary"
      ],
      "command": "summary",
      "description": "Generate a markdown summary of recent task activity",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--days <n>",
          "description": "Days of history to include",
          "longFlag": "--days",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter to agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "doctor"
      ],
      "command": "doctor",
      "description": "Diagnose and optionally repair local task data issues",
      "aliases": [],
      "usage": "[options] [command]",
      "options": [
        {
          "flags": "--apply",
          "description": "Apply safe repairs. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--fix",
          "description": "Alias for --apply",
          "longFlag": "--fix",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "doctor",
        "routing"
      ],
      "command": "doctor routing",
      "description": "Diagnose (and with --apply, safely repair) task routing-metadata drift: working_dir, task_list_id linkage, invalid paths, cross-repo intent",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--apply",
          "description": "Apply safe auto-repairs (working_dir, task_list_id UUID relink) with per-task comments, a DB backup, and an undo record. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--fix",
          "description": "Alias for --apply",
          "longFlag": "--fix",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Scope to a single project (id, slug, or path)",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Scope to tasks carrying this tag",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--status <statuses>",
          "description": "Comma-separated statuses to inspect (default: pending,in_progress)",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--shard <index/total>",
          "description": "Deterministic project-stable one-based shard, e.g. 1/6",
          "longFlag": "--shard",
          "shortFlag": null
        },
        {
          "flags": "--include-archived",
          "description": "Include archived tasks",
          "longFlag": "--include-archived",
          "shortFlag": null
        },
        {
          "flags": "--no-verify-project-root",
          "description": "Skip machine-local project-root existence checks",
          "longFlag": "--no-verify-project-root",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Cap the number of tasks inspected",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--undo-record <path>",
          "description": "Where to write the undo record when --apply mutates",
          "longFlag": "--undo-record",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Emit the machine-consumable JSON contract (todos.routing_doctor.v1)",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "health"
      ],
      "command": "health",
      "description": "Check todos system health — database, config, connectivity",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "report"
      ],
      "command": "report",
      "description": "Analytics report: task activity, completion rates, agent breakdown",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--days <n>",
          "description": "Days to include in report",
          "longFlag": "--days",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--markdown",
          "description": "Output as markdown",
          "longFlag": "--markdown",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "today"
      ],
      "command": "today",
      "description": "Show task activity from today",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "yesterday"
      ],
      "command": "yesterday",
      "description": "Show task activity from yesterday",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "mine"
      ],
      "command": "mine",
      "description": "Show tasks assigned to you, grouped by status",
      "aliases": [],
      "usage": "[options] <agent>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "blocked"
      ],
      "command": "blocked",
      "description": "Show tasks blocked by incomplete dependencies",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "overdue"
      ],
      "command": "overdue",
      "description": "Show tasks past their due date",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "sla"
      ],
      "command": "sla",
      "description": "Show overdue or SLA-breached tasks that need escalation",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter to assigned agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max tasks to show",
          "longFlag": "--limit",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "week"
      ],
      "command": "week",
      "description": "Show task activity from the past 7 days",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "burndown"
      ],
      "command": "burndown",
      "description": "Show task completion velocity over the past 7 days",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--days <n>",
          "description": "Number of days",
          "longFlag": "--days",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "log"
      ],
      "command": "log",
      "description": "Show recent task activity log (git-log style)",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--limit <n>",
          "description": "Number of entries",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "timeline"
      ],
      "command": "timeline",
      "description": "Show a unified local activity timeline for tasks, projects, plans, or runs",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--task <id>",
          "description": "Filter to a task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter to a project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter to a plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Filter to a run ledger",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include entries at or after this ISO timestamp",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--until <iso>",
          "description": "Only include entries at or before this ISO timestamp",
          "longFlag": "--until",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Number of entries",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--offset <n>",
          "description": "Entries to skip; omitted starts at the first entry",
          "longFlag": "--offset",
          "shortFlag": null
        },
        {
          "flags": "--order <order>",
          "description": "Sort order: asc or desc",
          "longFlag": "--order",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "ready"
      ],
      "command": "ready",
      "description": "Show all tasks ready to be claimed (pending, unblocked, unlocked)",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max tasks to show",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--source-root <path>",
          "description": "Read-only source root to scan for .hasna/todos/todos.db (repeatable)",
          "longFlag": "--source-root",
          "shortFlag": null
        },
        {
          "flags": "--source-store <path>",
          "description": "Read-only todos SQLite store path to scan (repeatable)",
          "longFlag": "--source-store",
          "shortFlag": null
        },
        {
          "flags": "--include <pattern>",
          "description": "Include source repo/store paths matching substring or glob (repeatable or comma-separated)",
          "longFlag": "--include",
          "shortFlag": null
        },
        {
          "flags": "--exclude <pattern>",
          "description": "Exclude source repo/store paths matching substring or glob (repeatable or comma-separated)",
          "longFlag": "--exclude",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "sprint"
      ],
      "command": "sprint",
      "description": "Sprint dashboard: in-progress, next up, blockers, and overdue",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reports"
      ],
      "command": "reports",
      "description": "Build local agent-native reports from tasks, plans, runs, and verification evidence",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "reports",
        "local"
      ],
      "command": "reports local",
      "description": "Build a local JSON or Markdown report for agent planning and standups",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter to plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter to agent or assignee",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include task, run, and verification activity since this timestamp",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--until <iso>",
          "description": "Only include task, run, and verification activity until this timestamp",
          "longFlag": "--until",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum rows per report section",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "Output format: json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "handoff"
      ],
      "command": "handoff",
      "description": "Create or view agent session handoffs",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--create",
          "description": "Create a new handoff",
          "longFlag": "--create",
          "shortFlag": null
        },
        {
          "flags": "--read <id>",
          "description": "Read one handoff by ID or prefix",
          "longFlag": "--read",
          "shortFlag": null
        },
        {
          "flags": "--export <id>",
          "description": "Export one handoff bundle by ID or prefix",
          "longFlag": "--export",
          "shortFlag": null
        },
        {
          "flags": "--import <file>",
          "description": "Import a handoff bundle from a JSON file",
          "longFlag": "--import",
          "shortFlag": null
        },
        {
          "flags": "--output <path>",
          "description": "Write exported handoff bundle to a file",
          "longFlag": "--output",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Apply an imported handoff bundle; imports default to dry-run preview",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--ack <id>",
          "description": "Acknowledge a handoff as read for an agent",
          "longFlag": "--ack",
          "shortFlag": null
        },
        {
          "flags": "--recover",
          "description": "Create a recovery handoff from active stale session context",
          "longFlag": "--recover",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent name",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--session <id>",
          "description": "Session ID for handoff or recovery context",
          "longFlag": "--session",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Handoff summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--completed <items>",
          "description": "Comma-separated completed items",
          "longFlag": "--completed",
          "shortFlag": null
        },
        {
          "flags": "--in-progress <items>",
          "description": "Comma-separated in-progress items",
          "longFlag": "--in-progress",
          "shortFlag": null
        },
        {
          "flags": "--blockers <items>",
          "description": "Comma-separated blockers",
          "longFlag": "--blockers",
          "shortFlag": null
        },
        {
          "flags": "--next <items>",
          "description": "Comma-separated next steps",
          "longFlag": "--next",
          "shortFlag": null
        },
        {
          "flags": "--tasks <ids>",
          "description": "Comma-separated task IDs or prefixes",
          "longFlag": "--tasks",
          "shortFlag": null
        },
        {
          "flags": "--files <paths>",
          "description": "Comma-separated relevant files",
          "longFlag": "--files",
          "shortFlag": null
        },
        {
          "flags": "--runs <ids>",
          "description": "Comma-separated run IDs",
          "longFlag": "--runs",
          "shortFlag": null
        },
        {
          "flags": "--unread-for <agent>",
          "description": "Only list handoffs not acknowledged by this agent",
          "longFlag": "--unread-for",
          "shortFlag": null
        },
        {
          "flags": "--reason <text>",
          "description": "Recovery reason",
          "longFlag": "--reason",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--limit <n>",
          "description": "Number of handoffs to show",
          "longFlag": "--limit",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "priorities"
      ],
      "command": "priorities",
      "description": "Show task counts grouped by priority",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--project <id>",
          "description": "Filter to project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "context"
      ],
      "command": "context",
      "description": "Session start context: status, latest handoff, next task, overdue",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <name>",
          "description": "Agent name for handoff lookup",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "release-notes"
      ],
      "command": "release-notes",
      "description": "Generate local release notes and changelog output from completed tasks",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project filter",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan filter",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--task <ids>",
          "description": "Comma-separated task IDs or prefixes",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Only include completed tasks with a tag",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include tasks completed at or after this ISO timestamp",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--until <iso>",
          "description": "Only include tasks completed at or before this ISO timestamp",
          "longFlag": "--until",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Release notes title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--version <version>",
          "description": "Release version label",
          "longFlag": "--version",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "Output format: markdown or json",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "--out <path>",
          "description": "Write output to a local file",
          "longFlag": "--out",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "context-pack"
      ],
      "command": "context-pack",
      "description": "Build a deterministic local agent context pack for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--profile <profile>",
          "description": "Agent profile: codex, claude, takumi, generic",
          "longFlag": "--profile",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "Output format: markdown or json",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Limit run evidence to a specific run ID or prefix",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--comments <n>",
          "description": "Recent comments to include",
          "longFlag": "--comments",
          "shortFlag": null
        },
        {
          "flags": "--files <n>",
          "description": "Relevant files to include",
          "longFlag": "--files",
          "shortFlag": null
        },
        {
          "flags": "--verifications <n>",
          "description": "Verification records to include",
          "longFlag": "--verifications",
          "shortFlag": null
        },
        {
          "flags": "--runs <n>",
          "description": "Run ledgers to include",
          "longFlag": "--runs",
          "shortFlag": null
        },
        {
          "flags": "--dependencies <n>",
          "description": "Dependencies per direction to include",
          "longFlag": "--dependencies",
          "shortFlag": null
        },
        {
          "flags": "--plan-tasks <n>",
          "description": "Plan sibling tasks to include",
          "longFlag": "--plan-tasks",
          "shortFlag": null
        },
        {
          "flags": "--max-text <n>",
          "description": "Max characters for long text fields",
          "longFlag": "--max-text",
          "shortFlag": null
        },
        {
          "flags": "--summary-chars <n>",
          "description": "Max characters for local omission summaries",
          "longFlag": "--summary-chars",
          "shortFlag": null
        },
        {
          "flags": "--token-budget <n>",
          "description": "Approximate token budget for compacting context locally",
          "longFlag": "--token-budget",
          "shortFlag": null
        },
        {
          "flags": "--include <sections>",
          "description": "Comma-separated sections to include before budgeting",
          "longFlag": "--include",
          "shortFlag": null
        },
        {
          "flags": "--exclude <sections>",
          "description": "Comma-separated sections to omit before budgeting",
          "longFlag": "--exclude",
          "shortFlag": null
        },
        {
          "flags": "--compact",
          "description": "Render compact Markdown or minified JSON",
          "longFlag": "--compact",
          "shortFlag": null
        },
        {
          "flags": "--stale-after-hours <n>",
          "description": "Warn when task state is older than this many hours",
          "longFlag": "--stale-after-hours",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "calendar"
      ],
      "command": "calendar",
      "description": "List and export local calendar events",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "calendar",
        "list"
      ],
      "command": "calendar list",
      "description": "List local calendar events from tasks, SLA thresholds, runs, and local items",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--from <iso>",
          "description": "Start window",
          "longFlag": "--from",
          "shortFlag": null
        },
        {
          "flags": "--to <iso>",
          "description": "End window",
          "longFlag": "--to",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project filter",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task filter",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan filter",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--kind <kind>",
          "description": "Event kind filter",
          "longFlag": "--kind",
          "shortFlag": null
        },
        {
          "flags": "--include-completed",
          "description": "Include completed/cancelled tasks",
          "longFlag": "--include-completed",
          "shortFlag": null
        },
        {
          "flags": "--no-runs",
          "description": "Exclude run events",
          "longFlag": "--no-runs",
          "shortFlag": null
        },
        {
          "flags": "--no-sla",
          "description": "Exclude SLA threshold events",
          "longFlag": "--no-sla",
          "shortFlag": null
        },
        {
          "flags": "--no-local",
          "description": "Exclude local calendar items",
          "longFlag": "--no-local",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max events",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "calendar",
        "add"
      ],
      "command": "calendar add",
      "description": "Create a local reminder, milestone, or work block",
      "aliases": [],
      "usage": "[options] <title>",
      "options": [
        {
          "flags": "--kind <kind>",
          "description": "task_reminder, milestone, work_block, imported",
          "longFlag": "--kind",
          "shortFlag": null
        },
        {
          "flags": "--start <iso>",
          "description": "Start timestamp",
          "longFlag": "--start",
          "shortFlag": null
        },
        {
          "flags": "--end <iso>",
          "description": "End timestamp",
          "longFlag": "--end",
          "shortFlag": null
        },
        {
          "flags": "--timezone <tz>",
          "description": "Timezone label",
          "longFlag": "--timezone",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project link",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task link",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan link",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Run link",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--rrule <rule>",
          "description": "Natural recurrence rule or ICS RRULE",
          "longFlag": "--rrule",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Metadata JSON object",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "calendar",
        "export"
      ],
      "command": "calendar export",
      "description": "Export deterministic local calendar events as ICS",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--from <iso>",
          "description": "Start window",
          "longFlag": "--from",
          "shortFlag": null
        },
        {
          "flags": "--to <iso>",
          "description": "End window",
          "longFlag": "--to",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project filter",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task filter",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan filter",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--kind <kind>",
          "description": "Event kind filter",
          "longFlag": "--kind",
          "shortFlag": null
        },
        {
          "flags": "--name <text>",
          "description": "Calendar name",
          "longFlag": "--name",
          "shortFlag": null
        },
        {
          "flags": "--redact",
          "description": "Redact event summaries and descriptions",
          "longFlag": "--redact",
          "shortFlag": null
        },
        {
          "flags": "--out <path>",
          "description": "Write ICS to file",
          "longFlag": "--out",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON envelope",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "calendar",
        "import"
      ],
      "command": "calendar import",
      "description": "Import VEVENT entries from an ICS file as local imported calendar items",
      "aliases": [],
      "usage": "[options] <path>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "notifications"
      ],
      "command": "notifications",
      "description": "Check local due-date, SLA, stale-task, run, and reminder alerts",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "notifications",
        "check"
      ],
      "command": "notifications check",
      "description": "Evaluate local notification alerts and optionally emit local hooks or terminal watch rules",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project filter",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent filter",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--now <iso>",
          "description": "Evaluation timestamp",
          "longFlag": "--now",
          "shortFlag": null
        },
        {
          "flags": "--due-within-minutes <n>",
          "description": "Warn for tasks and reminders due within this many minutes",
          "longFlag": "--due-within-minutes",
          "shortFlag": null
        },
        {
          "flags": "--stale-minutes <n>",
          "description": "Minutes before an in-progress task is stale",
          "longFlag": "--stale-minutes",
          "shortFlag": null
        },
        {
          "flags": "--run-since <iso>",
          "description": "Only include completed run alerts at or after this timestamp",
          "longFlag": "--run-since",
          "shortFlag": null
        },
        {
          "flags": "--no-runs",
          "description": "Exclude completed run alerts",
          "longFlag": "--no-runs",
          "shortFlag": null
        },
        {
          "flags": "--no-calendar",
          "description": "Exclude local calendar reminder alerts",
          "longFlag": "--no-calendar",
          "shortFlag": null
        },
        {
          "flags": "--emit-hooks",
          "description": "Emit matching local event hooks for generated alerts",
          "longFlag": "--emit-hooks",
          "shortFlag": null
        },
        {
          "flags": "--terminal",
          "description": "Evaluate terminal notification rules for generated alerts",
          "longFlag": "--terminal",
          "shortFlag": null
        },
        {
          "flags": "--quiet-hours <range>",
          "description": "Suppress hook and terminal delivery during HH:MM-HH:MM",
          "longFlag": "--quiet-hours",
          "shortFlag": null
        },
        {
          "flags": "--quiet-timezone <tz>",
          "description": "Quiet hours timezone: local or utc",
          "longFlag": "--quiet-timezone",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max alerts",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board"
      ],
      "command": "board",
      "description": "Render local task and plan kanban boards",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "board",
        "create"
      ],
      "command": "board create",
      "description": "Create a local kanban board",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--scope <scope>",
          "description": "Board scope: tasks or plans",
          "longFlag": "--scope",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project filter",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Task list filter",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan filter for task boards",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent filter",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--lane <spec...>",
          "description": "Lane spec: Name=status,status[:wip_limit]",
          "longFlag": "--lane",
          "shortFlag": null
        },
        {
          "flags": "--filter <json>",
          "description": "Saved board filters as JSON",
          "longFlag": "--filter",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board",
        "list"
      ],
      "command": "board list",
      "description": "List local kanban boards",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--scope <scope>",
          "description": "Filter by tasks or plans",
          "longFlag": "--scope",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board",
        "show"
      ],
      "command": "board show",
      "description": "Render a local kanban board",
      "aliases": [],
      "usage": "[options] <board>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output JSON snapshot",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board",
        "tui"
      ],
      "command": "board tui",
      "description": "Render a keyboard-oriented terminal board snapshot",
      "aliases": [],
      "usage": "[options] <board>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output JSON snapshot with key bindings",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board",
        "move"
      ],
      "command": "board move",
      "description": "Move a task or plan card to a lane or explicit status",
      "aliases": [],
      "usage": "[options] <board> <card-id>",
      "options": [
        {
          "flags": "--lane <id>",
          "description": "Target lane id or name",
          "longFlag": "--lane",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Explicit target workflow status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board",
        "export"
      ],
      "command": "board export",
      "description": "Export local board definitions as a portable JSON bundle",
      "aliases": [],
      "usage": "[options] [board]",
      "options": [
        {
          "flags": "--out <path>",
          "description": "Write bundle to file",
          "longFlag": "--out",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board",
        "import"
      ],
      "command": "board import",
      "description": "Import local board definitions from a JSON bundle",
      "aliases": [],
      "usage": "[options] <path>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "board",
        "delete"
      ],
      "command": "board delete",
      "description": "Delete a local board definition",
      "aliases": [],
      "usage": "[options] <board>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time"
      ],
      "command": "time",
      "description": "Track local task time and focus sessions",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "time",
        "log"
      ],
      "command": "time log",
      "description": "Log completed local time against a task",
      "aliases": [],
      "usage": "[options] <task-id> <minutes>",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Agent logging the time",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Run ID to link",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--started-at <iso>",
          "description": "ISO timestamp when work started",
          "longFlag": "--started-at",
          "shortFlag": null
        },
        {
          "flags": "--ended-at <iso>",
          "description": "ISO timestamp when work ended",
          "longFlag": "--ended-at",
          "shortFlag": null
        },
        {
          "flags": "--notes <text>",
          "description": "Notes about the work",
          "longFlag": "--notes",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time",
        "start"
      ],
      "command": "time start",
      "description": "Start a local focus session",
      "aliases": [],
      "usage": "[options] [task-id]",
      "options": [
        {
          "flags": "--plan <id>",
          "description": "Plan ID to link",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Run ID to link",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent starting the session",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Focus session title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--started-at <iso>",
          "description": "ISO timestamp when focus started",
          "longFlag": "--started-at",
          "shortFlag": null
        },
        {
          "flags": "--idle-after <minutes>",
          "description": "Prompt when the session has been active this many minutes",
          "longFlag": "--idle-after",
          "shortFlag": null
        },
        {
          "flags": "--notes <text>",
          "description": "Session notes",
          "longFlag": "--notes",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time",
        "pause"
      ],
      "command": "time pause",
      "description": "Pause an active focus session",
      "aliases": [],
      "usage": "[options] <session-id>",
      "options": [
        {
          "flags": "--at <iso>",
          "description": "ISO pause timestamp",
          "longFlag": "--at",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time",
        "resume"
      ],
      "command": "time resume",
      "description": "Resume a paused focus session",
      "aliases": [],
      "usage": "[options] <session-id>",
      "options": [
        {
          "flags": "--at <iso>",
          "description": "ISO resume timestamp",
          "longFlag": "--at",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time",
        "stop"
      ],
      "command": "time stop",
      "description": "Stop a focus session and log task time when linked to a task",
      "aliases": [],
      "usage": "[options] <session-id>",
      "options": [
        {
          "flags": "--at <iso>",
          "description": "ISO stop timestamp",
          "longFlag": "--at",
          "shortFlag": null
        },
        {
          "flags": "--cancel",
          "description": "Cancel instead of completing; does not create a time log",
          "longFlag": "--cancel",
          "shortFlag": null
        },
        {
          "flags": "--notes <text>",
          "description": "Completion notes",
          "longFlag": "--notes",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time",
        "list"
      ],
      "command": "time list",
      "description": "List local focus sessions",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--task <id>",
          "description": "Filter by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Filter by run",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--all",
          "description": "Include completed and cancelled sessions",
          "longFlag": "--all",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max sessions",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time",
        "idle"
      ],
      "command": "time idle",
      "description": "Show active focus sessions that need an idle prompt",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--now <iso>",
          "description": "Reference time",
          "longFlag": "--now",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "time",
        "report"
      ],
      "command": "time report",
      "description": "Report local actual time against estimates",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only tasks updated or completed since this date",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--include-open",
          "description": "Include open tasks",
          "longFlag": "--include-open",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "fields"
      ],
      "command": "fields",
      "description": "Manage local labels, priority, severity, owner, area, and custom fields",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "fields",
        "show"
      ],
      "command": "fields show",
      "description": "Show local fields for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "fields",
        "set"
      ],
      "command": "fields set",
      "description": "Set local fields for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--labels <labels>",
          "description": "Comma-separated labels",
          "longFlag": "--labels",
          "shortFlag": null
        },
        {
          "flags": "--priority <priority>",
          "description": "Priority: low, medium, high, critical",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "Local severity, for example s0, s1, s2",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--owner <owner>",
          "description": "Local owner or responsible agent",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--area <area>",
          "description": "Local area or component",
          "longFlag": "--area",
          "shortFlag": null
        },
        {
          "flags": "--custom <json>",
          "description": "Custom fields as a JSON object",
          "longFlag": "--custom",
          "shortFlag": null
        },
        {
          "flags": "--field <pairs...>",
          "description": "Custom key=value pairs",
          "longFlag": "--field",
          "shortFlag": null
        },
        {
          "flags": "--replace-custom",
          "description": "Replace custom fields instead of merging",
          "longFlag": "--replace-custom",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "fields",
        "query"
      ],
      "command": "fields query",
      "description": "Query tasks by local fields",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--labels <labels>",
          "description": "Comma-separated labels all matching tasks must have",
          "longFlag": "--labels",
          "shortFlag": null
        },
        {
          "flags": "--priority <priority>",
          "description": "Priority: low, medium, high, critical",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "Local severity",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--owner <owner>",
          "description": "Local owner or responsible agent",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--area <area>",
          "description": "Local area or component",
          "longFlag": "--area",
          "shortFlag": null
        },
        {
          "flags": "--custom <json>",
          "description": "Custom field query as a JSON object",
          "longFlag": "--custom",
          "shortFlag": null
        },
        {
          "flags": "--field <pairs...>",
          "description": "Custom key=value pairs",
          "longFlag": "--field",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum tasks to return",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "workflow"
      ],
      "command": "workflow",
      "description": "Manage local project workflow states",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "workflow",
        "states"
      ],
      "command": "workflow states",
      "description": "List local workflow states",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project-path <path>",
          "description": "Project path override for workflow configuration",
          "longFlag": "--project-path",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "workflow",
        "set"
      ],
      "command": "workflow set",
      "description": "Set a task's local workflow state",
      "aliases": [],
      "usage": "[options] <task-id> <state>",
      "options": [
        {
          "flags": "--actor <agent>",
          "description": "Agent or user changing the state",
          "longFlag": "--actor",
          "shortFlag": null
        },
        {
          "flags": "--project-path <path>",
          "description": "Project path override for workflow configuration",
          "longFlag": "--project-path",
          "shortFlag": null
        },
        {
          "flags": "--force",
          "description": "Bypass configured transition guards",
          "longFlag": "--force",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "workflow",
        "tasks"
      ],
      "command": "workflow tasks",
      "description": "List tasks by local workflow state",
      "aliases": [],
      "usage": "[options] <state>",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project filter",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Task list filter",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--project-path <path>",
          "description": "Project path override for workflow configuration",
          "longFlag": "--project-path",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum tasks to return",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "workflow",
        "migrate"
      ],
      "command": "workflow migrate",
      "description": "Backfill local workflow state metadata from canonical task statuses",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--apply",
          "description": "Write migration metadata",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project filter",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task-list <id>",
          "description": "Task list filter",
          "longFlag": "--task-list",
          "shortFlag": null
        },
        {
          "flags": "--project-path <path>",
          "description": "Project path override for workflow configuration",
          "longFlag": "--project-path",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum tasks to inspect",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "dedupe"
      ],
      "command": "dedupe",
      "description": "Find and merge likely duplicate local tasks",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "dedupe",
        "scan"
      ],
      "command": "dedupe scan",
      "description": "Scan local tasks for likely duplicates",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--threshold <n>",
          "description": "Minimum duplicate score from 0 to 1",
          "longFlag": "--threshold",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum tasks to compare",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--include-archived",
          "description": "Include archived tasks",
          "longFlag": "--include-archived",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "dedupe",
        "merge"
      ],
      "command": "dedupe merge",
      "description": "Merge a duplicate task into a primary task and archive the duplicate",
      "aliases": [],
      "usage": "[options] <primary-task-id> <duplicate-task-id>",
      "options": [
        {
          "flags": "--agent <agent>",
          "description": "Agent ID recording the merge",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--reason <reason>",
          "description": "Human-readable merge reason",
          "longFlag": "--reason",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "issues"
      ],
      "command": "issues",
      "description": "Import external issue data into local tasks",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "issues",
        "import"
      ],
      "command": "issues import",
      "description": "Dry-run or apply local imports from GitHub, Linear, Jira, or plain URL issue data",
      "aliases": [],
      "usage": "[options] [text]",
      "options": [
        {
          "flags": "--file <path>",
          "description": "Read issue data from a JSON, Markdown, or text file",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--url <url>",
          "description": "Source issue URL",
          "longFlag": "--url",
          "shortFlag": null
        },
        {
          "flags": "--provider <provider>",
          "description": "github, linear, jira, or url",
          "longFlag": "--provider",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID for created tasks",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID for created tasks",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--priority <priority>",
          "description": "Default priority for records without explicit priority",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Create local tasks; default is dry-run preview",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--allow-network",
          "description": "Allow explicit provider CLI/API fetches when supported",
          "longFlag": "--allow-network",
          "shortFlag": null
        },
        {
          "flags": "--no-inbox",
          "description": "Do not create linked inbox evidence for applied imports",
          "longFlag": "--no-inbox",
          "shortFlag": null
        },
        {
          "flags": "--no-dedupe",
          "description": "Do not skip records that match existing source metadata",
          "longFlag": "--no-dedupe",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "issues",
        "report"
      ],
      "command": "issues report",
      "description": "Dry-run or apply testers.issue_report.v1 payloads into local tasks",
      "aliases": [],
      "usage": "[options] [json]",
      "options": [
        {
          "flags": "--file <path>",
          "description": "Read a tester issue report JSON object, array, or { reports: [] } bundle",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID for created tasks",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID for created tasks",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--priority <priority>",
          "description": "Default priority when report severity is missing",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--assign <agent>",
          "description": "Assign created or updated tasks to an agent",
          "longFlag": "--assign",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Create or update local tasks; default is dry-run preview",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--no-update-existing",
          "description": "Match existing tasks without updating them",
          "longFlag": "--no-update-existing",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "inbox"
      ],
      "command": "inbox",
      "description": "Capture local inbox items from pasted errors, CI logs, git context, files, or GitHub issue URLs",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "inbox",
        "add"
      ],
      "command": "inbox add",
      "description": "Create a local inbox item and linked task from text, stdin, or a file",
      "aliases": [],
      "usage": "[options] [text]",
      "options": [
        {
          "flags": "--file <path>",
          "description": "Read captured context from a file",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--source-type <type>",
          "description": "pasted_error, ci_log, git_context, github_issue, file, or other",
          "longFlag": "--source-type",
          "shortFlag": null
        },
        {
          "flags": "--source-name <name>",
          "description": "Human-readable source name",
          "longFlag": "--source-name",
          "shortFlag": null
        },
        {
          "flags": "--source-url <url>",
          "description": "Source URL, including GitHub issue URLs",
          "longFlag": "--source-url",
          "shortFlag": null
        },
        {
          "flags": "--title <title>",
          "description": "Task/inbox title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--priority <priority>",
          "description": "Task priority",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--tags <tags>",
          "description": "Comma-separated extra tags",
          "longFlag": "--tags",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional JSON metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--no-task",
          "description": "Only store inbox item; do not create a linked task",
          "longFlag": "--no-task",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "inbox",
        "git"
      ],
      "command": "inbox git",
      "description": "Capture local git status and optional diff/stat context into the inbox",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--diff",
          "description": "Include git diff --stat and short diff context",
          "longFlag": "--diff",
          "shortFlag": null
        },
        {
          "flags": "--title <title>",
          "description": "Task/inbox title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "inbox",
        "parse"
      ],
      "command": "inbox parse",
      "description": "Preview or apply deterministic local natural-language task intake",
      "aliases": [],
      "usage": "[options] [text]",
      "options": [
        {
          "flags": "--file <path>",
          "description": "Read natural-language input from a file",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--priority <priority>",
          "description": "Default priority for parsed tasks",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID for applied tasks",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID for applied tasks",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--reference-date <iso>",
          "description": "Reference date for due today/tomorrow/next week",
          "longFlag": "--reference-date",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Create parsed tasks; default is dry-run preview",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "inbox",
        "list"
      ],
      "command": "inbox list",
      "description": "List local inbox items",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--status <status>",
          "description": "new, triaged, or ignored",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--source-type <type>",
          "description": "Filter by source type",
          "longFlag": "--source-type",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max rows",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "inbox",
        "show"
      ],
      "command": "inbox show",
      "description": "Show one inbox item",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "report-failure"
      ],
      "command": "report-failure",
      "description": "Create a task from a test/build/typecheck failure and auto-assign it",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--error <message>",
          "description": "Error message or summary",
          "longFlag": "--error",
          "shortFlag": null
        },
        {
          "flags": "--type <type>",
          "description": "Failure type: test, build, typecheck, runtime, other",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--file <path>",
          "description": "File where failure occurred",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--stack <trace>",
          "description": "Stack trace or detailed output",
          "longFlag": "--stack",
          "shortFlag": null
        },
        {
          "flags": "--title <title>",
          "description": "Custom task title (auto-generated if omitted)",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--priority <p>",
          "description": "Priority: low, medium, high, critical",
          "longFlag": "--priority",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "hooks"
      ],
      "command": "hooks",
      "description": "Manage Claude Code hook integration",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "hooks",
        "install"
      ],
      "command": "hooks install",
      "description": "Install Claude Code hooks for auto-sync",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "mcp"
      ],
      "command": "mcp",
      "description": "Start MCP server (stdio)",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--register <agent>",
          "description": "Register MCP server with an agent (claude, codex, gemini, all)",
          "longFlag": "--register",
          "shortFlag": null
        },
        {
          "flags": "--unregister <agent>",
          "description": "Unregister MCP server from an agent (claude, codex, gemini, all)",
          "longFlag": "--unregister",
          "shortFlag": null
        },
        {
          "flags": "-g, --global",
          "description": "Register/unregister globally (user-level) instead of project-level",
          "longFlag": "--global",
          "shortFlag": "-g"
        }
      ]
    },
    {
      "path": [
        "import"
      ],
      "command": "import",
      "description": "Import a GitHub issue as a task",
      "aliases": [],
      "usage": "[options] <url>",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID",
          "longFlag": "--list",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "link-commit"
      ],
      "command": "link-commit",
      "description": "Link a git commit to a task",
      "aliases": [],
      "usage": "[options] <task-id> <sha>",
      "options": [
        {
          "flags": "--message <text>",
          "description": "Commit message",
          "longFlag": "--message",
          "shortFlag": null
        },
        {
          "flags": "--author <name>",
          "description": "Commit author",
          "longFlag": "--author",
          "shortFlag": null
        },
        {
          "flags": "--files <list>",
          "description": "Comma-separated list of changed files",
          "longFlag": "--files",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "find-commit"
      ],
      "command": "find-commit",
      "description": "Find which task explains a git commit SHA",
      "aliases": [],
      "usage": "[options] <sha>",
      "options": []
    },
    {
      "path": [
        "link-ref"
      ],
      "command": "link-ref",
      "description": "Link a git branch or pull request to a task",
      "aliases": [],
      "usage": "[options] <task-id> <ref>",
      "options": [
        {
          "flags": "--type <type>",
          "description": "Ref type: branch or pull_request",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--url <url>",
          "description": "Remote URL for the branch or pull request",
          "longFlag": "--url",
          "shortFlag": null
        },
        {
          "flags": "--provider <name>",
          "description": "Provider name, e.g. git or github",
          "longFlag": "--provider",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional JSON metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "find-ref"
      ],
      "command": "find-ref",
      "description": "Find tasks linked to a git branch or pull request",
      "aliases": [],
      "usage": "[options] <ref>",
      "options": []
    },
    {
      "path": [
        "branch-plan"
      ],
      "command": "branch-plan",
      "description": "Create a local branch-safe work plan from task or plan files",
      "aliases": [],
      "usage": "[options] [task-id]",
      "options": [
        {
          "flags": "--branch <name>",
          "description": "Branch name to plan",
          "longFlag": "--branch",
          "shortFlag": null
        },
        {
          "flags": "--base <name>",
          "description": "Base branch",
          "longFlag": "--base",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan ID scope instead of a single task",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--path <list>",
          "description": "Comma-separated extra paths expected for this branch",
          "longFlag": "--path",
          "shortFlag": null
        },
        {
          "flags": "--root <path>",
          "description": "Git root to inspect (defaults to the current directory at execution)",
          "longFlag": "--root",
          "shortFlag": null
        },
        {
          "flags": "--no-git-status",
          "description": "Skip local git status checks",
          "longFlag": "--no-git-status",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "record-verification"
      ],
      "command": "record-verification",
      "description": "Record a verification command and result for a task",
      "aliases": [],
      "usage": "[options] <task-id> <command>",
      "options": [
        {
          "flags": "--status <status>",
          "description": "Verification status: passed, failed, or unknown",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Short output summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--artifact <path>",
          "description": "Artifact or log path",
          "longFlag": "--artifact",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent that ran the command",
          "longFlag": "--agent",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "trace"
      ],
      "command": "trace",
      "description": "Show local git refs, commits, changed files, and verification commands for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": []
    },
    {
      "path": [
        "contracts"
      ],
      "command": "contracts",
      "description": "Manage local task contracts, acceptance criteria, and review gates",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "contracts",
        "set"
      ],
      "command": "contracts set",
      "description": "Set acceptance criteria, required verification, artifacts, files, risk, and done definition",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--criteria <items>",
          "description": "Semicolon-separated acceptance criteria",
          "longFlag": "--criteria",
          "shortFlag": null
        },
        {
          "flags": "--verify <items>",
          "description": "Semicolon-separated required verification commands",
          "longFlag": "--verify",
          "shortFlag": null
        },
        {
          "flags": "--artifact <items>",
          "description": "Comma-separated expected artifact paths",
          "longFlag": "--artifact",
          "shortFlag": null
        },
        {
          "flags": "--file <items>",
          "description": "Comma-separated relevant file paths",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--risk <level>",
          "description": "Risk level: low, medium, high, or critical",
          "longFlag": "--risk",
          "shortFlag": null
        },
        {
          "flags": "--done <items>",
          "description": "Semicolon-separated done-definition checklist items",
          "longFlag": "--done",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "contracts",
        "show"
      ],
      "command": "contracts show",
      "description": "Show the local task contract and review state",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": []
    },
    {
      "path": [
        "contracts",
        "request-review"
      ],
      "command": "contracts request-review",
      "description": "Request local review for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--requester <name>",
          "description": "Requester agent",
          "longFlag": "--requester",
          "shortFlag": null
        },
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer agent or human",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--notes <text>",
          "description": "Review notes",
          "longFlag": "--notes",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "contracts",
        "review"
      ],
      "command": "contracts review",
      "description": "Record local review approval, requested changes, or reopen state",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--state <state>",
          "description": "approved, changes_requested, or reopened",
          "longFlag": "--state",
          "shortFlag": null
        },
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer agent or human",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--notes <text>",
          "description": "Review notes",
          "longFlag": "--notes",
          "shortFlag": null
        },
        {
          "flags": "--changes <items>",
          "description": "Semicolon-separated requested changes",
          "longFlag": "--changes",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "contracts",
        "check"
      ],
      "command": "contracts check",
      "description": "Check whether local task evidence satisfies the task contract",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": []
    },
    {
      "path": [
        "verify-providers"
      ],
      "command": "verify-providers",
      "description": "Manage optional local verification provider adapters",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "verify-providers",
        "set"
      ],
      "command": "verify-providers set",
      "description": "Create or update a local verification provider",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--kind <kind>",
          "description": "command, testbox, ci_log, browser, or script",
          "longFlag": "--kind",
          "shortFlag": null
        },
        {
          "flags": "--command <command>",
          "description": "Local command template. Supports {task_id}, {agent_id}, {artifact_path}, and {url}",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Command working directory",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--capabilities <items>",
          "description": "Comma-separated capability labels",
          "longFlag": "--capabilities",
          "shortFlag": null
        },
        {
          "flags": "--attempts <n>",
          "description": "Retry attempts",
          "longFlag": "--attempts",
          "shortFlag": null
        },
        {
          "flags": "--backoff-ms <n>",
          "description": "Retry backoff in milliseconds",
          "longFlag": "--backoff-ms",
          "shortFlag": null
        },
        {
          "flags": "--timeout-ms <n>",
          "description": "Command timeout in milliseconds",
          "longFlag": "--timeout-ms",
          "shortFlag": null
        },
        {
          "flags": "--env <json>",
          "description": "Static provider environment as a JSON object",
          "longFlag": "--env",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "verify-providers",
        "list"
      ],
      "command": "verify-providers list",
      "description": "List local verification providers",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "verify-providers",
        "capabilities"
      ],
      "command": "verify-providers capabilities",
      "description": "Show local verification provider capabilities",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "verify-providers",
        "remove"
      ],
      "command": "verify-providers remove",
      "description": "Remove a local verification provider",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "verify-providers",
        "run"
      ],
      "command": "verify-providers run",
      "description": "Run a local verification provider and optionally record task evidence",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--task <id>",
          "description": "Task ID to record verification evidence against",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent running the provider",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--command <command>",
          "description": "Override provider command for this run",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Command working directory",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--log <text>",
          "description": "CI log text to classify",
          "longFlag": "--log",
          "shortFlag": null
        },
        {
          "flags": "--log-file <path>",
          "description": "CI log file to classify",
          "longFlag": "--log-file",
          "shortFlag": null
        },
        {
          "flags": "--artifact <path>",
          "description": "Local artifact or screenshot path",
          "longFlag": "--artifact",
          "shortFlag": null
        },
        {
          "flags": "--url <url>",
          "description": "Browser URL label",
          "longFlag": "--url",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional run metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs"
      ],
      "command": "runs",
      "description": "Manage the local run ledger and evidence capture",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "runs",
        "begin"
      ],
      "command": "runs begin",
      "description": "Preview or apply an idempotent loop run transaction",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--key <key>",
          "description": "Stable idempotency key for this loop transaction",
          "longFlag": "--key",
          "shortFlag": null
        },
        {
          "flags": "--loop-id <id>",
          "description": "Loop identifier; used as the key when --key/--loop-run-id are omitted",
          "longFlag": "--loop-id",
          "shortFlag": null
        },
        {
          "flags": "--loop-run-id <id>",
          "description": "Loop run identifier; used as the key when --key is omitted",
          "longFlag": "--loop-run-id",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent starting the run",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Run title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Run summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional JSON metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--claim",
          "description": "Claim/start the task for the agent before recording the run",
          "longFlag": "--claim",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Apply the transaction; omitted means dry-run",
          "longFlag": "--apply",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs",
        "start"
      ],
      "command": "runs start",
      "description": "Start a local run ledger entry for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--agent <name>",
          "description": "Agent starting the run",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Run title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Run summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional JSON metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--claim",
          "description": "Claim/start the task for the agent before recording the run",
          "longFlag": "--claim",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs",
        "list"
      ],
      "command": "runs list",
      "description": "List local run ledger entries",
      "aliases": [],
      "usage": "[options] [task-id]",
      "options": []
    },
    {
      "path": [
        "runs",
        "show"
      ],
      "command": "runs show",
      "description": "Show a run ledger with events, commands, files, and artifacts",
      "aliases": [],
      "usage": "[options] <run-id>",
      "options": []
    },
    {
      "path": [
        "runs",
        "simulate"
      ],
      "command": "runs simulate",
      "description": "Dry-run replay a recorded context pack or run fixture without mutating local state",
      "aliases": [],
      "usage": "[options] <fixture>",
      "options": [
        {
          "flags": "--agent <name>",
          "description": "Agent identity to include in the simulation",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--scenario <name>",
          "description": "Scenario label for the deterministic replay",
          "longFlag": "--scenario",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "Output format: json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs",
        "event"
      ],
      "command": "runs event",
      "description": "Record a progress, comment, claim, or generic run event",
      "aliases": [],
      "usage": "[options] <run-id> <type> [message]",
      "options": [
        {
          "flags": "--agent <name>",
          "description": "Agent recording the event",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--data <json>",
          "description": "Additional JSON event data",
          "longFlag": "--data",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs",
        "command"
      ],
      "command": "runs command",
      "description": "Record command/test evidence for a run",
      "aliases": [],
      "usage": "[options] <run-id> <command>",
      "options": [
        {
          "flags": "--status <status>",
          "description": "Command status: passed, failed, or unknown",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--exit-code <code>",
          "description": "Process exit code",
          "longFlag": "--exit-code",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Short output summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--artifact <path>",
          "description": "Optional local artifact/log path",
          "longFlag": "--artifact",
          "shortFlag": null
        },
        {
          "flags": "--tokens <n>",
          "description": "Token count reported by the agent or model",
          "longFlag": "--tokens",
          "shortFlag": null
        },
        {
          "flags": "--cost-usd <n>",
          "description": "USD cost reported by the agent or model",
          "longFlag": "--cost-usd",
          "shortFlag": null
        },
        {
          "flags": "--duration-ms <n>",
          "description": "Duration in milliseconds reported by the agent or model",
          "longFlag": "--duration-ms",
          "shortFlag": null
        },
        {
          "flags": "--sandbox <name>",
          "description": "Runner sandbox profile to check before recording",
          "longFlag": "--sandbox",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Command working directory for sandbox checks",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--write <list>",
          "description": "Comma-separated write paths for sandbox checks",
          "longFlag": "--write",
          "shortFlag": null
        },
        {
          "flags": "--env <list>",
          "description": "Comma-separated environment keys for sandbox checks",
          "longFlag": "--env",
          "shortFlag": null
        },
        {
          "flags": "--network",
          "description": "Request network access for sandbox checks",
          "longFlag": "--network",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent that ran the command",
          "longFlag": "--agent",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs",
        "file"
      ],
      "command": "runs file",
      "description": "Record a file touched by a run",
      "aliases": [],
      "usage": "[options] <run-id> <path>",
      "options": [
        {
          "flags": "--status <status>",
          "description": "File status: planned, active, modified, reviewed, or removed",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--note <text>",
          "description": "Why the file was touched",
          "longFlag": "--note",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent touching the file",
          "longFlag": "--agent",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs",
        "artifact"
      ],
      "command": "runs artifact",
      "description": "Record a local artifact for a run in the content-addressed store",
      "aliases": [],
      "usage": "[options] <run-id> <path>",
      "options": [
        {
          "flags": "--type <type>",
          "description": "Artifact type, e.g. log, screenshot, report",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Artifact description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--size <bytes>",
          "description": "Size in bytes",
          "longFlag": "--size",
          "shortFlag": null
        },
        {
          "flags": "--sha256 <hash>",
          "description": "SHA-256 checksum",
          "longFlag": "--sha256",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional JSON metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--no-store",
          "description": "Record metadata only and do not copy local content",
          "longFlag": "--no-store",
          "shortFlag": null
        },
        {
          "flags": "--require-file",
          "description": "Fail if the artifact file cannot be stored",
          "longFlag": "--require-file",
          "shortFlag": null
        },
        {
          "flags": "--retention-days <days>",
          "description": "Retention period for stored content metadata",
          "longFlag": "--retention-days",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent adding the artifact",
          "longFlag": "--agent",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "runs",
        "artifact-verify"
      ],
      "command": "runs artifact-verify",
      "description": "Verify locally stored run artifact content against recorded checksums",
      "aliases": [],
      "usage": "[options] <run-id>",
      "options": []
    },
    {
      "path": [
        "runs",
        "finish"
      ],
      "command": "runs finish",
      "description": "Finish a run ledger entry idempotently",
      "aliases": [],
      "usage": "[options] [run-id]",
      "options": [
        {
          "flags": "--key <key>",
          "description": "Resolve run by idempotency key when run-id is omitted",
          "longFlag": "--key",
          "shortFlag": null
        },
        {
          "flags": "--task <task-id>",
          "description": "Task scope for --key lookup",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "completed, failed, or cancelled",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Final summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent finishing the run",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Preview without mutating",
          "longFlag": "--dry-run",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "findings"
      ],
      "command": "findings",
      "description": "Manage local task findings for loop dedupe and resolution",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "findings",
        "upsert"
      ],
      "command": "findings upsert",
      "description": "Preview or apply an idempotent finding upsert",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--task <task-id>",
          "description": "Task ID",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--fingerprint <value>",
          "description": "Stable finding fingerprint",
          "longFlag": "--fingerprint",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Finding title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "low, medium, high, or critical",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "open, resolved, or ignored",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--source <source>",
          "description": "Loop/tool source name",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Bounded finding summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--artifact <path>",
          "description": "Local artifact path/reference; content is not read",
          "longFlag": "--artifact",
          "shortFlag": null
        },
        {
          "flags": "--run <run-id>",
          "description": "Run ledger ID or prefix",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional JSON metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Apply the upsert; omitted means dry-run",
          "longFlag": "--apply",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "findings",
        "resolve-missing"
      ],
      "command": "findings resolve-missing",
      "description": "Resolve open findings absent from the latest loop finding set",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--task <task-id>",
          "description": "Task ID",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--fingerprints <list>",
          "description": "Comma-separated fingerprints still present",
          "longFlag": "--fingerprints",
          "shortFlag": null
        },
        {
          "flags": "--source <source>",
          "description": "Only resolve findings from this source",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--run <run-id>",
          "description": "Run ledger ID or prefix for audit metadata",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "resolved or ignored",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent resolving findings",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--reason <text>",
          "description": "Resolution reason",
          "longFlag": "--reason",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum findings returned",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Apply resolution; omitted means dry-run",
          "longFlag": "--apply",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "findings",
        "list"
      ],
      "command": "findings list",
      "description": "List compact local findings",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--task <task-id>",
          "description": "Filter by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--run <run-id>",
          "description": "Filter by run",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Filter by open, resolved, or ignored",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--source <source>",
          "description": "Filter by source",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum findings returned",
          "longFlag": "--limit",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "agent-runs"
      ],
      "command": "agent-runs",
      "description": "Queue and dispatch local agent runs",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "agent-runs",
        "adapter-set"
      ],
      "command": "agent-runs adapter-set",
      "description": "Create or update a local agent run adapter",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--command <command>",
          "description": "Local command template. Supports {task_id}, {run_id}, and {agent_id}",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--sandbox <name>",
          "description": "Runner sandbox profile to check before launch",
          "longFlag": "--sandbox",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Command working directory",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--env <json>",
          "description": "Static adapter environment as a JSON object",
          "longFlag": "--env",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "agent-runs",
        "adapters"
      ],
      "command": "agent-runs adapters",
      "description": "List local agent run adapters",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "agent-runs",
        "adapter-remove"
      ],
      "command": "agent-runs adapter-remove",
      "description": "Remove a local agent run adapter",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "agent-runs",
        "queue"
      ],
      "command": "agent-runs queue",
      "description": "Queue a local agent run for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--adapter <name>",
          "description": "Configured adapter name",
          "longFlag": "--adapter",
          "shortFlag": null
        },
        {
          "flags": "--command <command>",
          "description": "Custom command template",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--sandbox <name>",
          "description": "Runner sandbox profile",
          "longFlag": "--sandbox",
          "shortFlag": null
        },
        {
          "flags": "--cwd <path>",
          "description": "Command working directory",
          "longFlag": "--cwd",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent identity for the run",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Run title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--summary <text>",
          "description": "Run summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Additional metadata",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--claim",
          "description": "Claim/start the task before queueing",
          "longFlag": "--claim",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "agent-runs",
        "list"
      ],
      "command": "agent-runs list",
      "description": "List queued local agent runs",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "agent-runs",
        "run-next"
      ],
      "command": "agent-runs run-next",
      "description": "Run the next queued local agent dispatch",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--adapter <name>",
          "description": "Only run queue entries for this adapter",
          "longFlag": "--adapter",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Return the command that would run without executing it",
          "longFlag": "--dry-run",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "agent-runs",
        "cancel"
      ],
      "command": "agent-runs cancel",
      "description": "Cancel a queued or running local agent dispatch",
      "aliases": [],
      "usage": "[options] <run-id>",
      "options": []
    },
    {
      "path": [
        "agent-runs",
        "retry"
      ],
      "command": "agent-runs retry",
      "description": "Queue a retry for a previous local agent dispatch",
      "aliases": [],
      "usage": "[options] <run-id>",
      "options": []
    },
    {
      "path": [
        "hook"
      ],
      "command": "hook",
      "description": "Manage git hooks for auto-linking commits to tasks",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "hook",
        "install"
      ],
      "command": "hook install",
      "description": "Install post-commit hook that auto-links commits to tasks",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "hook",
        "uninstall"
      ],
      "command": "hook uninstall",
      "description": "Remove the todos post-commit hook",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "dispatch"
      ],
      "command": "dispatch",
      "description": "Legacy/emergency only: send tasks or task lists to a tmux window after explicit human choice",
      "aliases": [],
      "usage": "[options] [command] <target>",
      "options": [
        {
          "flags": "--tasks <ids>",
          "description": "Comma-separated task IDs to dispatch",
          "longFlag": "--tasks",
          "shortFlag": null
        },
        {
          "flags": "--list <id>",
          "description": "Task list ID or slug to dispatch",
          "longFlag": "--list",
          "shortFlag": null
        },
        {
          "flags": "--filter-status <statuses>",
          "description": "Comma-separated task statuses to include (default: pending)",
          "longFlag": "--filter-status",
          "shortFlag": null
        },
        {
          "flags": "--delay <ms>",
          "description": "Delay in ms between message and Enter (auto-calculated if omitted)",
          "longFlag": "--delay",
          "shortFlag": null
        },
        {
          "flags": "--at <datetime>",
          "description": "ISO datetime to schedule the dispatch",
          "longFlag": "--at",
          "shortFlag": null
        },
        {
          "flags": "--multiple <targets>",
          "description": "Comma-separated list of additional legacy/emergency tmux targets (fan-out)",
          "longFlag": "--multiple",
          "shortFlag": null
        },
        {
          "flags": "--stagger <ms>",
          "description": "Delay between targets when using --multiple (default: 500ms)",
          "longFlag": "--stagger",
          "shortFlag": null
        },
        {
          "flags": "--confirm-busy",
          "description": "Send even if the target tmux pane appears busy",
          "longFlag": "--confirm-busy",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Preview the formatted message without sending",
          "longFlag": "--dry-run",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "dispatch",
        "run"
      ],
      "command": "dispatch run",
      "description": "Fire all pending dispatches that are due now",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--all",
          "description": "Ignore scheduled_at and fire all pending immediately",
          "longFlag": "--all",
          "shortFlag": null
        },
        {
          "flags": "--confirm-busy",
          "description": "Send even if a target tmux pane appears busy",
          "longFlag": "--confirm-busy",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Preview without sending",
          "longFlag": "--dry-run",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "dispatches"
      ],
      "command": "dispatches",
      "description": "List dispatch history",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--status <status>",
          "description": "Filter by status: pending, sent, failed, cancelled",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Max results (default: 20)",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--cancel <id>",
          "description": "Cancel a pending dispatch by ID",
          "longFlag": "--cancel",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "machines"
      ],
      "command": "machines",
      "description": "List registered machines",
      "aliases": [],
      "usage": "[options] [command]",
      "options": [
        {
          "flags": "-a, --all",
          "description": "Include archived machines",
          "longFlag": "--all",
          "shortFlag": "-a"
        }
      ]
    },
    {
      "path": [
        "machines",
        "register"
      ],
      "command": "machines register",
      "description": "Register a machine",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--hostname <host>",
          "description": "OS hostname",
          "longFlag": "--hostname",
          "shortFlag": null
        },
        {
          "flags": "--platform <platform>",
          "description": "OS platform",
          "longFlag": "--platform",
          "shortFlag": null
        },
        {
          "flags": "--ssh <address>",
          "description": "SSH address (e.g. user@host)",
          "longFlag": "--ssh",
          "shortFlag": null
        },
        {
          "flags": "--arch <arch>",
          "description": "Architecture (e.g. linux-arm64)",
          "longFlag": "--arch",
          "shortFlag": null
        },
        {
          "flags": "--tailscale-name <name>",
          "description": "User-provided Tailscale/MagicDNS name",
          "longFlag": "--tailscale-name",
          "shortFlag": null
        },
        {
          "flags": "--tailscale-ip <ip>",
          "description": "User-provided Tailscale IP",
          "longFlag": "--tailscale-ip",
          "shortFlag": null
        },
        {
          "flags": "--lan-address <address>",
          "description": "User-provided LAN address",
          "longFlag": "--lan-address",
          "shortFlag": null
        },
        {
          "flags": "--workspace <path>",
          "description": "Local workspace path for this machine",
          "longFlag": "--workspace",
          "shortFlag": null
        },
        {
          "flags": "--git-root <path>",
          "description": "Local git root for this machine",
          "longFlag": "--git-root",
          "shortFlag": null
        },
        {
          "flags": "--primary",
          "description": "Set as primary machine",
          "longFlag": "--primary",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "machines",
        "heartbeat"
      ],
      "command": "machines heartbeat",
      "description": "Update last-seen and local topology metadata for a machine",
      "aliases": [],
      "usage": "[options] [name]",
      "options": [
        {
          "flags": "--hostname <host>",
          "description": "OS hostname",
          "longFlag": "--hostname",
          "shortFlag": null
        },
        {
          "flags": "--platform <platform>",
          "description": "OS platform",
          "longFlag": "--platform",
          "shortFlag": null
        },
        {
          "flags": "--ssh <address>",
          "description": "SSH address (e.g. user@host)",
          "longFlag": "--ssh",
          "shortFlag": null
        },
        {
          "flags": "--arch <arch>",
          "description": "Architecture (e.g. linux-arm64)",
          "longFlag": "--arch",
          "shortFlag": null
        },
        {
          "flags": "--tailscale-name <name>",
          "description": "User-provided Tailscale/MagicDNS name",
          "longFlag": "--tailscale-name",
          "shortFlag": null
        },
        {
          "flags": "--tailscale-ip <ip>",
          "description": "User-provided Tailscale IP",
          "longFlag": "--tailscale-ip",
          "shortFlag": null
        },
        {
          "flags": "--lan-address <address>",
          "description": "User-provided LAN address",
          "longFlag": "--lan-address",
          "shortFlag": null
        },
        {
          "flags": "--workspace <path>",
          "description": "Local workspace path for this machine",
          "longFlag": "--workspace",
          "shortFlag": null
        },
        {
          "flags": "--git-root <path>",
          "description": "Local git root for this machine",
          "longFlag": "--git-root",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "machines",
        "set-primary"
      ],
      "command": "machines set-primary",
      "description": "Set the primary machine",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "machines",
        "archive"
      ],
      "command": "machines archive",
      "description": "Archive a machine (soft-delete)",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "machines",
        "unarchive"
      ],
      "command": "machines unarchive",
      "description": "Unarchive a machine",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "machines",
        "delete"
      ],
      "command": "machines delete",
      "description": "Delete a machine (hard delete)",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "machines",
        "status"
      ],
      "command": "machines status",
      "description": "Show machine health status",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "machines",
        "topology"
      ],
      "command": "machines topology",
      "description": "Show local machine topology diagnostics",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--stale-minutes <n>",
          "description": "Minutes before a machine is considered stale",
          "longFlag": "--stale-minutes",
          "shortFlag": null
        },
        {
          "flags": "--include-archived",
          "description": "Include archived machines",
          "longFlag": "--include-archived",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "machines",
        "sync"
      ],
      "command": "machines sync",
      "description": "Sync local bridge bundles with remote machine(s) via SSH",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--machine <name>",
          "description": "Specific machine name (default: all with SSH)",
          "longFlag": "--machine",
          "shortFlag": null
        },
        {
          "flags": "--ssh <address>",
          "description": "Ad-hoc SSH address for bootstrap sync without a registered peer",
          "longFlag": "--ssh",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Show what would be synced without importing",
          "longFlag": "--dry-run",
          "shortFlag": null
        },
        {
          "flags": "--push",
          "description": "Also push a local bridge bundle to the remote machine",
          "longFlag": "--push",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "machines",
        "tasks"
      ],
      "command": "machines tasks",
      "description": "List tasks from a remote machine via SSH",
      "aliases": [],
      "usage": "[options] <machine-name>",
      "options": [
        {
          "flags": "--status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "api-keys"
      ],
      "command": "api-keys",
      "description": "Generate, list, and revoke API keys for secured app/API access",
      "aliases": [
        "api-key"
      ],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "api-keys",
        "create"
      ],
      "command": "api-keys create",
      "description": "Generate a new API key. The plaintext key is shown once.",
      "aliases": [
        "generate"
      ],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--expires-at <iso>",
          "description": "Optional ISO timestamp when this key expires",
          "longFlag": "--expires-at",
          "shortFlag": null
        },
        {
          "flags": "--permissions <list>",
          "description": "Comma-separated permissions (default: *)",
          "longFlag": "--permissions",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "api-keys",
        "list"
      ],
      "command": "api-keys list",
      "description": "List API keys without showing plaintext secrets",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--include-revoked",
          "description": "Include revoked keys",
          "longFlag": "--include-revoked",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "api-keys",
        "revoke"
      ],
      "command": "api-keys revoke",
      "description": "Revoke an API key by id or prefix",
      "aliases": [],
      "usage": "[options] <id-or-prefix>",
      "options": []
    },
    {
      "path": [
        "api-keys",
        "verify"
      ],
      "command": "api-keys verify",
      "description": "Verify an API key locally without printing stored hashes",
      "aliases": [],
      "usage": "[options] <key>",
      "options": []
    },
    {
      "path": [
        "env-snapshot"
      ],
      "command": "env-snapshot",
      "description": "Capture and compare local reproducible environment snapshots",
      "aliases": [
        "environment-snapshot"
      ],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "env-snapshot",
        "capture"
      ],
      "command": "env-snapshot capture",
      "description": "Capture runtime, package-manager, git, config hash, and redacted environment metadata",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--root <path>",
          "description": "Project root to inspect",
          "longFlag": "--root",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Attach snapshot evidence to a task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Attach snapshot artifact to a task run",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent name for attached evidence",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--command <command>",
          "description": "Command or verification step this snapshot explains",
          "longFlag": "--command",
          "shortFlag": null
        },
        {
          "flags": "--output <path>",
          "description": "Write snapshot JSON to a specific path",
          "longFlag": "--output",
          "shortFlag": null
        },
        {
          "flags": "--include-env-values",
          "description": "Include nonsecret environment values; secret-like keys are still redacted",
          "longFlag": "--include-env-values",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "env-snapshot",
        "compare"
      ],
      "command": "env-snapshot compare",
      "description": "Compare two environment snapshot JSON files",
      "aliases": [],
      "usage": "[options] <left> <right>",
      "options": []
    },
    {
      "path": [
        "knowledge"
      ],
      "command": "knowledge",
      "description": "Manage local project knowledge records, decisions, tradeoffs, and context snapshots",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "knowledge",
        "add"
      ],
      "command": "knowledge add",
      "description": "Add a local knowledge record",
      "aliases": [],
      "usage": "[options] <type> <title>",
      "options": [
        {
          "flags": "--content <text>",
          "description": "Record body or note",
          "longFlag": "--content",
          "shortFlag": null
        },
        {
          "flags": "--decision <text>",
          "description": "Decision outcome",
          "longFlag": "--decision",
          "shortFlag": null
        },
        {
          "flags": "--rationale <text>",
          "description": "Decision rationale",
          "longFlag": "--rationale",
          "shortFlag": null
        },
        {
          "flags": "--alternative <text>",
          "description": "Alternative considered; repeatable",
          "longFlag": "--alternative",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Link to a task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Link to a project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Link to a plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent that authored or owns the record",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Tag; repeatable or comma-separated",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--metadata-json <json>",
          "description": "JSON object metadata",
          "longFlag": "--metadata-json",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "knowledge",
        "snapshot"
      ],
      "command": "knowledge snapshot",
      "description": "Save a local context snapshot and attach it as a knowledge record",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--summary <text>",
          "description": "Snapshot summary",
          "longFlag": "--summary",
          "shortFlag": null
        },
        {
          "flags": "--title <text>",
          "description": "Knowledge record title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--snapshot-type <type>",
          "description": "Snapshot type: interrupt, complete, handoff, checkpoint",
          "longFlag": "--snapshot-type",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Link to a task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Link to a project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent that produced the snapshot",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--file <path>",
          "description": "Open or relevant file; repeatable",
          "longFlag": "--file",
          "shortFlag": null
        },
        {
          "flags": "--attempt <text>",
          "description": "Attempt summary; repeatable",
          "longFlag": "--attempt",
          "shortFlag": null
        },
        {
          "flags": "--blocker <text>",
          "description": "Blocker summary; repeatable",
          "longFlag": "--blocker",
          "shortFlag": null
        },
        {
          "flags": "--next <text>",
          "description": "Next steps",
          "longFlag": "--next",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Tag; repeatable or comma-separated",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--metadata-json <json>",
          "description": "JSON object metadata",
          "longFlag": "--metadata-json",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "knowledge",
        "list"
      ],
      "command": "knowledge list",
      "description": "List local knowledge records",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--type <type>",
          "description": "Filter by record type",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Filter by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Filter by tag",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum records",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "knowledge",
        "search"
      ],
      "command": "knowledge search",
      "description": "Search local knowledge records",
      "aliases": [],
      "usage": "[options] <query>",
      "options": [
        {
          "flags": "--type <type>",
          "description": "Filter by record type",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Filter by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Filter by tag",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum records",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "knowledge",
        "show"
      ],
      "command": "knowledge show",
      "description": "Show one local knowledge record",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "knowledge",
        "export"
      ],
      "command": "knowledge export",
      "description": "Export local knowledge records as deterministic JSON or Markdown",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--query <text>",
          "description": "Search query before exporting",
          "longFlag": "--query",
          "shortFlag": null
        },
        {
          "flags": "--type <type>",
          "description": "Filter by record type",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Filter by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Filter by tag",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum records",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "risks"
      ],
      "command": "risks",
      "description": "Manage local project and plan risks, and score local plan/project health",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "risks",
        "add"
      ],
      "command": "risks add",
      "description": "Add a local risk register entry",
      "aliases": [],
      "usage": "[options] <title>",
      "options": [
        {
          "flags": "--description <text>",
          "description": "Risk description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Risk status: open, mitigating, resolved, accepted",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "Risk severity: low, medium, high, critical",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--probability <probability>",
          "description": "Risk probability: low, medium, high",
          "longFlag": "--probability",
          "shortFlag": null
        },
        {
          "flags": "--owner <owner>",
          "description": "Risk owner",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--mitigation <text>",
          "description": "Mitigation plan",
          "longFlag": "--mitigation",
          "shortFlag": null
        },
        {
          "flags": "--due <iso>",
          "description": "Risk mitigation due date",
          "longFlag": "--due",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Link to a project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Link to a plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Link to a task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Tag; repeatable or comma-separated",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--metadata-json <json>",
          "description": "JSON object metadata",
          "longFlag": "--metadata-json",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "risks",
        "list"
      ],
      "command": "risks list",
      "description": "List local risk register entries",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "Filter by severity",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--probability <probability>",
          "description": "Filter by probability",
          "longFlag": "--probability",
          "shortFlag": null
        },
        {
          "flags": "--owner <owner>",
          "description": "Filter by owner",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Filter by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Filter by tag",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--include-closed",
          "description": "Include resolved and accepted risks",
          "longFlag": "--include-closed",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum records",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "risks",
        "show"
      ],
      "command": "risks show",
      "description": "Show one local risk",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "risks",
        "update"
      ],
      "command": "risks update",
      "description": "Update a local risk",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--title <title>",
          "description": "New title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Risk description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Risk status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "Risk severity",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--probability <probability>",
          "description": "Risk probability",
          "longFlag": "--probability",
          "shortFlag": null
        },
        {
          "flags": "--owner <owner>",
          "description": "Risk owner",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--mitigation <text>",
          "description": "Mitigation plan",
          "longFlag": "--mitigation",
          "shortFlag": null
        },
        {
          "flags": "--due <iso>",
          "description": "Risk mitigation due date",
          "longFlag": "--due",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Link to a project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Link to a plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Link to a task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Replace tags; repeatable or comma-separated",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--metadata-json <json>",
          "description": "Replace JSON object metadata",
          "longFlag": "--metadata-json",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "risks",
        "close"
      ],
      "command": "risks close",
      "description": "Close a risk as resolved or accepted",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--status <status>",
          "description": "resolved or accepted",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "risks",
        "score"
      ],
      "command": "risks score",
      "description": "Score local health for a plan or project",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--plan <id>",
          "description": "Plan to score",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project to score",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "risks",
        "export"
      ],
      "command": "risks export",
      "description": "Export local risk register entries as deterministic JSON or Markdown",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "Filter by severity",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--probability <probability>",
          "description": "Filter by probability",
          "longFlag": "--probability",
          "shortFlag": null
        },
        {
          "flags": "--owner <owner>",
          "description": "Filter by owner",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Filter by task",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--tag <tag>",
          "description": "Filter by tag",
          "longFlag": "--tag",
          "shortFlag": null
        },
        {
          "flags": "--include-closed",
          "description": "Include resolved and accepted risks",
          "longFlag": "--include-closed",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum records",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "retrospectives"
      ],
      "command": "retrospectives",
      "description": "Generate and store local retrospectives and lessons learned from project or plan evidence",
      "aliases": [
        "retro"
      ],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "retrospectives",
        "create"
      ],
      "command": "retrospectives create",
      "description": "Create a local retrospective report",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--title <title>",
          "description": "Report title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project to summarize",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan to summarize",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent creating the retrospective",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--create-followups",
          "description": "Create suggested local follow-up tasks",
          "longFlag": "--create-followups",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "retrospectives",
        "list"
      ],
      "command": "retrospectives list",
      "description": "List stored local retrospectives",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by creating agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum records",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "retrospectives",
        "show"
      ],
      "command": "retrospectives show",
      "description": "Show one stored local retrospective",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "retrospectives",
        "export"
      ],
      "command": "retrospectives export",
      "description": "Export stored local retrospectives as deterministic JSON or Markdown",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Filter by plan",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Filter by creating agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum records",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "reliability"
      ],
      "command": "reliability",
      "description": "Generate local-only agent reliability scorecards from tasks, runs, verification evidence, locks, retries, and handoffs",
      "aliases": [
        "scorecards"
      ],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "reliability",
        "show"
      ],
      "command": "reliability show",
      "description": "Show one local agent reliability scorecard",
      "aliases": [],
      "usage": "[options] <agent>",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include task and evidence created at or after this timestamp",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--stale-after-hours <hours>",
          "description": "Task locks older than this are considered stale",
          "longFlag": "--stale-after-hours",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "reliability",
        "list"
      ],
      "command": "reliability list",
      "description": "List local agent reliability scorecards",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Filter by agent id or name",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include task and evidence created at or after this timestamp",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--stale-after-hours <hours>",
          "description": "Task locks older than this are considered stale",
          "longFlag": "--stale-after-hours",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum scorecards",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "reliability",
        "export"
      ],
      "command": "reliability export",
      "description": "Export local agent reliability scorecards as deterministic JSON or Markdown",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Filter by agent id or name",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include task and evidence created at or after this timestamp",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--stale-after-hours <hours>",
          "description": "Task locks older than this are considered stale",
          "longFlag": "--stale-after-hours",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum scorecards",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "onboarding"
      ],
      "command": "onboarding",
      "description": "List, show, write, or import bundled local onboarding fixtures",
      "aliases": [
        "demo-fixtures"
      ],
      "usage": "[options]",
      "options": [
        {
          "flags": "--show <name>",
          "description": "Show one fixture bridge bundle as JSON",
          "longFlag": "--show",
          "shortFlag": null
        },
        {
          "flags": "--write <dir>",
          "description": "Write all bundled fixture bridge bundles to a directory",
          "longFlag": "--write",
          "shortFlag": null
        },
        {
          "flags": "--import <name>",
          "description": "Dry-run or apply an onboarding fixture import",
          "longFlag": "--import",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Apply an onboarding fixture import. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--resolve-conflicts",
          "description": "Safely merge existing local tasks while preserving divergent fields",
          "longFlag": "--resolve-conflicts",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "snapshots"
      ],
      "command": "snapshots",
      "description": "List, read, or poll local agent snapshots",
      "aliases": [
        "local-snapshots"
      ],
      "usage": "[options]",
      "options": [
        {
          "flags": "--show <type>",
          "description": "Read one snapshot: projects, tasks, plans, runs, dependencies, events, or evidence",
          "longFlag": "--show",
          "shortFlag": null
        },
        {
          "flags": "--poll",
          "description": "Poll snapshot resources and return only snapshots changed since --since",
          "longFlag": "--poll",
          "shortFlag": null
        },
        {
          "flags": "--types <list>",
          "description": "Comma-separated snapshot types for polling",
          "longFlag": "--types",
          "shortFlag": null
        },
        {
          "flags": "--project-id <id>",
          "description": "Filter snapshots to one local project id",
          "longFlag": "--project-id",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include events or changed snapshots after this cursor",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum items per snapshot",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--markdown",
          "description": "Render the selected snapshot as Markdown",
          "longFlag": "--markdown",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "sdk-fixtures"
      ],
      "command": "sdk-fixtures",
      "description": "List, show, or write local SDK integration fixtures",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--show",
          "description": "Print the full fixture pack JSON",
          "longFlag": "--show",
          "shortFlag": null
        },
        {
          "flags": "--write <dir>",
          "description": "Write fixture pack, bridge fixture, contract snapshots, and example index to a directory",
          "longFlag": "--write",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews"
      ],
      "command": "reviews",
      "description": "Manage local review queues, reviewer claims, returns, approvals, and routing rules",
      "aliases": [
        "review-queue"
      ],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "reviews",
        "list"
      ],
      "command": "reviews list",
      "description": "List local tasks waiting in review queues",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--queue <name>",
          "description": "Filter by review queue",
          "longFlag": "--queue",
          "shortFlag": null
        },
        {
          "flags": "--state <state>",
          "description": "Filter by review state",
          "longFlag": "--state",
          "shortFlag": null
        },
        {
          "flags": "--reviewer <name>",
          "description": "Filter by assigned or claiming reviewer",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--requester <name>",
          "description": "Filter by requester",
          "longFlag": "--requester",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum queue items",
          "longFlag": "--limit",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews",
        "request"
      ],
      "command": "reviews request",
      "description": "Request local review for a task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--requester <name>",
          "description": "Requester agent or human",
          "longFlag": "--requester",
          "shortFlag": null
        },
        {
          "flags": "--reviewer <name>",
          "description": "Preferred reviewer",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--queue <name>",
          "description": "Review queue name",
          "longFlag": "--queue",
          "shortFlag": null
        },
        {
          "flags": "--reason <text>",
          "description": "Reason for review",
          "longFlag": "--reason",
          "shortFlag": null
        },
        {
          "flags": "--notes <text>",
          "description": "Reviewer notes",
          "longFlag": "--notes",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews",
        "claim"
      ],
      "command": "reviews claim",
      "description": "Claim a task from the local review queue",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer claiming the task",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--note <text>",
          "description": "Claim note",
          "longFlag": "--note",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews",
        "approve"
      ],
      "command": "reviews approve",
      "description": "Approve a reviewed task",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer approving the task",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--note <text>",
          "description": "Approval note",
          "longFlag": "--note",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews",
        "return"
      ],
      "command": "reviews return",
      "description": "Return a reviewed task with requested changes",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer returning the task",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--changes <list>",
          "description": "Semicolon- or comma-separated requested changes",
          "longFlag": "--changes",
          "shortFlag": null
        },
        {
          "flags": "--note <text>",
          "description": "Return note",
          "longFlag": "--note",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews",
        "reopen"
      ],
      "command": "reviews reopen",
      "description": "Reopen a reviewed task for another review pass",
      "aliases": [],
      "usage": "[options] <task-id>",
      "options": [
        {
          "flags": "--reviewer <name>",
          "description": "Reviewer reopening the review",
          "longFlag": "--reviewer",
          "shortFlag": null
        },
        {
          "flags": "--note <text>",
          "description": "Reopen note",
          "longFlag": "--note",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews",
        "rules"
      ],
      "command": "reviews rules",
      "description": "Manage local review routing rules",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "reviews",
        "rules",
        "list"
      ],
      "command": "reviews rules list",
      "description": "List local review routing rules",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "reviews",
        "rules",
        "set"
      ],
      "command": "reviews rules set",
      "description": "Create or update a local review routing rule",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--queue <name>",
          "description": "Queue name",
          "longFlag": "--queue",
          "shortFlag": null
        },
        {
          "flags": "--reviewers <list>",
          "description": "Comma-separated reviewer names",
          "longFlag": "--reviewers",
          "shortFlag": null
        },
        {
          "flags": "--tags <list>",
          "description": "Comma-separated task tags matched by this rule",
          "longFlag": "--tags",
          "shortFlag": null
        },
        {
          "flags": "--priorities <list>",
          "description": "Comma-separated priorities matched by this rule",
          "longFlag": "--priorities",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID matched by this rule",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--disable",
          "description": "Disable this rule",
          "longFlag": "--disable",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "reviews",
        "rules",
        "remove"
      ],
      "command": "reviews rules remove",
      "description": "Remove a local review routing rule",
      "aliases": [],
      "usage": "[options] <name>",
      "options": []
    },
    {
      "path": [
        "roadmaps"
      ],
      "command": "roadmaps",
      "description": "Manage local roadmaps, milestones, and release groupings",
      "aliases": [
        "roadmap"
      ],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "roadmaps",
        "create"
      ],
      "command": "roadmaps create",
      "description": "Create a local roadmap",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--description <text>",
          "description": "Description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "planned, active, completed, archived",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--owner <name>",
          "description": "Owner name",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent owner",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--release <name>",
          "description": "Default release label",
          "longFlag": "--release",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "list"
      ],
      "command": "roadmaps list",
      "description": "List local roadmaps",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "Filter by status",
          "longFlag": "--status",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "show"
      ],
      "command": "roadmaps show",
      "description": "Show a roadmap summary",
      "aliases": [],
      "usage": "[options] <roadmap>",
      "options": [
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "update"
      ],
      "command": "roadmaps update",
      "description": "Update a local roadmap",
      "aliases": [],
      "usage": "[options] <roadmap>",
      "options": [
        {
          "flags": "--name <name>",
          "description": "New name",
          "longFlag": "--name",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "planned, active, completed, archived",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--owner <name>",
          "description": "Owner name",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent owner",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--release <name>",
          "description": "Release label",
          "longFlag": "--release",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "delete"
      ],
      "command": "roadmaps delete",
      "description": "Delete a local roadmap and its local milestone/release config",
      "aliases": [],
      "usage": "[options] <roadmap>",
      "options": []
    },
    {
      "path": [
        "roadmaps",
        "milestones"
      ],
      "command": "roadmaps milestones",
      "description": "Manage roadmap milestones",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "roadmaps",
        "milestones",
        "add"
      ],
      "command": "roadmaps milestones add",
      "description": "Add a milestone to a roadmap",
      "aliases": [],
      "usage": "[options] <roadmap> <title>",
      "options": [
        {
          "flags": "--description <text>",
          "description": "Description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--due <iso>",
          "description": "Due date or timestamp",
          "longFlag": "--due",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "planned, active, completed, blocked, archived",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--owner <name>",
          "description": "Owner name",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent owner",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--tasks <list>",
          "description": "Comma-separated task IDs",
          "longFlag": "--tasks",
          "shortFlag": null
        },
        {
          "flags": "--plans <list>",
          "description": "Comma-separated plan IDs",
          "longFlag": "--plans",
          "shortFlag": null
        },
        {
          "flags": "--runs <list>",
          "description": "Comma-separated run IDs",
          "longFlag": "--runs",
          "shortFlag": null
        },
        {
          "flags": "--release <name>",
          "description": "Release label",
          "longFlag": "--release",
          "shortFlag": null
        },
        {
          "flags": "--tags <list>",
          "description": "Comma-separated tags",
          "longFlag": "--tags",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "milestones",
        "update"
      ],
      "command": "roadmaps milestones update",
      "description": "Update a roadmap milestone",
      "aliases": [],
      "usage": "[options] <milestone>",
      "options": [
        {
          "flags": "--title <title>",
          "description": "Title",
          "longFlag": "--title",
          "shortFlag": null
        },
        {
          "flags": "--description <text>",
          "description": "Description",
          "longFlag": "--description",
          "shortFlag": null
        },
        {
          "flags": "--due <iso>",
          "description": "Due date or timestamp",
          "longFlag": "--due",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "planned, active, completed, blocked, archived",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--owner <name>",
          "description": "Owner name",
          "longFlag": "--owner",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Agent owner",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--tasks <list>",
          "description": "Comma-separated task IDs",
          "longFlag": "--tasks",
          "shortFlag": null
        },
        {
          "flags": "--plans <list>",
          "description": "Comma-separated plan IDs",
          "longFlag": "--plans",
          "shortFlag": null
        },
        {
          "flags": "--runs <list>",
          "description": "Comma-separated run IDs",
          "longFlag": "--runs",
          "shortFlag": null
        },
        {
          "flags": "--release <name>",
          "description": "Release label",
          "longFlag": "--release",
          "shortFlag": null
        },
        {
          "flags": "--tags <list>",
          "description": "Comma-separated tags",
          "longFlag": "--tags",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "releases"
      ],
      "command": "roadmaps releases",
      "description": "Manage roadmap release groups",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "roadmaps",
        "releases",
        "set"
      ],
      "command": "roadmaps releases set",
      "description": "Create or update a release grouping",
      "aliases": [],
      "usage": "[options] <roadmap> <name>",
      "options": [
        {
          "flags": "--release-version <version>",
          "description": "Version label",
          "longFlag": "--release-version",
          "shortFlag": null
        },
        {
          "flags": "--status <status>",
          "description": "planned, active, completed, blocked, archived",
          "longFlag": "--status",
          "shortFlag": null
        },
        {
          "flags": "--milestones <list>",
          "description": "Comma-separated milestone IDs",
          "longFlag": "--milestones",
          "shortFlag": null
        },
        {
          "flags": "--tasks <list>",
          "description": "Comma-separated task IDs",
          "longFlag": "--tasks",
          "shortFlag": null
        },
        {
          "flags": "--plans <list>",
          "description": "Comma-separated plan IDs",
          "longFlag": "--plans",
          "shortFlag": null
        },
        {
          "flags": "--runs <list>",
          "description": "Comma-separated run IDs",
          "longFlag": "--runs",
          "shortFlag": null
        },
        {
          "flags": "--notes <text>",
          "description": "Release notes",
          "longFlag": "--notes",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "export"
      ],
      "command": "roadmaps export",
      "description": "Export a roadmap as JSON bundle or Markdown",
      "aliases": [],
      "usage": "[options] <roadmap>",
      "options": [
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "--out <path>",
          "description": "Write output to a file",
          "longFlag": "--out",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "roadmaps",
        "import"
      ],
      "command": "roadmaps import",
      "description": "Preview or apply a roadmap JSON bundle",
      "aliases": [],
      "usage": "[options] <path>",
      "options": [
        {
          "flags": "--apply",
          "description": "Apply the import",
          "longFlag": "--apply",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "capacity"
      ],
      "command": "capacity",
      "description": "Manage local capacity profiles and planning forecasts",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "capacity",
        "set"
      ],
      "command": "capacity set",
      "description": "Create or update a local agent capacity profile",
      "aliases": [],
      "usage": "[options] <agent>",
      "options": [
        {
          "flags": "--minutes-per-day <minutes>",
          "description": "Available minutes per working day",
          "longFlag": "--minutes-per-day",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--days <list>",
          "description": "Working days as 0-6, where 0 is Sunday",
          "longFlag": "--days",
          "shortFlag": null
        },
        {
          "flags": "--from <date>",
          "description": "Effective date",
          "longFlag": "--from",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "capacity",
        "list"
      ],
      "command": "capacity list",
      "description": "List local capacity profiles",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--agent <id>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "capacity",
        "remove"
      ],
      "command": "capacity remove",
      "description": "Remove a local capacity profile",
      "aliases": [],
      "usage": "[options] <agent-or-id>",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project ID for agent-scoped removal",
          "longFlag": "--project",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "capacity",
        "forecast"
      ],
      "command": "capacity forecast",
      "description": "Forecast local plan or project completion from estimates and capacity",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--plan <id>",
          "description": "Plan ID",
          "longFlag": "--plan",
          "shortFlag": null
        },
        {
          "flags": "--agent <id>",
          "description": "Agent filter",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--start-date <date>",
          "description": "Forecast start date",
          "longFlag": "--start-date",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "audit-ledger"
      ],
      "command": "audit-ledger",
      "description": "Create and verify tamper-evident local audit ledger checkpoints",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "audit-ledger",
        "show"
      ],
      "command": "audit-ledger show",
      "description": "Build a local audit hash chain from current evidence",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task ID",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Run ID",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--entries",
          "description": "Include per-entry hashes and redacted payloads",
          "longFlag": "--entries",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "audit-ledger",
        "seal"
      ],
      "command": "audit-ledger seal",
      "description": "Store a local audit ledger checkpoint for later verification",
      "aliases": [],
      "usage": "[options] <name>",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Project ID",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--task <id>",
          "description": "Task ID",
          "longFlag": "--task",
          "shortFlag": null
        },
        {
          "flags": "--run <id>",
          "description": "Run ID",
          "longFlag": "--run",
          "shortFlag": null
        },
        {
          "flags": "--note <text>",
          "description": "Checkpoint note",
          "longFlag": "--note",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "audit-ledger",
        "list"
      ],
      "command": "audit-ledger list",
      "description": "List local audit ledger checkpoints",
      "aliases": [],
      "usage": "[options]",
      "options": []
    },
    {
      "path": [
        "audit-ledger",
        "verify"
      ],
      "command": "audit-ledger verify",
      "description": "Verify current local evidence against a sealed checkpoint",
      "aliases": [],
      "usage": "[options] <checkpoint>",
      "options": [
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "release-compat"
      ],
      "command": "release-compat",
      "description": "Check local release compatibility, migrations, exports, and Bun install guidance",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "release-compat",
        "check"
      ],
      "command": "release-compat check",
      "description": "Build a local release compatibility report",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--root <path>",
          "description": "Package root (defaults to the current directory at execution)",
          "longFlag": "--root",
          "shortFlag": null
        },
        {
          "flags": "--levels <csv>",
          "description": "Comma-separated migration levels to simulate",
          "longFlag": "--levels",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "usage"
      ],
      "command": "usage",
      "description": "Report local task, run, command, cost, duration, storage, and quota usage",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "usage",
        "report"
      ],
      "command": "usage report",
      "description": "Build an aggregate local usage ledger",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project <id>",
          "description": "Filter by project",
          "longFlag": "--project",
          "shortFlag": null
        },
        {
          "flags": "--agent <name>",
          "description": "Filter by agent",
          "longFlag": "--agent",
          "shortFlag": null
        },
        {
          "flags": "--since <iso>",
          "description": "Only include records created or started at or after this timestamp",
          "longFlag": "--since",
          "shortFlag": null
        },
        {
          "flags": "--until <iso>",
          "description": "Only include records created or started at or before this timestamp",
          "longFlag": "--until",
          "shortFlag": null
        },
        {
          "flags": "--max-tasks <n>",
          "description": "Simulate a task quota",
          "longFlag": "--max-tasks",
          "shortFlag": null
        },
        {
          "flags": "--max-projects <n>",
          "description": "Simulate a project quota",
          "longFlag": "--max-projects",
          "shortFlag": null
        },
        {
          "flags": "--max-runs <n>",
          "description": "Simulate a run quota",
          "longFlag": "--max-runs",
          "shortFlag": null
        },
        {
          "flags": "--max-commands <n>",
          "description": "Simulate a command quota",
          "longFlag": "--max-commands",
          "shortFlag": null
        },
        {
          "flags": "--max-tokens <n>",
          "description": "Simulate a token quota",
          "longFlag": "--max-tokens",
          "shortFlag": null
        },
        {
          "flags": "--max-cost-usd <n>",
          "description": "Simulate a USD cost quota",
          "longFlag": "--max-cost-usd",
          "shortFlag": null
        },
        {
          "flags": "--max-storage-bytes <n>",
          "description": "Simulate an evidence storage quota",
          "longFlag": "--max-storage-bytes",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "backup"
      ],
      "command": "backup",
      "description": "Create, verify, restore, and inspect local backup bundles",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "backup",
        "create"
      ],
      "command": "backup create",
      "description": "Create a local backup bundle with a manifest and checksums",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-o, --output <path>",
          "description": "Write backup JSON to a file",
          "longFlag": "--output",
          "shortFlag": "-o"
        },
        {
          "flags": "--project-id <id>",
          "description": "Project id to scope the backup. Defaults to auto-detected project when available.",
          "longFlag": "--project-id",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "backup",
        "verify"
      ],
      "command": "backup verify",
      "description": "Verify a local backup bundle checksum, manifest, bridge schema, and current SQLite integrity",
      "aliases": [],
      "usage": "[options] <file>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "backup",
        "restore"
      ],
      "command": "backup restore",
      "description": "Dry-run or apply a local backup restore. Dry-run is the default.",
      "aliases": [],
      "usage": "[options] <file>",
      "options": [
        {
          "flags": "--apply",
          "description": "Apply the restore. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--resolve-conflicts",
          "description": "Safely merge existing local tasks while preserving divergent fields",
          "longFlag": "--resolve-conflicts",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "backup",
        "integrity"
      ],
      "command": "backup integrity",
      "description": "Check local SQLite, bridge, count, and orphan-row integrity",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--project-id <id>",
          "description": "Optional project id to scope bridge counts",
          "longFlag": "--project-id",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "storage"
      ],
      "command": "storage",
      "description": "Inspect local storage and Stage B configured intent; remote runtime stays disabled in Stage A",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "storage",
        "status"
      ],
      "command": "storage status",
      "description": "Show redacted local status and configured remote intent; remote_enabled remains false in Stage A",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "storage",
        "sync-plan"
      ],
      "command": "storage sync-plan",
      "description": "Show a no-network Stage B-deferred sync design; it never enables or runs remote sync",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--schema-sql",
          "description": "Include Postgres schema SQL in the dry-run output",
          "longFlag": "--schema-sql",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "storage",
        "shadow-status"
      ],
      "command": "storage shadow-status",
      "description": "Stage B deferred: remote shadow status is unavailable while Stage A authority is disabled",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "storage",
        "shadow-drain"
      ],
      "command": "storage shadow-drain",
      "description": "Stage B deferred: remote shadow drain is unavailable while Stage A authority is disabled",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        },
        {
          "flags": "--timeout <ms>",
          "description": "Max drain time in milliseconds",
          "longFlag": "--timeout",
          "shortFlag": null
        }
      ]
    },
    {
      "path": [
        "storage",
        "artifacts"
      ],
      "command": "storage artifacts",
      "description": "Stage B-deferred S3 artifact design; apply is denied in Stage A",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "storage",
        "artifacts",
        "upload"
      ],
      "command": "storage artifacts upload",
      "description": "Preview Stage B-deferred uploads locally; --apply is denied in Stage A",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--run-id <id>",
          "description": "Limit to one run id",
          "longFlag": "--run-id",
          "shortFlag": null
        },
        {
          "flags": "--task-id <id>",
          "description": "Limit to one task id",
          "longFlag": "--task-id",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum artifacts to scan",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--include-already-synced",
          "description": "Include artifacts that already have a remote reference",
          "longFlag": "--include-already-synced",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Perform S3 uploads. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "storage",
        "artifacts",
        "download"
      ],
      "command": "storage artifacts download",
      "description": "Preview Stage B-deferred downloads locally; --apply is denied in Stage A",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--run-id <id>",
          "description": "Limit to one run id",
          "longFlag": "--run-id",
          "shortFlag": null
        },
        {
          "flags": "--task-id <id>",
          "description": "Limit to one task id",
          "longFlag": "--task-id",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Maximum artifacts to scan",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "--force",
          "description": "Download even when local stored content already verifies",
          "longFlag": "--force",
          "shortFlag": null
        },
        {
          "flags": "--apply",
          "description": "Perform S3 downloads. Defaults to dry-run.",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "scale"
      ],
      "command": "scale",
      "description": "Benchmark local performance, archive readiness, compaction, and SQLite integrity",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "scale",
        "report"
      ],
      "command": "scale report",
      "description": "Build a local scale hardening report without network access",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--older-than-days <days>",
          "description": "Archive-readiness window for terminal tasks",
          "longFlag": "--older-than-days",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "scale",
        "compact"
      ],
      "command": "scale compact",
      "description": "Preview or apply local SQLite optimization and VACUUM compaction",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--apply",
          "description": "Run PRAGMA optimize and VACUUM; dry-run by default",
          "longFlag": "--apply",
          "shortFlag": null
        },
        {
          "flags": "--format <format>",
          "description": "json or markdown",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "webhooks"
      ],
      "command": "webhooks",
      "description": "Manage Hasna event webhook subscriptions",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "webhooks",
        "add"
      ],
      "command": "webhooks add",
      "description": "Add or replace a webhook or command subscription",
      "aliases": [],
      "usage": "[options] <target>",
      "options": [
        {
          "flags": "--id <id>",
          "description": "Subscription/channel identifier",
          "longFlag": "--id",
          "shortFlag": null
        },
        {
          "flags": "--transport <kind>",
          "description": "Transport kind: webhook or command",
          "longFlag": "--transport",
          "shortFlag": null
        },
        {
          "flags": "--name <name>",
          "description": "Display name",
          "longFlag": "--name",
          "shortFlag": null
        },
        {
          "flags": "--type <pattern>",
          "description": "Event type filter, e.g. todos.task.*",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--source <pattern>",
          "description": "Event source filter",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--subject <pattern>",
          "description": "Event subject filter",
          "longFlag": "--subject",
          "shortFlag": null
        },
        {
          "flags": "--severity <pattern>",
          "description": "Event severity filter",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--data <path=value...>",
          "description": "Event data field filter; string values, path!=value negatives, array-member matching, dot paths, * segment wildcard, ** recursive wildcard",
          "longFlag": "--data",
          "shortFlag": null
        },
        {
          "flags": "--metadata <path=value...>",
          "description": "Event metadata field filter; string values, path!=value negatives, array-member matching, dot paths, * segment wildcard, ** recursive wildcard",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--data-json <path=json...>",
          "description": "Event data field filter with typed JSON value; path!=json negatives supported",
          "longFlag": "--data-json",
          "shortFlag": null
        },
        {
          "flags": "--metadata-json <path=json...>",
          "description": "Event metadata field filter with typed JSON value; path!=json negatives supported",
          "longFlag": "--metadata-json",
          "shortFlag": null
        },
        {
          "flags": "--secret <secret>",
          "description": "Webhook HMAC secret",
          "longFlag": "--secret",
          "shortFlag": null
        },
        {
          "flags": "--header <name=value...>",
          "description": "Webhook header",
          "longFlag": "--header",
          "shortFlag": null
        },
        {
          "flags": "--arg <arg...>",
          "description": "Command argument",
          "longFlag": "--arg",
          "shortFlag": null
        },
        {
          "flags": "--timeout-ms <ms>",
          "description": "Transport timeout in milliseconds",
          "longFlag": "--timeout-ms",
          "shortFlag": null
        },
        {
          "flags": "--retry-attempts <n>",
          "description": "Maximum delivery attempts",
          "longFlag": "--retry-attempts",
          "shortFlag": null
        },
        {
          "flags": "--retry-backoff-ms <ms>",
          "description": "Initial retry backoff in milliseconds",
          "longFlag": "--retry-backoff-ms",
          "shortFlag": null
        },
        {
          "flags": "--redact <path...>",
          "description": "Event field path to redact before delivery",
          "longFlag": "--redact",
          "shortFlag": null
        },
        {
          "flags": "--disabled",
          "description": "Create channel disabled",
          "longFlag": "--disabled",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "webhooks",
        "list"
      ],
      "command": "webhooks list",
      "description": "List configured subscriptions",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "webhooks",
        "status"
      ],
      "command": "webhooks status",
      "description": "Show events webhook storage status",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "webhooks",
        "remove"
      ],
      "command": "webhooks remove",
      "description": "Remove a subscription",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "webhooks",
        "test"
      ],
      "command": "webhooks test",
      "description": "Send a test event to one subscription",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--source <source>",
          "description": "Event source override",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--type <type>",
          "description": "Event type",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--subject <subject>",
          "description": "Event subject",
          "longFlag": "--subject",
          "shortFlag": null
        },
        {
          "flags": "--message <message>",
          "description": "Event message",
          "longFlag": "--message",
          "shortFlag": null
        },
        {
          "flags": "--data <json>",
          "description": "Event data JSON object",
          "longFlag": "--data",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Event metadata JSON object",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--honor-filters",
          "description": "Skip delivery when the sample event does not match channel filters",
          "longFlag": "--honor-filters",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "webhooks",
        "match"
      ],
      "command": "webhooks match",
      "description": "Check whether a sample event matches one subscription without delivering",
      "aliases": [],
      "usage": "[options] <id>",
      "options": [
        {
          "flags": "--source <source>",
          "description": "Event source override",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--type <type>",
          "description": "Event type",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--subject <subject>",
          "description": "Event subject",
          "longFlag": "--subject",
          "shortFlag": null
        },
        {
          "flags": "--message <message>",
          "description": "Event message",
          "longFlag": "--message",
          "shortFlag": null
        },
        {
          "flags": "--data <json>",
          "description": "Event data JSON object",
          "longFlag": "--data",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Event metadata JSON object",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "events"
      ],
      "command": "events",
      "description": "Emit, list, and replay Hasna events",
      "aliases": [],
      "usage": "[options] [command]",
      "options": []
    },
    {
      "path": [
        "events",
        "emit"
      ],
      "command": "events emit",
      "description": "Emit an event from this app",
      "aliases": [],
      "usage": "[options] <type>",
      "options": [
        {
          "flags": "--source <source>",
          "description": "Event source override",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--subject <subject>",
          "description": "Event subject",
          "longFlag": "--subject",
          "shortFlag": null
        },
        {
          "flags": "--severity <severity>",
          "description": "Event severity",
          "longFlag": "--severity",
          "shortFlag": null
        },
        {
          "flags": "--message <message>",
          "description": "Event message",
          "longFlag": "--message",
          "shortFlag": null
        },
        {
          "flags": "--dedupe-key <key>",
          "description": "Dedupe key",
          "longFlag": "--dedupe-key",
          "shortFlag": null
        },
        {
          "flags": "--data <json>",
          "description": "Event data JSON object",
          "longFlag": "--data",
          "shortFlag": null
        },
        {
          "flags": "--metadata <json>",
          "description": "Event metadata JSON object",
          "longFlag": "--metadata",
          "shortFlag": null
        },
        {
          "flags": "--no-deliver",
          "description": "Record without delivering",
          "longFlag": "--no-deliver",
          "shortFlag": null
        },
        {
          "flags": "--no-dedupe",
          "description": "Allow duplicate id/dedupeKey events",
          "longFlag": "--no-dedupe",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "events",
        "list"
      ],
      "command": "events list",
      "description": "List recorded events",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--source <source>",
          "description": "Filter by source",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--type <type>",
          "description": "Filter by type",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--limit <n>",
          "description": "Limit results",
          "longFlag": "--limit",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "events",
        "replay"
      ],
      "command": "events replay",
      "description": "Replay recorded events",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--id <id>",
          "description": "Replay one event id",
          "longFlag": "--id",
          "shortFlag": null
        },
        {
          "flags": "--source <source>",
          "description": "Filter by source",
          "longFlag": "--source",
          "shortFlag": null
        },
        {
          "flags": "--type <type>",
          "description": "Filter by type",
          "longFlag": "--type",
          "shortFlag": null
        },
        {
          "flags": "--dry-run",
          "description": "Preview without delivery",
          "longFlag": "--dry-run",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Print JSON output",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    },
    {
      "path": [
        "completions"
      ],
      "command": "completions",
      "description": "Generate shell completions for bash, zsh, or fish",
      "aliases": [
        "completion"
      ],
      "usage": "[options] <shell>",
      "options": []
    },
    {
      "path": [
        "manual"
      ],
      "command": "manual",
      "description": "Print the complete local CLI manual",
      "aliases": [],
      "usage": "[options]",
      "options": [
        {
          "flags": "--format <format>",
          "description": "markdown or json",
          "longFlag": "--format",
          "shortFlag": null
        },
        {
          "flags": "-j, --json",
          "description": "Output as JSON",
          "longFlag": "--json",
          "shortFlag": "-j"
        }
      ]
    }
  ]
};
export const TODOS_CLI_ROOT_HELP = "Usage: todos [options] [command]\n\nUniversal task management for AI coding agents\n\nOptions:\n  --project <path>                                   Project path\n  -j, --json                                         Output as JSON\n  --agent <name>                                     Agent name\n  --session <id>                                     Session ID\n  -V, --version                                      output the version number\n  -h, --help                                         display help for command\n\nCommands:\n  add [options] <title>                              Create a new task\n  task                                               Task subcommands for deterministic automation\n  list [options]                                     List tasks\n  count                                              Show task count by status\n  show <id>                                          Show full task details\n  inspect [id]                                       Full orientation for a task — details, description, dependencies, blocker, files, commits, comments. If no ID given, shows current in-progress task for --agent.\n  history <id>                                       Show change history for a task (audit log)\n  update [options] <id>                              Update a task\n  done [options] <id>                                Mark a task as completed\n  approve <id>                                       Approve a task that requires approval\n  start <id>                                         Claim, lock, and start a task\n  lock <id>                                          Acquire exclusive lock on a task\n  unlock <id>                                        Release lock on a task\n  delete <id>                                        Delete a task\n  remove <id>                                        Remove/delete a task (alias for delete)\n  bulk [options] <action> <ids...>                   Bulk operation on multiple tasks (done, start, delete, plan)\n  plans [options]                                    List and manage plans\n  templates [options]                                List and manage task templates\n  template-init|templates-init                       Initialize the bundled local template library\n  template-library|templates-library [options]       List, show, or write the bundled local template library as editable JSON files\n  template-preview|templates-preview [options] <id>  Preview a template without creating tasks — shows resolved titles, deps, and priorities\n  template-export|templates-export <id>              Export a template as JSON to stdout\n  template-import|templates-import [options] [file]  Import a template from a JSON file\n  template-history|templates-history <id>            Show version history of a template\n  project-bootstrap [options] [path]                 Discover a local workspace and initialize project task state\n  comment|log-progress [options] <id> <text>         Add a comment to a task (alias: log-progress, for recording intermediate progress)\n  search [options] <query>                           Search local tasks, or run/save a cross-entity search view\n  views                                              Manage local saved search views\n  deps [options] <id>                                Manage task dependencies\n  projects [options]                                 List and manage projects\n  project-panel [options]                            Emit a contract-valid project dashboard panel for todos\n  project-rename [options] <id-or-slug> <new-slug>   Rename a project slug. Cascades to matching task lists. Task prefixes (e.g. APP-00001) are unchanged.\n  projects-path                                      Manage machine-local path overrides for projects\n  extract [options] <path>                           Extract TODO/FIXME/HACK/BUG/XXX/NOTE comments from source files and create tasks\n  extract-watch [options] <path>                     Poll a local source tree for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks\n  export [options]                                   Export tasks\n  bridge-import [options] <file>                     Dry-run or apply a local hasna/todos bridge export bundle\n  todos-md-import|markdown-import [options] <file>   Dry-run or apply a local todos.md Markdown import\n  sync [options]                                     Sync tasks with an agent task list (Claude uses native task list; others use JSON lists)\n  init [options] <name>                              Register an agents and get a short UUID\n  heartbeat [agent]                                  Update last_seen_at to signal you're still active\n  release [options] [agent]                          Release/logout an agent — clears session binding so the name is immediately available\n  focus [project]                                    Focus on a project (or clear focus if no project given)\n  agents                                             List registered agents\n  agents-normalize|normalize-agents                  Rename invalid/generated agent names (agent, agent-1, name-2, two-word names) to safe one-word names\n  agent-update|agents-update [options] <name>        Update an agent's description, role, or other fields\n  agent [options] <name>                             Show all info about an agent: tasks, status, last seen, stats\n  org [options]                                      Show agent org chart — who reports to who\n  lists|task-lists [options]                         List and manage task lists\n  upgrade|self-update [options]                      Update todos to the latest version\n  config [options]                                   View or update configuration\n  encryption                                         Manage local encryption profiles for fields and secure exports\n  redaction                                          Manage local secret redaction patterns and scans\n  retention                                          Preview or apply local retention cleanup for old comments, runs, verification evidence, and expired artifact files\n  trust                                              Manage local workspace trust and permission profiles\n  sandbox                                            Manage local runner sandbox profiles and dry-run checks\n  extensions                                         Manage local workflow extension registry\n  workflows                                          List and render local guided workflow prompts\n  policies                                           Manage local policy packs for task done gates\n  approvals                                          Manage local approval gates and manual checkpoints\n  event-hooks                                        Manage local event hooks and automation triggers\n  terminal-notifications                             Manage local terminal notification watch rules\n  serve [options]                                    Start the web dashboard\n  watch [options]                                    Live-updating task list (refreshes every few seconds)\n  stream [options]                                   Subscribe to real-time task events via SSE (requires todos serve)\n  interactive                                        Launch interactive TUI\n  blame <file>                                       Show which tasks/agents touched a file and why — combines task_files + task_commits\n  dashboard [options]                                Live-updating dashboard showing project health, agents, task flow\n  references|refs                                    Resolve local file, symbol, git, plan, run, task, and agent references\n  next [options]                                     Show the best pending task to work on next\n  claim [options] <agent>                            Atomically claim the best pending task for an agent\n  steal [options] <agent>                            Work-stealing: take the highest-priority stale task from another agent\n  status [options]                                   Show full project health snapshot\n  recap [options]                                    Show what happened in the last N hours — completed tasks, new tasks, agent activity, blockers\n  standup [options]                                  Generate standup notes — completed since yesterday, in progress, blocked. Grouped by agent.\n  fail [options] <id>                                Mark a task as failed with optional reason and retry\n  active [options]                                   Show all currently in-progress tasks\n  stale [options]                                    Find tasks stuck in_progress with no recent activity\n  redistribute [options] <agent>                     Release stale in-progress tasks and claim the best one (work-stealing)\n  assign [options] <id> <agent>                      Assign a task to an agent\n  unassign [options] <id>                            Remove task assignment\n  tag [options] <id> <tag>                           Add a tag to a task\n  untag [options] <id> <tag>                         Remove a tag from a task\n  pin [options] <id>                                 Escalate task to critical priority\n  summary [options]                                  Generate a markdown summary of recent task activity\n  doctor [options]                                   Diagnose and optionally repair local task data issues\n  health [options]                                   Check todos system health — database, config, connectivity\n  report [options]                                   Analytics report: task activity, completion rates, agent breakdown\n  today [options]                                    Show task activity from today\n  yesterday [options]                                Show task activity from yesterday\n  mine [options] <agent>                             Show tasks assigned to you, grouped by status\n  blocked [options]                                  Show tasks blocked by incomplete dependencies\n  overdue [options]                                  Show tasks past their due date\n  sla [options]                                      Show overdue or SLA-breached tasks that need escalation\n  week [options]                                     Show task activity from the past 7 days\n  burndown [options]                                 Show task completion velocity over the past 7 days\n  log [options]                                      Show recent task activity log (git-log style)\n  timeline [options]                                 Show a unified local activity timeline for tasks, projects, plans, or runs\n  ready [options]                                    Show all tasks ready to be claimed (pending, unblocked, unlocked)\n  sprint [options]                                   Sprint dashboard: in-progress, next up, blockers, and overdue\n  reports                                            Build local agent-native reports from tasks, plans, runs, and verification evidence\n  handoff [options]                                  Create or view agent session handoffs\n  priorities [options]                               Show task counts grouped by priority\n  context [options]                                  Session start context: status, latest handoff, next task, overdue\n  release-notes [options]                            Generate local release notes and changelog output from completed tasks\n  context-pack [options] <task-id>                   Build a deterministic local agent context pack for a task\n  calendar                                           List and export local calendar events\n  notifications                                      Check local due-date, SLA, stale-task, run, and reminder alerts\n  board                                              Render local task and plan kanban boards\n  time                                               Track local task time and focus sessions\n  fields                                             Manage local labels, priority, severity, owner, area, and custom fields\n  workflow                                           Manage local project workflow states\n  dedupe                                             Find and merge likely duplicate local tasks\n  issues                                             Import external issue data into local tasks\n  inbox                                              Capture local inbox items from pasted errors, CI logs, git context, files, or GitHub issue URLs\n  report-failure [options]                           Create a task from a test/build/typecheck failure and auto-assign it\n  hooks                                              Manage Claude Code hook integration\n  mcp [options]                                      Start MCP server (stdio)\n  import [options] <url>                             Import a GitHub issue as a task\n  link-commit [options] <task-id> <sha>              Link a git commit to a task\n  find-commit <sha>                                  Find which task explains a git commit SHA\n  link-ref [options] <task-id> <ref>                 Link a git branch or pull request to a task\n  find-ref <ref>                                     Find tasks linked to a git branch or pull request\n  branch-plan [options] [task-id]                    Create a local branch-safe work plan from task or plan files\n  record-verification [options] <task-id> <command>  Record a verification command and result for a task\n  trace <task-id>                                    Show local git refs, commits, changed files, and verification commands for a task\n  contracts                                          Manage local task contracts, acceptance criteria, and review gates\n  verify-providers                                   Manage optional local verification provider adapters\n  runs                                               Manage the local run ledger and evidence capture\n  findings                                           Manage local task findings for loop dedupe and resolution\n  agent-runs                                         Queue and dispatch local agent runs\n  hook                                               Manage git hooks for auto-linking commits to tasks\n  dispatch [options] <target>                        Legacy/emergency only: send tasks or task lists to a tmux window after explicit human choice\n  dispatches [options]                               List dispatch history\n  machines [options]                                 List registered machines\n  api-keys|api-key                                   Generate, list, and revoke API keys for secured app/API access\n  env-snapshot|environment-snapshot                  Capture and compare local reproducible environment snapshots\n  knowledge                                          Manage local project knowledge records, decisions, tradeoffs, and context snapshots\n  risks                                              Manage local project and plan risks, and score local plan/project health\n  retrospectives|retro                               Generate and store local retrospectives and lessons learned from project or plan evidence\n  reliability|scorecards                             Generate local-only agent reliability scorecards from tasks, runs, verification evidence, locks, retries, and handoffs\n  onboarding|demo-fixtures [options]                 List, show, write, or import bundled local onboarding fixtures\n  snapshots|local-snapshots [options]                List, read, or poll local agent snapshots\n  sdk-fixtures [options]                             List, show, or write local SDK integration fixtures\n  reviews|review-queue                               Manage local review queues, reviewer claims, returns, approvals, and routing rules\n  roadmaps|roadmap                                   Manage local roadmaps, milestones, and release groupings\n  capacity                                           Manage local capacity profiles and planning forecasts\n  audit-ledger                                       Create and verify tamper-evident local audit ledger checkpoints\n  release-compat                                     Check local release compatibility, migrations, exports, and Bun install guidance\n  usage                                              Report local task, run, command, cost, duration, storage, and quota usage\n  backup                                             Create, verify, restore, and inspect local backup bundles\n  storage                                            Inspect local storage and Stage B configured intent; remote runtime stays disabled in Stage A\n  scale                                              Benchmark local performance, archive readiness, compaction, and SQLite integrity\n  webhooks                                           Manage Hasna event webhook subscriptions\n  events                                             Emit, list, and replay Hasna events\n  completions|completion <shell>                     Generate shell completions for bash, zsh, or fish\n  manual [options]                                   Print the complete local CLI manual\n  help [command]                                     display help for command\n";
export const TODOS_CLI_COMPLETIONS: Readonly<Record<"bash" | "zsh" | "fish", string>> = {
  "bash": "# todos bash completion. Generated by `todos completions bash`.\n_todos_completion() {\n  local cur\n  COMPREPLY=()\n  cur=\"${COMP_WORDS[COMP_CWORD]}\"\n  if [[ \"$cur\" == -* ]]; then\n    COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n    return\n  fi\n  case \"${COMP_WORDS[1]}\" in\n    add)\n      COMPREPLY=($(compgen -W '--agent --approval --assign --description --due --estimated --json --list --parent --plan --priority --project --reason --recurrence --session --sla --sla-minutes --status --tag --tags --task-list --version -V -d -j -p -t' -- \"$cur\"))\n      return\n      ;;\n    task)\n      COMPREPLY=($(compgen -W 'upsert route-state workflow-pointers --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    list)\n      COMPREPLY=($(compgen -W '--agent --agent-name --all --assigned --due-today --format --json --limit --list --overdue --priority --project --project-name --recurring --session --sort --status --tag --tags --task-list --version -V -a -j -p -s' -- \"$cur\"))\n      return\n      ;;\n    count)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    show)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    inspect)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    history)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    update)\n      COMPREPLY=($(compgen -W '--agent --approval --assign --clear-approval --clear-list --clear-plan --clear-working-dir --description --due --estimated --json --list --plan --priority --project --recurrence --session --sla --sla-minutes --status --tag --tags --task-list --title --version --working-dir -V -d -j -p -s' -- \"$cur\"))\n      return\n      ;;\n    done)\n      COMPREPLY=($(compgen -W '--agent --attach-ids --commit-hash --confidence --files-changed --json --notes --project --session --test-results --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    approve)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    start)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    lock)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    unlock)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    delete)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    remove)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    bulk)\n      COMPREPLY=($(compgen -W '--agent --clear-plan --json --plan --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    plans)\n      COMPREPLY=($(compgen -W '--add --agent --artifact --complete --delete --description --json --project --session --show --slug --version --write-artifacts -V -d -j' -- \"$cur\"))\n      return\n      ;;\n    templates)\n      COMPREPLY=($(compgen -W '--add --agent --delete --description --json --priority --project --session --tags --title --update --use --var --version -V -d -j -p -t' -- \"$cur\"))\n      return\n      ;;\n    template-init)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    template-library)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --show --version --write -V -j' -- \"$cur\"))\n      return\n      ;;\n    template-preview)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --var --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    template-export)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    template-import)\n      COMPREPLY=($(compgen -W '--agent --file --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    template-history)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    project-bootstrap)\n      COMPREPLY=($(compgen -W '--agent --dry-run --json --name --project --route-enabled --session --task-list --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    comment)\n      COMPREPLY=($(compgen -W '--agent --json --pct --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    search)\n      COMPREPLY=($(compgen -W '--agent --agent-id --all-projects --assigned --blocked --blocks --created-after --depends-on --description --field-area --field-custom --field-label --field-owner --field-severity --filter --has-deps --json --limit --plan --priority --project --save-as --scope --session --since --status --tag --task --task-list --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    views)\n      COMPREPLY=($(compgen -W 'save list run delete --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    deps)\n      COMPREPLY=($(compgen -W '--agent --direction --graph --json --needs --project --remove --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    projects)\n      COMPREPLY=($(compgen -W '--add --agent --deregister --description --dry-run --json --name --path --path-prefix --project --session --show --task-list-id --update --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    project-panel)\n      COMPREPLY=($(compgen -W '--agent --contract --json --limit --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    project-rename)\n      COMPREPLY=($(compgen -W '--agent --json --name --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    projects-path)\n      COMPREPLY=($(compgen -W 'set list remove --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    extract)\n      COMPREPLY=($(compgen -W '--agent --assign --dry-run --exclude --ext --index --json --list --no-gitignore --pattern --project --session --tags --version -V -j -t' -- \"$cur\"))\n      return\n      ;;\n    extract-watch)\n      COMPREPLY=($(compgen -W '--agent --assign --dry-run --exclude --ext --interval --json --list --max-runs --no-gitignore --once --pattern --project --session --tags --version -V -j -t' -- \"$cur\"))\n      return\n      ;;\n    export)\n      COMPREPLY=($(compgen -W '--agent --allow-plaintext-sensitive --encrypt --encryption-profile --format --json --output --project --session --version -V -f -j -o' -- \"$cur\"))\n      return\n      ;;\n    bridge-import)\n      COMPREPLY=($(compgen -W '--agent --apply --decrypt --json --project --resolve-conflicts --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    todos-md-import)\n      COMPREPLY=($(compgen -W '--agent --apply --json --project --resolve-conflicts --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    sync)\n      COMPREPLY=($(compgen -W '--agent --all --json --prefer --project --pull --push --session --task-list --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    init)\n      COMPREPLY=($(compgen -W '--agent --description --json --project --session --version -V -d -j' -- \"$cur\"))\n      return\n      ;;\n    heartbeat)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    release)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --session-id --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    focus)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    agents)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    agents-normalize)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    agent-update)\n      COMPREPLY=($(compgen -W '--agent --description --json --project --role --session --title --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    agent)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    org)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --set --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    lists)\n      COMPREPLY=($(compgen -W '--add --agent --delete --description --json --name --project --session --show --slug --update --version -V -d -j' -- \"$cur\"))\n      return\n      ;;\n    upgrade)\n      COMPREPLY=($(compgen -W '--agent --check --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    config)\n      COMPREPLY=($(compgen -W '--agent --get --json --project --session --set --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    encryption)\n      COMPREPLY=($(compgen -W 'list set status remove test --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    redaction)\n      COMPREPLY=($(compgen -W 'status add scan --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    retention)\n      COMPREPLY=($(compgen -W 'cleanup --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    trust)\n      COMPREPLY=($(compgen -W 'list status add remove check --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    sandbox)\n      COMPREPLY=($(compgen -W 'list set remove check explain --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    extensions)\n      COMPREPLY=($(compgen -W 'list discover inspect install compat verify remove --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    workflows)\n      COMPREPLY=($(compgen -W 'list show export --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    policies)\n      COMPREPLY=($(compgen -W 'list set remove validate explain --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    approvals)\n      COMPREPLY=($(compgen -W 'require approve reject expire check list --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    event-hooks)\n      COMPREPLY=($(compgen -W 'list set remove test --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    terminal-notifications)\n      COMPREPLY=($(compgen -W 'list set remove test --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    serve)\n      COMPREPLY=($(compgen -W '--agent --api-key --host --json --no-open --port --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    watch)\n      COMPREPLY=($(compgen -W '--agent --interval --json --project --session --status --version -V -i -j -s' -- \"$cur\"))\n      return\n      ;;\n    stream)\n      COMPREPLY=($(compgen -W '--agent --events --json --port --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    interactive)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    blame)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    dashboard)\n      COMPREPLY=($(compgen -W '--agent --format --json --limit --project --refresh --search --session --snapshot --version --view -V -j' -- \"$cur\"))\n      return\n      ;;\n    references)\n      COMPREPLY=($(compgen -W 'resolve --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    next)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    claim)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --stale-minutes --steal-stale --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    steal)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --stale-minutes --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    status)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    recap)\n      COMPREPLY=($(compgen -W '--agent --hours --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    standup)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --since --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    fail)\n      COMPREPLY=($(compgen -W '--agent --json --project --reason --retry --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    active)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    stale)\n      COMPREPLY=($(compgen -W '--agent --json --minutes --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    redistribute)\n      COMPREPLY=($(compgen -W '--agent --json --limit --max-age --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    assign)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    unassign)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    tag)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    untag)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    pin)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    summary)\n      COMPREPLY=($(compgen -W '--agent --days --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    doctor)\n      COMPREPLY=($(compgen -W 'routing --agent --apply --fix --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    health)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    report)\n      COMPREPLY=($(compgen -W '--agent --days --json --markdown --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    today)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    yesterday)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    mine)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    blocked)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    overdue)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    sla)\n      COMPREPLY=($(compgen -W '--agent --json --limit --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    week)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    burndown)\n      COMPREPLY=($(compgen -W '--agent --days --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    log)\n      COMPREPLY=($(compgen -W '--agent --json --limit --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    timeline)\n      COMPREPLY=($(compgen -W '--agent --json --limit --offset --order --plan --project --run --session --since --task --until --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    ready)\n      COMPREPLY=($(compgen -W '--agent --exclude --include --json --limit --project --session --source-root --source-store --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    sprint)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    reports)\n      COMPREPLY=($(compgen -W 'local --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    handoff)\n      COMPREPLY=($(compgen -W '--ack --agent --apply --blockers --completed --create --export --files --import --in-progress --json --limit --next --output --project --read --reason --recover --runs --session --summary --tasks --unread-for --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    priorities)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    context)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    release-notes)\n      COMPREPLY=($(compgen -W '--agent --format --json --out --plan --project --session --since --tag --task --title --until --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    context-pack)\n      COMPREPLY=($(compgen -W '--agent --comments --compact --dependencies --exclude --files --format --include --json --max-text --plan-tasks --profile --project --run --runs --session --stale-after-hours --summary-chars --token-budget --verifications --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    calendar)\n      COMPREPLY=($(compgen -W 'list add export import --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    notifications)\n      COMPREPLY=($(compgen -W 'check --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    board)\n      COMPREPLY=($(compgen -W 'create list show tui move export import delete --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    time)\n      COMPREPLY=($(compgen -W 'log start pause resume stop list idle report --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    fields)\n      COMPREPLY=($(compgen -W 'show set query --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    workflow)\n      COMPREPLY=($(compgen -W 'states set tasks migrate --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    dedupe)\n      COMPREPLY=($(compgen -W 'scan merge --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    issues)\n      COMPREPLY=($(compgen -W 'import report --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    inbox)\n      COMPREPLY=($(compgen -W 'add git parse list show --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    report-failure)\n      COMPREPLY=($(compgen -W '--agent --error --file --json --priority --project --session --stack --title --type --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    hooks)\n      COMPREPLY=($(compgen -W 'install --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    mcp)\n      COMPREPLY=($(compgen -W '--agent --global --json --project --register --session --unregister --version -V -g -j' -- \"$cur\"))\n      return\n      ;;\n    import)\n      COMPREPLY=($(compgen -W '--agent --json --list --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    link-commit)\n      COMPREPLY=($(compgen -W '--agent --author --files --json --message --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    find-commit)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    link-ref)\n      COMPREPLY=($(compgen -W '--agent --json --metadata --project --provider --session --type --url --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    find-ref)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    branch-plan)\n      COMPREPLY=($(compgen -W '--agent --base --branch --json --no-git-status --path --plan --project --root --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    record-verification)\n      COMPREPLY=($(compgen -W '--agent --artifact --json --project --session --status --summary --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    trace)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    contracts)\n      COMPREPLY=($(compgen -W 'set show request-review review check --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    verify-providers)\n      COMPREPLY=($(compgen -W 'set list capabilities remove run --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    runs)\n      COMPREPLY=($(compgen -W 'begin start list show simulate event command file artifact artifact-verify finish --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    findings)\n      COMPREPLY=($(compgen -W 'upsert resolve-missing list --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    agent-runs)\n      COMPREPLY=($(compgen -W 'adapter-set adapters adapter-remove queue list run-next cancel retry --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    hook)\n      COMPREPLY=($(compgen -W 'install uninstall --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    dispatch)\n      COMPREPLY=($(compgen -W 'run --agent --at --confirm-busy --delay --dry-run --filter-status --json --list --multiple --project --session --stagger --tasks --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    dispatches)\n      COMPREPLY=($(compgen -W '--agent --cancel --json --limit --project --session --status --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    machines)\n      COMPREPLY=($(compgen -W 'register heartbeat set-primary archive unarchive delete status topology sync tasks --agent --all --json --project --session --version -V -a -j' -- \"$cur\"))\n      return\n      ;;\n    api-keys)\n      COMPREPLY=($(compgen -W 'create list revoke verify --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    env-snapshot)\n      COMPREPLY=($(compgen -W 'capture compare --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    knowledge)\n      COMPREPLY=($(compgen -W 'add snapshot list search show export --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    risks)\n      COMPREPLY=($(compgen -W 'add list show update close score export --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    retrospectives)\n      COMPREPLY=($(compgen -W 'create list show export --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    reliability)\n      COMPREPLY=($(compgen -W 'show list export --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    onboarding)\n      COMPREPLY=($(compgen -W '--agent --apply --import --json --project --resolve-conflicts --session --show --version --write -V -j' -- \"$cur\"))\n      return\n      ;;\n    snapshots)\n      COMPREPLY=($(compgen -W '--agent --json --limit --markdown --poll --project --project-id --session --show --since --types --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    sdk-fixtures)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --show --version --write -V -j' -- \"$cur\"))\n      return\n      ;;\n    reviews)\n      COMPREPLY=($(compgen -W 'list request claim approve return reopen rules --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    roadmaps)\n      COMPREPLY=($(compgen -W 'create list show update delete milestones releases export import --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    capacity)\n      COMPREPLY=($(compgen -W 'set list remove forecast --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    audit-ledger)\n      COMPREPLY=($(compgen -W 'show seal list verify --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    release-compat)\n      COMPREPLY=($(compgen -W 'check --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    usage)\n      COMPREPLY=($(compgen -W 'report --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    backup)\n      COMPREPLY=($(compgen -W 'create verify restore integrity --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    storage)\n      COMPREPLY=($(compgen -W 'status sync-plan shadow-status shadow-drain artifacts --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    scale)\n      COMPREPLY=($(compgen -W 'report compact --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    webhooks)\n      COMPREPLY=($(compgen -W 'add list status remove test match --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    events)\n      COMPREPLY=($(compgen -W 'emit list replay --agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    completions)\n      COMPREPLY=($(compgen -W '--agent --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n    manual)\n      COMPREPLY=($(compgen -W '--agent --format --json --project --session --version -V -j' -- \"$cur\"))\n      return\n      ;;\n  esac\n  COMPREPLY=($(compgen -W 'add task list count show inspect history update done approve start lock unlock delete remove bulk plans templates template-init template-library template-preview template-export template-import template-history project-bootstrap comment search views deps projects project-panel project-rename projects-path extract extract-watch export bridge-import todos-md-import sync init heartbeat release focus agents agents-normalize agent-update agent org lists upgrade config encryption redaction retention trust sandbox extensions workflows policies approvals event-hooks terminal-notifications serve watch stream interactive blame dashboard references next claim steal status recap standup fail active stale redistribute assign unassign tag untag pin summary doctor health report today yesterday mine blocked overdue sla week burndown log timeline ready sprint reports handoff priorities context release-notes context-pack calendar notifications board time fields workflow dedupe issues inbox report-failure hooks mcp import link-commit find-commit link-ref find-ref branch-plan record-verification trace contracts verify-providers runs findings agent-runs hook dispatch dispatches machines api-keys env-snapshot knowledge risks retrospectives reliability onboarding snapshots sdk-fixtures reviews roadmaps capacity audit-ledger release-compat usage backup storage scale webhooks events completions manual' -- \"$cur\"))\n}\ncomplete -F _todos_completion todos\n\n",
  "zsh": "#compdef todos\n# todos zsh completion. Generated by `todos completions zsh`.\n_todos() {\n  local -a commands; commands=('add:Create a new task' 'task:Task subcommands for deterministic automation' 'list:List tasks' 'count:Show task count by status' 'show:Show full task details' 'inspect:Full orientation for a task — details, description, dependencies, blocker, files, commits, comments. If no ID given, shows current in-progress task for --agent.' 'history:Show change history for a task (audit log)' 'update:Update a task' 'done:Mark a task as completed' 'approve:Approve a task that requires approval' 'start:Claim, lock, and start a task' 'lock:Acquire exclusive lock on a task' 'unlock:Release lock on a task' 'delete:Delete a task' 'remove:Remove/delete a task (alias for delete)' 'bulk:Bulk operation on multiple tasks (done, start, delete, plan)' 'plans:List and manage plans' 'templates:List and manage task templates' 'template-init:Initialize the bundled local template library' 'template-library:List, show, or write the bundled local template library as editable JSON files' 'template-preview:Preview a template without creating tasks — shows resolved titles, deps, and priorities' 'template-export:Export a template as JSON to stdout' 'template-import:Import a template from a JSON file' 'template-history:Show version history of a template' 'project-bootstrap:Discover a local workspace and initialize project task state' 'comment:Add a comment to a task (alias: log-progress, for recording intermediate progress)' 'search:Search local tasks, or run/save a cross-entity search view' 'views:Manage local saved search views' 'deps:Manage task dependencies' 'projects:List and manage projects' 'project-panel:Emit a contract-valid project dashboard panel for todos' 'project-rename:Rename a project slug. Cascades to matching task lists. Task prefixes (e.g. APP-00001) are unchanged.' 'projects-path:Manage machine-local path overrides for projects' 'extract:Extract TODO/FIXME/HACK/BUG/XXX/NOTE comments from source files and create tasks' 'extract-watch:Poll a local source tree for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks' 'export:Export tasks' 'bridge-import:Dry-run or apply a local hasna/todos bridge export bundle' 'todos-md-import:Dry-run or apply a local todos.md Markdown import' 'sync:Sync tasks with an agent task list (Claude uses native task list; others use JSON lists)' 'init:Register an agents and get a short UUID' 'heartbeat:Update last_seen_at to signal you'\\''re still active' 'release:Release/logout an agent — clears session binding so the name is immediately available' 'focus:Focus on a project (or clear focus if no project given)' 'agents:List registered agents' 'agents-normalize:Rename invalid/generated agent names (agent, agent-1, name-2, two-word names) to safe one-word names' 'agent-update:Update an agent'\\''s description, role, or other fields' 'agent:Show all info about an agent: tasks, status, last seen, stats' 'org:Show agent org chart — who reports to who' 'lists:List and manage task lists' 'upgrade:Update todos to the latest version' 'config:View or update configuration' 'encryption:Manage local encryption profiles for fields and secure exports' 'redaction:Manage local secret redaction patterns and scans' 'retention:Preview or apply local retention cleanup for old comments, runs, verification evidence, and expired artifact files' 'trust:Manage local workspace trust and permission profiles' 'sandbox:Manage local runner sandbox profiles and dry-run checks' 'extensions:Manage local workflow extension registry' 'workflows:List and render local guided workflow prompts' 'policies:Manage local policy packs for task done gates' 'approvals:Manage local approval gates and manual checkpoints' 'event-hooks:Manage local event hooks and automation triggers' 'terminal-notifications:Manage local terminal notification watch rules' 'serve:Start the web dashboard' 'watch:Live-updating task list (refreshes every few seconds)' 'stream:Subscribe to real-time task events via SSE (requires todos serve)' 'interactive:Launch interactive TUI' 'blame:Show which tasks/agents touched a file and why — combines task_files + task_commits' 'dashboard:Live-updating dashboard showing project health, agents, task flow' 'references:Resolve local file, symbol, git, plan, run, task, and agent references' 'next:Show the best pending task to work on next' 'claim:Atomically claim the best pending task for an agent' 'steal:Work-stealing: take the highest-priority stale task from another agent' 'status:Show full project health snapshot' 'recap:Show what happened in the last N hours — completed tasks, new tasks, agent activity, blockers' 'standup:Generate standup notes — completed since yesterday, in progress, blocked. Grouped by agent.' 'fail:Mark a task as failed with optional reason and retry' 'active:Show all currently in-progress tasks' 'stale:Find tasks stuck in_progress with no recent activity' 'redistribute:Release stale in-progress tasks and claim the best one (work-stealing)' 'assign:Assign a task to an agent' 'unassign:Remove task assignment' 'tag:Add a tag to a task' 'untag:Remove a tag from a task' 'pin:Escalate task to critical priority' 'summary:Generate a markdown summary of recent task activity' 'doctor:Diagnose and optionally repair local task data issues' 'health:Check todos system health — database, config, connectivity' 'report:Analytics report: task activity, completion rates, agent breakdown' 'today:Show task activity from today' 'yesterday:Show task activity from yesterday' 'mine:Show tasks assigned to you, grouped by status' 'blocked:Show tasks blocked by incomplete dependencies' 'overdue:Show tasks past their due date' 'sla:Show overdue or SLA-breached tasks that need escalation' 'week:Show task activity from the past 7 days' 'burndown:Show task completion velocity over the past 7 days' 'log:Show recent task activity log (git-log style)' 'timeline:Show a unified local activity timeline for tasks, projects, plans, or runs' 'ready:Show all tasks ready to be claimed (pending, unblocked, unlocked)' 'sprint:Sprint dashboard: in-progress, next up, blockers, and overdue' 'reports:Build local agent-native reports from tasks, plans, runs, and verification evidence' 'handoff:Create or view agent session handoffs' 'priorities:Show task counts grouped by priority' 'context:Session start context: status, latest handoff, next task, overdue' 'release-notes:Generate local release notes and changelog output from completed tasks' 'context-pack:Build a deterministic local agent context pack for a task' 'calendar:List and export local calendar events' 'notifications:Check local due-date, SLA, stale-task, run, and reminder alerts' 'board:Render local task and plan kanban boards' 'time:Track local task time and focus sessions' 'fields:Manage local labels, priority, severity, owner, area, and custom fields' 'workflow:Manage local project workflow states' 'dedupe:Find and merge likely duplicate local tasks' 'issues:Import external issue data into local tasks' 'inbox:Capture local inbox items from pasted errors, CI logs, git context, files, or GitHub issue URLs' 'report-failure:Create a task from a test/build/typecheck failure and auto-assign it' 'hooks:Manage Claude Code hook integration' 'mcp:Start MCP server (stdio)' 'import:Import a GitHub issue as a task' 'link-commit:Link a git commit to a task' 'find-commit:Find which task explains a git commit SHA' 'link-ref:Link a git branch or pull request to a task' 'find-ref:Find tasks linked to a git branch or pull request' 'branch-plan:Create a local branch-safe work plan from task or plan files' 'record-verification:Record a verification command and result for a task' 'trace:Show local git refs, commits, changed files, and verification commands for a task' 'contracts:Manage local task contracts, acceptance criteria, and review gates' 'verify-providers:Manage optional local verification provider adapters' 'runs:Manage the local run ledger and evidence capture' 'findings:Manage local task findings for loop dedupe and resolution' 'agent-runs:Queue and dispatch local agent runs' 'hook:Manage git hooks for auto-linking commits to tasks' 'dispatch:Legacy/emergency only: send tasks or task lists to a tmux window after explicit human choice' 'dispatches:List dispatch history' 'machines:List registered machines' 'api-keys:Generate, list, and revoke API keys for secured app/API access' 'env-snapshot:Capture and compare local reproducible environment snapshots' 'knowledge:Manage local project knowledge records, decisions, tradeoffs, and context snapshots' 'risks:Manage local project and plan risks, and score local plan/project health' 'retrospectives:Generate and store local retrospectives and lessons learned from project or plan evidence' 'reliability:Generate local-only agent reliability scorecards from tasks, runs, verification evidence, locks, retries, and handoffs' 'onboarding:List, show, write, or import bundled local onboarding fixtures' 'snapshots:List, read, or poll local agent snapshots' 'sdk-fixtures:List, show, or write local SDK integration fixtures' 'reviews:Manage local review queues, reviewer claims, returns, approvals, and routing rules' 'roadmaps:Manage local roadmaps, milestones, and release groupings' 'capacity:Manage local capacity profiles and planning forecasts' 'audit-ledger:Create and verify tamper-evident local audit ledger checkpoints' 'release-compat:Check local release compatibility, migrations, exports, and Bun install guidance' 'usage:Report local task, run, command, cost, duration, storage, and quota usage' 'backup:Create, verify, restore, and inspect local backup bundles' 'storage:Inspect local storage and Stage B configured intent; remote runtime stays disabled in Stage A' 'scale:Benchmark local performance, archive readiness, compaction, and SQLite integrity' 'webhooks:Manage Hasna event webhook subscriptions' 'events:Emit, list, and replay Hasna events' 'completions:Generate shell completions for bash, zsh, or fish' 'manual:Print the complete local CLI manual')\n  local -a global_options; global_options=('--agent' '--json' '--project' '--session' '--version' '-V' '-j')\n  if (( CURRENT == 2 )); then\n    _describe 'command' commands\n    return\n  fi\n  case $words[2] in\n    task) local -a subcommands; subcommands=('upsert:Create or update a task by stable metadata fingerprint' 'route-state:Show deterministic routing eligibility and workflow pointers for a task' 'workflow-pointers:Update OpenLoops workflow invocation/run artifact pointers on a task'); _describe 'subcommand' subcommands ;;\n    views) local -a subcommands; subcommands=('save:Save a local search view' 'list:List local saved search views' 'run:Run a local saved search view' 'delete:Delete a local saved search view'); _describe 'subcommand' subcommands ;;\n    projects-path) local -a subcommands; subcommands=('set:Set the local path for a project on this machine' 'list:List all machine path overrides for a project' 'remove:Remove the local path override for a project on this machine'); _describe 'subcommand' subcommands ;;\n    encryption) local -a subcommands; subcommands=('list:List local encryption profiles' 'set:Create or update a local encryption profile' 'status:Show whether a local encryption profile is locked or unlocked' 'remove:Remove a local encryption profile' 'test:Encrypt and decrypt a local test payload without storing key material'); _describe 'subcommand' subcommands ;;\n    redaction) local -a subcommands; subcommands=('status:Show local secret redaction configuration' 'add:Add local secret redaction regex patterns or object key names' 'scan:Scan text or a file for secret-like values without printing values'); _describe 'subcommand' subcommands ;;\n    retention) local -a subcommands; subcommands=('cleanup:Dry-run by default; add --apply and the exact --confirm value to delete local retention data'); _describe 'subcommand' subcommands ;;\n    trust) local -a subcommands; subcommands=('list:List local workspace trust profiles' 'status:Show local trust status for a workspace path' 'add:Add or update a local workspace trust profile' 'remove:Remove a local workspace trust profile' 'check:Check whether a local command, tool, or write path is allowed'); _describe 'subcommand' subcommands ;;\n    sandbox) local -a subcommands; subcommands=('list:List local runner sandbox profiles' 'set:Add or update a local runner sandbox profile' 'remove:Remove a local runner sandbox profile' 'check:Check whether a local runner action is allowed' 'explain:Dry-run explain output for a local runner sandbox check'); _describe 'subcommand' subcommands ;;\n    extensions) local -a subcommands; subcommands=('list:List installed local extensions' 'discover:Discover local extension manifests from config and project .todos folders' 'inspect:Validate a local extension manifest, directory, or offline bundle without installing it' 'install:Install or update a local extension from a manifest, directory, or offline bundle' 'compat:Run local CLI/MCP compatibility checks and runner sandbox dry-runs for an extension' 'verify:Verify a local extension source checksum and optional signature without installing it' 'remove:Remove a local extension from the registry'); _describe 'subcommand' subcommands ;;\n    workflows) local -a subcommands; subcommands=('list:List bundled local workflow prompts' 'show:Render a guided workflow prompt as Markdown or JSON' 'export:Export bundled local workflow prompt metadata'); _describe 'subcommand' subcommands ;;\n    policies) local -a subcommands; subcommands=('list:List local policy packs' 'set:Add or update a local policy pack' 'remove:Remove a local policy pack' 'validate:Validate a task against a local policy pack' 'explain:Dry-run explain output for local policy-pack validation'); _describe 'subcommand' subcommands ;;\n    approvals) local -a subcommands; subcommands=('require:Require a local manual approval gate before risky work' 'approve:Approve a local approval gate' 'reject:Reject a local approval gate' 'expire:Expire a pending local approval gate' 'check:Check whether a local approval gate allows work to proceed' 'list:List local approval gates for a task'); _describe 'subcommand' subcommands ;;\n    event-hooks) local -a subcommands; subcommands=('list:List local event hooks' 'set:Add or update a local event hook' 'remove:Remove a local event hook' 'test:Deliver a test event to one local event hook'); _describe 'subcommand' subcommands ;;\n    terminal-notifications) local -a subcommands; subcommands=('list:List local terminal notification rules' 'set:Add or update a local terminal notification watch rule' 'remove:Remove a local terminal notification rule' 'test:Evaluate a local terminal notification rule against a sample event'); _describe 'subcommand' subcommands ;;\n    references) local -a subcommands; subcommands=('resolve:Resolve mentions using only local workspace, git, and todos state'); _describe 'subcommand' subcommands ;;\n    doctor) local -a subcommands; subcommands=('routing:Diagnose (and with --apply, safely repair) task routing-metadata drift: working_dir, task_list_id linkage, invalid paths, cross-repo intent'); _describe 'subcommand' subcommands ;;\n    reports) local -a subcommands; subcommands=('local:Build a local JSON or Markdown report for agent planning and standups'); _describe 'subcommand' subcommands ;;\n    calendar) local -a subcommands; subcommands=('list:List local calendar events from tasks, SLA thresholds, runs, and local items' 'add:Create a local reminder, milestone, or work block' 'export:Export deterministic local calendar events as ICS' 'import:Import VEVENT entries from an ICS file as local imported calendar items'); _describe 'subcommand' subcommands ;;\n    notifications) local -a subcommands; subcommands=('check:Evaluate local notification alerts and optionally emit local hooks or terminal watch rules'); _describe 'subcommand' subcommands ;;\n    board) local -a subcommands; subcommands=('create:Create a local kanban board' 'list:List local kanban boards' 'show:Render a local kanban board' 'tui:Render a keyboard-oriented terminal board snapshot' 'move:Move a task or plan card to a lane or explicit status' 'export:Export local board definitions as a portable JSON bundle' 'import:Import local board definitions from a JSON bundle' 'delete:Delete a local board definition'); _describe 'subcommand' subcommands ;;\n    time) local -a subcommands; subcommands=('log:Log completed local time against a task' 'start:Start a local focus session' 'pause:Pause an active focus session' 'resume:Resume a paused focus session' 'stop:Stop a focus session and log task time when linked to a task' 'list:List local focus sessions' 'idle:Show active focus sessions that need an idle prompt' 'report:Report local actual time against estimates'); _describe 'subcommand' subcommands ;;\n    fields) local -a subcommands; subcommands=('show:Show local fields for a task' 'set:Set local fields for a task' 'query:Query tasks by local fields'); _describe 'subcommand' subcommands ;;\n    workflow) local -a subcommands; subcommands=('states:List local workflow states' 'set:Set a task'\\''s local workflow state' 'tasks:List tasks by local workflow state' 'migrate:Backfill local workflow state metadata from canonical task statuses'); _describe 'subcommand' subcommands ;;\n    dedupe) local -a subcommands; subcommands=('scan:Scan local tasks for likely duplicates' 'merge:Merge a duplicate task into a primary task and archive the duplicate'); _describe 'subcommand' subcommands ;;\n    issues) local -a subcommands; subcommands=('import:Dry-run or apply local imports from GitHub, Linear, Jira, or plain URL issue data' 'report:Dry-run or apply testers.issue_report.v1 payloads into local tasks'); _describe 'subcommand' subcommands ;;\n    inbox) local -a subcommands; subcommands=('add:Create a local inbox item and linked task from text, stdin, or a file' 'git:Capture local git status and optional diff/stat context into the inbox' 'parse:Preview or apply deterministic local natural-language task intake' 'list:List local inbox items' 'show:Show one inbox item'); _describe 'subcommand' subcommands ;;\n    hooks) local -a subcommands; subcommands=('install:Install Claude Code hooks for auto-sync'); _describe 'subcommand' subcommands ;;\n    contracts) local -a subcommands; subcommands=('set:Set acceptance criteria, required verification, artifacts, files, risk, and done definition' 'show:Show the local task contract and review state' 'request-review:Request local review for a task' 'review:Record local review approval, requested changes, or reopen state' 'check:Check whether local task evidence satisfies the task contract'); _describe 'subcommand' subcommands ;;\n    verify-providers) local -a subcommands; subcommands=('set:Create or update a local verification provider' 'list:List local verification providers' 'capabilities:Show local verification provider capabilities' 'remove:Remove a local verification provider' 'run:Run a local verification provider and optionally record task evidence'); _describe 'subcommand' subcommands ;;\n    runs) local -a subcommands; subcommands=('begin:Preview or apply an idempotent loop run transaction' 'start:Start a local run ledger entry for a task' 'list:List local run ledger entries' 'show:Show a run ledger with events, commands, files, and artifacts' 'simulate:Dry-run replay a recorded context pack or run fixture without mutating local state' 'event:Record a progress, comment, claim, or generic run event' 'command:Record command/test evidence for a run' 'file:Record a file touched by a run' 'artifact:Record a local artifact for a run in the content-addressed store' 'artifact-verify:Verify locally stored run artifact content against recorded checksums' 'finish:Finish a run ledger entry idempotently'); _describe 'subcommand' subcommands ;;\n    findings) local -a subcommands; subcommands=('upsert:Preview or apply an idempotent finding upsert' 'resolve-missing:Resolve open findings absent from the latest loop finding set' 'list:List compact local findings'); _describe 'subcommand' subcommands ;;\n    agent-runs) local -a subcommands; subcommands=('adapter-set:Create or update a local agent run adapter' 'adapters:List local agent run adapters' 'adapter-remove:Remove a local agent run adapter' 'queue:Queue a local agent run for a task' 'list:List queued local agent runs' 'run-next:Run the next queued local agent dispatch' 'cancel:Cancel a queued or running local agent dispatch' 'retry:Queue a retry for a previous local agent dispatch'); _describe 'subcommand' subcommands ;;\n    hook) local -a subcommands; subcommands=('install:Install post-commit hook that auto-links commits to tasks' 'uninstall:Remove the todos post-commit hook'); _describe 'subcommand' subcommands ;;\n    dispatch) local -a subcommands; subcommands=('run:Fire all pending dispatches that are due now'); _describe 'subcommand' subcommands ;;\n    machines) local -a subcommands; subcommands=('register:Register a machine' 'heartbeat:Update last-seen and local topology metadata for a machine' 'set-primary:Set the primary machine' 'archive:Archive a machine (soft-delete)' 'unarchive:Unarchive a machine' 'delete:Delete a machine (hard delete)' 'status:Show machine health status' 'topology:Show local machine topology diagnostics' 'sync:Sync local bridge bundles with remote machine(s) via SSH' 'tasks:List tasks from a remote machine via SSH'); _describe 'subcommand' subcommands ;;\n    api-keys) local -a subcommands; subcommands=('create:Generate a new API key. The plaintext key is shown once.' 'list:List API keys without showing plaintext secrets' 'revoke:Revoke an API key by id or prefix' 'verify:Verify an API key locally without printing stored hashes'); _describe 'subcommand' subcommands ;;\n    env-snapshot) local -a subcommands; subcommands=('capture:Capture runtime, package-manager, git, config hash, and redacted environment metadata' 'compare:Compare two environment snapshot JSON files'); _describe 'subcommand' subcommands ;;\n    knowledge) local -a subcommands; subcommands=('add:Add a local knowledge record' 'snapshot:Save a local context snapshot and attach it as a knowledge record' 'list:List local knowledge records' 'search:Search local knowledge records' 'show:Show one local knowledge record' 'export:Export local knowledge records as deterministic JSON or Markdown'); _describe 'subcommand' subcommands ;;\n    risks) local -a subcommands; subcommands=('add:Add a local risk register entry' 'list:List local risk register entries' 'show:Show one local risk' 'update:Update a local risk' 'close:Close a risk as resolved or accepted' 'score:Score local health for a plan or project' 'export:Export local risk register entries as deterministic JSON or Markdown'); _describe 'subcommand' subcommands ;;\n    retrospectives) local -a subcommands; subcommands=('create:Create a local retrospective report' 'list:List stored local retrospectives' 'show:Show one stored local retrospective' 'export:Export stored local retrospectives as deterministic JSON or Markdown'); _describe 'subcommand' subcommands ;;\n    reliability) local -a subcommands; subcommands=('show:Show one local agent reliability scorecard' 'list:List local agent reliability scorecards' 'export:Export local agent reliability scorecards as deterministic JSON or Markdown'); _describe 'subcommand' subcommands ;;\n    reviews) local -a subcommands; subcommands=('list:List local tasks waiting in review queues' 'request:Request local review for a task' 'claim:Claim a task from the local review queue' 'approve:Approve a reviewed task' 'return:Return a reviewed task with requested changes' 'reopen:Reopen a reviewed task for another review pass' 'rules:Manage local review routing rules'); _describe 'subcommand' subcommands ;;\n    roadmaps) local -a subcommands; subcommands=('create:Create a local roadmap' 'list:List local roadmaps' 'show:Show a roadmap summary' 'update:Update a local roadmap' 'delete:Delete a local roadmap and its local milestone/release config' 'milestones:Manage roadmap milestones' 'releases:Manage roadmap release groups' 'export:Export a roadmap as JSON bundle or Markdown' 'import:Preview or apply a roadmap JSON bundle'); _describe 'subcommand' subcommands ;;\n    capacity) local -a subcommands; subcommands=('set:Create or update a local agent capacity profile' 'list:List local capacity profiles' 'remove:Remove a local capacity profile' 'forecast:Forecast local plan or project completion from estimates and capacity'); _describe 'subcommand' subcommands ;;\n    audit-ledger) local -a subcommands; subcommands=('show:Build a local audit hash chain from current evidence' 'seal:Store a local audit ledger checkpoint for later verification' 'list:List local audit ledger checkpoints' 'verify:Verify current local evidence against a sealed checkpoint'); _describe 'subcommand' subcommands ;;\n    release-compat) local -a subcommands; subcommands=('check:Build a local release compatibility report'); _describe 'subcommand' subcommands ;;\n    usage) local -a subcommands; subcommands=('report:Build an aggregate local usage ledger'); _describe 'subcommand' subcommands ;;\n    backup) local -a subcommands; subcommands=('create:Create a local backup bundle with a manifest and checksums' 'verify:Verify a local backup bundle checksum, manifest, bridge schema, and current SQLite integrity' 'restore:Dry-run or apply a local backup restore. Dry-run is the default.' 'integrity:Check local SQLite, bridge, count, and orphan-row integrity'); _describe 'subcommand' subcommands ;;\n    storage) local -a subcommands; subcommands=('status:Show redacted local status and configured remote intent; remote_enabled remains false in Stage A' 'sync-plan:Show a no-network Stage B-deferred sync design; it never enables or runs remote sync' 'shadow-status:Stage B deferred: remote shadow status is unavailable while Stage A authority is disabled' 'shadow-drain:Stage B deferred: remote shadow drain is unavailable while Stage A authority is disabled' 'artifacts:Stage B-deferred S3 artifact design; apply is denied in Stage A'); _describe 'subcommand' subcommands ;;\n    scale) local -a subcommands; subcommands=('report:Build a local scale hardening report without network access' 'compact:Preview or apply local SQLite optimization and VACUUM compaction'); _describe 'subcommand' subcommands ;;\n    webhooks) local -a subcommands; subcommands=('add:Add or replace a webhook or command subscription' 'list:List configured subscriptions' 'status:Show events webhook storage status' 'remove:Remove a subscription' 'test:Send a test event to one subscription' 'match:Check whether a sample event matches one subscription without delivering'); _describe 'subcommand' subcommands ;;\n    events) local -a subcommands; subcommands=('emit:Emit an event from this app' 'list:List recorded events' 'replay:Replay recorded events'); _describe 'subcommand' subcommands ;;\n  esac\n  _arguments $global_options '*::arg:->args'\n}\n_todos \"$@\"\n\n",
  "fish": "# todos fish completion. Generated by `todos completions fish`.\ncomplete -c todos -f\ncomplete -c todos -l project -d \"Project path\"\ncomplete -c todos -l json -s j -d \"Output as JSON\"\ncomplete -c todos -l agent -d \"Agent name\"\ncomplete -c todos -l session -d \"Session ID\"\ncomplete -c todos -l version -s V -d \"output the version number\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"add\" -d \"Create a new task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"task\" -d \"Task subcommands for deterministic automation\"\ncomplete -c todos -n \"__fish_seen_subcommand_from task\" -a \"upsert\" -d \"Create or update a task by stable metadata fingerprint\"\ncomplete -c todos -n \"__fish_seen_subcommand_from task\" -a \"route-state\" -d \"Show deterministic routing eligibility and workflow pointers for a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from task\" -a \"workflow-pointers\" -d \"Update OpenLoops workflow invocation/run artifact pointers on a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"list\" -d \"List tasks\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"count\" -d \"Show task count by status\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"show\" -d \"Show full task details\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"inspect\" -d \"Full orientation for a task — details, description, dependencies, blocker, files, commits, comments. If no ID given, shows current in-progress task for --agent.\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"history\" -d \"Show change history for a task (audit log)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"update\" -d \"Update a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"done\" -d \"Mark a task as completed\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"approve\" -d \"Approve a task that requires approval\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"start\" -d \"Claim, lock, and start a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"lock\" -d \"Acquire exclusive lock on a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"unlock\" -d \"Release lock on a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"delete\" -d \"Delete a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"remove\" -d \"Remove/delete a task (alias for delete)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"bulk\" -d \"Bulk operation on multiple tasks (done, start, delete, plan)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"plans\" -d \"List and manage plans\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"templates\" -d \"List and manage task templates\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"template-init\" -d \"Initialize the bundled local template library\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"template-library\" -d \"List, show, or write the bundled local template library as editable JSON files\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"template-preview\" -d \"Preview a template without creating tasks — shows resolved titles, deps, and priorities\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"template-export\" -d \"Export a template as JSON to stdout\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"template-import\" -d \"Import a template from a JSON file\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"template-history\" -d \"Show version history of a template\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"project-bootstrap\" -d \"Discover a local workspace and initialize project task state\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"comment\" -d \"Add a comment to a task (alias: log-progress, for recording intermediate progress)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"search\" -d \"Search local tasks, or run/save a cross-entity search view\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"views\" -d \"Manage local saved search views\"\ncomplete -c todos -n \"__fish_seen_subcommand_from views\" -a \"save\" -d \"Save a local search view\"\ncomplete -c todos -n \"__fish_seen_subcommand_from views\" -a \"list\" -d \"List local saved search views\"\ncomplete -c todos -n \"__fish_seen_subcommand_from views\" -a \"run\" -d \"Run a local saved search view\"\ncomplete -c todos -n \"__fish_seen_subcommand_from views\" -a \"delete\" -d \"Delete a local saved search view\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"deps\" -d \"Manage task dependencies\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"projects\" -d \"List and manage projects\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"project-panel\" -d \"Emit a contract-valid project dashboard panel for todos\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"project-rename\" -d \"Rename a project slug. Cascades to matching task lists. Task prefixes (e.g. APP-00001) are unchanged.\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"projects-path\" -d \"Manage machine-local path overrides for projects\"\ncomplete -c todos -n \"__fish_seen_subcommand_from projects-path\" -a \"set\" -d \"Set the local path for a project on this machine\"\ncomplete -c todos -n \"__fish_seen_subcommand_from projects-path\" -a \"list\" -d \"List all machine path overrides for a project\"\ncomplete -c todos -n \"__fish_seen_subcommand_from projects-path\" -a \"remove\" -d \"Remove the local path override for a project on this machine\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"extract\" -d \"Extract TODO/FIXME/HACK/BUG/XXX/NOTE comments from source files and create tasks\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"extract-watch\" -d \"Poll a local source tree for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"export\" -d \"Export tasks\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"bridge-import\" -d \"Dry-run or apply a local hasna/todos bridge export bundle\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"todos-md-import\" -d \"Dry-run or apply a local todos.md Markdown import\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"sync\" -d \"Sync tasks with an agent task list (Claude uses native task list; others use JSON lists)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"init\" -d \"Register an agents and get a short UUID\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"heartbeat\" -d \"Update last_seen_at to signal you're still active\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"release\" -d \"Release/logout an agent — clears session binding so the name is immediately available\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"focus\" -d \"Focus on a project (or clear focus if no project given)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"agents\" -d \"List registered agents\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"agents-normalize\" -d \"Rename invalid/generated agent names (agent, agent-1, name-2, two-word names) to safe one-word names\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"agent-update\" -d \"Update an agent's description, role, or other fields\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"agent\" -d \"Show all info about an agent: tasks, status, last seen, stats\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"org\" -d \"Show agent org chart — who reports to who\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"lists\" -d \"List and manage task lists\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"upgrade\" -d \"Update todos to the latest version\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"config\" -d \"View or update configuration\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"encryption\" -d \"Manage local encryption profiles for fields and secure exports\"\ncomplete -c todos -n \"__fish_seen_subcommand_from encryption\" -a \"list\" -d \"List local encryption profiles\"\ncomplete -c todos -n \"__fish_seen_subcommand_from encryption\" -a \"set\" -d \"Create or update a local encryption profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from encryption\" -a \"status\" -d \"Show whether a local encryption profile is locked or unlocked\"\ncomplete -c todos -n \"__fish_seen_subcommand_from encryption\" -a \"remove\" -d \"Remove a local encryption profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from encryption\" -a \"test\" -d \"Encrypt and decrypt a local test payload without storing key material\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"redaction\" -d \"Manage local secret redaction patterns and scans\"\ncomplete -c todos -n \"__fish_seen_subcommand_from redaction\" -a \"status\" -d \"Show local secret redaction configuration\"\ncomplete -c todos -n \"__fish_seen_subcommand_from redaction\" -a \"add\" -d \"Add local secret redaction regex patterns or object key names\"\ncomplete -c todos -n \"__fish_seen_subcommand_from redaction\" -a \"scan\" -d \"Scan text or a file for secret-like values without printing values\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"retention\" -d \"Preview or apply local retention cleanup for old comments, runs, verification evidence, and expired artifact files\"\ncomplete -c todos -n \"__fish_seen_subcommand_from retention\" -a \"cleanup\" -d \"Dry-run by default; add --apply and the exact --confirm value to delete local retention data\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"trust\" -d \"Manage local workspace trust and permission profiles\"\ncomplete -c todos -n \"__fish_seen_subcommand_from trust\" -a \"list\" -d \"List local workspace trust profiles\"\ncomplete -c todos -n \"__fish_seen_subcommand_from trust\" -a \"status\" -d \"Show local trust status for a workspace path\"\ncomplete -c todos -n \"__fish_seen_subcommand_from trust\" -a \"add\" -d \"Add or update a local workspace trust profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from trust\" -a \"remove\" -d \"Remove a local workspace trust profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from trust\" -a \"check\" -d \"Check whether a local command, tool, or write path is allowed\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"sandbox\" -d \"Manage local runner sandbox profiles and dry-run checks\"\ncomplete -c todos -n \"__fish_seen_subcommand_from sandbox\" -a \"list\" -d \"List local runner sandbox profiles\"\ncomplete -c todos -n \"__fish_seen_subcommand_from sandbox\" -a \"set\" -d \"Add or update a local runner sandbox profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from sandbox\" -a \"remove\" -d \"Remove a local runner sandbox profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from sandbox\" -a \"check\" -d \"Check whether a local runner action is allowed\"\ncomplete -c todos -n \"__fish_seen_subcommand_from sandbox\" -a \"explain\" -d \"Dry-run explain output for a local runner sandbox check\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"extensions\" -d \"Manage local workflow extension registry\"\ncomplete -c todos -n \"__fish_seen_subcommand_from extensions\" -a \"list\" -d \"List installed local extensions\"\ncomplete -c todos -n \"__fish_seen_subcommand_from extensions\" -a \"discover\" -d \"Discover local extension manifests from config and project .todos folders\"\ncomplete -c todos -n \"__fish_seen_subcommand_from extensions\" -a \"inspect\" -d \"Validate a local extension manifest, directory, or offline bundle without installing it\"\ncomplete -c todos -n \"__fish_seen_subcommand_from extensions\" -a \"install\" -d \"Install or update a local extension from a manifest, directory, or offline bundle\"\ncomplete -c todos -n \"__fish_seen_subcommand_from extensions\" -a \"compat\" -d \"Run local CLI/MCP compatibility checks and runner sandbox dry-runs for an extension\"\ncomplete -c todos -n \"__fish_seen_subcommand_from extensions\" -a \"verify\" -d \"Verify a local extension source checksum and optional signature without installing it\"\ncomplete -c todos -n \"__fish_seen_subcommand_from extensions\" -a \"remove\" -d \"Remove a local extension from the registry\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"workflows\" -d \"List and render local guided workflow prompts\"\ncomplete -c todos -n \"__fish_seen_subcommand_from workflows\" -a \"list\" -d \"List bundled local workflow prompts\"\ncomplete -c todos -n \"__fish_seen_subcommand_from workflows\" -a \"show\" -d \"Render a guided workflow prompt as Markdown or JSON\"\ncomplete -c todos -n \"__fish_seen_subcommand_from workflows\" -a \"export\" -d \"Export bundled local workflow prompt metadata\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"policies\" -d \"Manage local policy packs for task done gates\"\ncomplete -c todos -n \"__fish_seen_subcommand_from policies\" -a \"list\" -d \"List local policy packs\"\ncomplete -c todos -n \"__fish_seen_subcommand_from policies\" -a \"set\" -d \"Add or update a local policy pack\"\ncomplete -c todos -n \"__fish_seen_subcommand_from policies\" -a \"remove\" -d \"Remove a local policy pack\"\ncomplete -c todos -n \"__fish_seen_subcommand_from policies\" -a \"validate\" -d \"Validate a task against a local policy pack\"\ncomplete -c todos -n \"__fish_seen_subcommand_from policies\" -a \"explain\" -d \"Dry-run explain output for local policy-pack validation\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"approvals\" -d \"Manage local approval gates and manual checkpoints\"\ncomplete -c todos -n \"__fish_seen_subcommand_from approvals\" -a \"require\" -d \"Require a local manual approval gate before risky work\"\ncomplete -c todos -n \"__fish_seen_subcommand_from approvals\" -a \"approve\" -d \"Approve a local approval gate\"\ncomplete -c todos -n \"__fish_seen_subcommand_from approvals\" -a \"reject\" -d \"Reject a local approval gate\"\ncomplete -c todos -n \"__fish_seen_subcommand_from approvals\" -a \"expire\" -d \"Expire a pending local approval gate\"\ncomplete -c todos -n \"__fish_seen_subcommand_from approvals\" -a \"check\" -d \"Check whether a local approval gate allows work to proceed\"\ncomplete -c todos -n \"__fish_seen_subcommand_from approvals\" -a \"list\" -d \"List local approval gates for a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"event-hooks\" -d \"Manage local event hooks and automation triggers\"\ncomplete -c todos -n \"__fish_seen_subcommand_from event-hooks\" -a \"list\" -d \"List local event hooks\"\ncomplete -c todos -n \"__fish_seen_subcommand_from event-hooks\" -a \"set\" -d \"Add or update a local event hook\"\ncomplete -c todos -n \"__fish_seen_subcommand_from event-hooks\" -a \"remove\" -d \"Remove a local event hook\"\ncomplete -c todos -n \"__fish_seen_subcommand_from event-hooks\" -a \"test\" -d \"Deliver a test event to one local event hook\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"terminal-notifications\" -d \"Manage local terminal notification watch rules\"\ncomplete -c todos -n \"__fish_seen_subcommand_from terminal-notifications\" -a \"list\" -d \"List local terminal notification rules\"\ncomplete -c todos -n \"__fish_seen_subcommand_from terminal-notifications\" -a \"set\" -d \"Add or update a local terminal notification watch rule\"\ncomplete -c todos -n \"__fish_seen_subcommand_from terminal-notifications\" -a \"remove\" -d \"Remove a local terminal notification rule\"\ncomplete -c todos -n \"__fish_seen_subcommand_from terminal-notifications\" -a \"test\" -d \"Evaluate a local terminal notification rule against a sample event\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"serve\" -d \"Start the web dashboard\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"watch\" -d \"Live-updating task list (refreshes every few seconds)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"stream\" -d \"Subscribe to real-time task events via SSE (requires todos serve)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"interactive\" -d \"Launch interactive TUI\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"blame\" -d \"Show which tasks/agents touched a file and why — combines task_files + task_commits\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"dashboard\" -d \"Live-updating dashboard showing project health, agents, task flow\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"references\" -d \"Resolve local file, symbol, git, plan, run, task, and agent references\"\ncomplete -c todos -n \"__fish_seen_subcommand_from references\" -a \"resolve\" -d \"Resolve mentions using only local workspace, git, and todos state\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"next\" -d \"Show the best pending task to work on next\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"claim\" -d \"Atomically claim the best pending task for an agent\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"steal\" -d \"Work-stealing: take the highest-priority stale task from another agent\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"status\" -d \"Show full project health snapshot\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"recap\" -d \"Show what happened in the last N hours — completed tasks, new tasks, agent activity, blockers\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"standup\" -d \"Generate standup notes — completed since yesterday, in progress, blocked. Grouped by agent.\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"fail\" -d \"Mark a task as failed with optional reason and retry\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"active\" -d \"Show all currently in-progress tasks\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"stale\" -d \"Find tasks stuck in_progress with no recent activity\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"redistribute\" -d \"Release stale in-progress tasks and claim the best one (work-stealing)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"assign\" -d \"Assign a task to an agent\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"unassign\" -d \"Remove task assignment\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"tag\" -d \"Add a tag to a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"untag\" -d \"Remove a tag from a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"pin\" -d \"Escalate task to critical priority\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"summary\" -d \"Generate a markdown summary of recent task activity\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"doctor\" -d \"Diagnose and optionally repair local task data issues\"\ncomplete -c todos -n \"__fish_seen_subcommand_from doctor\" -a \"routing\" -d \"Diagnose (and with --apply, safely repair) task routing-metadata drift: working_dir, task_list_id linkage, invalid paths, cross-repo intent\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"health\" -d \"Check todos system health — database, config, connectivity\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"report\" -d \"Analytics report: task activity, completion rates, agent breakdown\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"today\" -d \"Show task activity from today\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"yesterday\" -d \"Show task activity from yesterday\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"mine\" -d \"Show tasks assigned to you, grouped by status\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"blocked\" -d \"Show tasks blocked by incomplete dependencies\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"overdue\" -d \"Show tasks past their due date\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"sla\" -d \"Show overdue or SLA-breached tasks that need escalation\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"week\" -d \"Show task activity from the past 7 days\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"burndown\" -d \"Show task completion velocity over the past 7 days\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"log\" -d \"Show recent task activity log (git-log style)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"timeline\" -d \"Show a unified local activity timeline for tasks, projects, plans, or runs\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"ready\" -d \"Show all tasks ready to be claimed (pending, unblocked, unlocked)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"sprint\" -d \"Sprint dashboard: in-progress, next up, blockers, and overdue\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"reports\" -d \"Build local agent-native reports from tasks, plans, runs, and verification evidence\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reports\" -a \"local\" -d \"Build a local JSON or Markdown report for agent planning and standups\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"handoff\" -d \"Create or view agent session handoffs\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"priorities\" -d \"Show task counts grouped by priority\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"context\" -d \"Session start context: status, latest handoff, next task, overdue\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"release-notes\" -d \"Generate local release notes and changelog output from completed tasks\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"context-pack\" -d \"Build a deterministic local agent context pack for a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"calendar\" -d \"List and export local calendar events\"\ncomplete -c todos -n \"__fish_seen_subcommand_from calendar\" -a \"list\" -d \"List local calendar events from tasks, SLA thresholds, runs, and local items\"\ncomplete -c todos -n \"__fish_seen_subcommand_from calendar\" -a \"add\" -d \"Create a local reminder, milestone, or work block\"\ncomplete -c todos -n \"__fish_seen_subcommand_from calendar\" -a \"export\" -d \"Export deterministic local calendar events as ICS\"\ncomplete -c todos -n \"__fish_seen_subcommand_from calendar\" -a \"import\" -d \"Import VEVENT entries from an ICS file as local imported calendar items\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"notifications\" -d \"Check local due-date, SLA, stale-task, run, and reminder alerts\"\ncomplete -c todos -n \"__fish_seen_subcommand_from notifications\" -a \"check\" -d \"Evaluate local notification alerts and optionally emit local hooks or terminal watch rules\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"board\" -d \"Render local task and plan kanban boards\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"create\" -d \"Create a local kanban board\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"list\" -d \"List local kanban boards\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"show\" -d \"Render a local kanban board\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"tui\" -d \"Render a keyboard-oriented terminal board snapshot\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"move\" -d \"Move a task or plan card to a lane or explicit status\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"export\" -d \"Export local board definitions as a portable JSON bundle\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"import\" -d \"Import local board definitions from a JSON bundle\"\ncomplete -c todos -n \"__fish_seen_subcommand_from board\" -a \"delete\" -d \"Delete a local board definition\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"time\" -d \"Track local task time and focus sessions\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"log\" -d \"Log completed local time against a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"start\" -d \"Start a local focus session\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"pause\" -d \"Pause an active focus session\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"resume\" -d \"Resume a paused focus session\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"stop\" -d \"Stop a focus session and log task time when linked to a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"list\" -d \"List local focus sessions\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"idle\" -d \"Show active focus sessions that need an idle prompt\"\ncomplete -c todos -n \"__fish_seen_subcommand_from time\" -a \"report\" -d \"Report local actual time against estimates\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"fields\" -d \"Manage local labels, priority, severity, owner, area, and custom fields\"\ncomplete -c todos -n \"__fish_seen_subcommand_from fields\" -a \"show\" -d \"Show local fields for a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from fields\" -a \"set\" -d \"Set local fields for a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from fields\" -a \"query\" -d \"Query tasks by local fields\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"workflow\" -d \"Manage local project workflow states\"\ncomplete -c todos -n \"__fish_seen_subcommand_from workflow\" -a \"states\" -d \"List local workflow states\"\ncomplete -c todos -n \"__fish_seen_subcommand_from workflow\" -a \"set\" -d \"Set a task's local workflow state\"\ncomplete -c todos -n \"__fish_seen_subcommand_from workflow\" -a \"tasks\" -d \"List tasks by local workflow state\"\ncomplete -c todos -n \"__fish_seen_subcommand_from workflow\" -a \"migrate\" -d \"Backfill local workflow state metadata from canonical task statuses\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"dedupe\" -d \"Find and merge likely duplicate local tasks\"\ncomplete -c todos -n \"__fish_seen_subcommand_from dedupe\" -a \"scan\" -d \"Scan local tasks for likely duplicates\"\ncomplete -c todos -n \"__fish_seen_subcommand_from dedupe\" -a \"merge\" -d \"Merge a duplicate task into a primary task and archive the duplicate\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"issues\" -d \"Import external issue data into local tasks\"\ncomplete -c todos -n \"__fish_seen_subcommand_from issues\" -a \"import\" -d \"Dry-run or apply local imports from GitHub, Linear, Jira, or plain URL issue data\"\ncomplete -c todos -n \"__fish_seen_subcommand_from issues\" -a \"report\" -d \"Dry-run or apply testers.issue_report.v1 payloads into local tasks\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"inbox\" -d \"Capture local inbox items from pasted errors, CI logs, git context, files, or GitHub issue URLs\"\ncomplete -c todos -n \"__fish_seen_subcommand_from inbox\" -a \"add\" -d \"Create a local inbox item and linked task from text, stdin, or a file\"\ncomplete -c todos -n \"__fish_seen_subcommand_from inbox\" -a \"git\" -d \"Capture local git status and optional diff/stat context into the inbox\"\ncomplete -c todos -n \"__fish_seen_subcommand_from inbox\" -a \"parse\" -d \"Preview or apply deterministic local natural-language task intake\"\ncomplete -c todos -n \"__fish_seen_subcommand_from inbox\" -a \"list\" -d \"List local inbox items\"\ncomplete -c todos -n \"__fish_seen_subcommand_from inbox\" -a \"show\" -d \"Show one inbox item\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"report-failure\" -d \"Create a task from a test/build/typecheck failure and auto-assign it\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"hooks\" -d \"Manage Claude Code hook integration\"\ncomplete -c todos -n \"__fish_seen_subcommand_from hooks\" -a \"install\" -d \"Install Claude Code hooks for auto-sync\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"mcp\" -d \"Start MCP server (stdio)\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"import\" -d \"Import a GitHub issue as a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"link-commit\" -d \"Link a git commit to a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"find-commit\" -d \"Find which task explains a git commit SHA\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"link-ref\" -d \"Link a git branch or pull request to a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"find-ref\" -d \"Find tasks linked to a git branch or pull request\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"branch-plan\" -d \"Create a local branch-safe work plan from task or plan files\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"record-verification\" -d \"Record a verification command and result for a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"trace\" -d \"Show local git refs, commits, changed files, and verification commands for a task\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"contracts\" -d \"Manage local task contracts, acceptance criteria, and review gates\"\ncomplete -c todos -n \"__fish_seen_subcommand_from contracts\" -a \"set\" -d \"Set acceptance criteria, required verification, artifacts, files, risk, and done definition\"\ncomplete -c todos -n \"__fish_seen_subcommand_from contracts\" -a \"show\" -d \"Show the local task contract and review state\"\ncomplete -c todos -n \"__fish_seen_subcommand_from contracts\" -a \"request-review\" -d \"Request local review for a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from contracts\" -a \"review\" -d \"Record local review approval, requested changes, or reopen state\"\ncomplete -c todos -n \"__fish_seen_subcommand_from contracts\" -a \"check\" -d \"Check whether local task evidence satisfies the task contract\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"verify-providers\" -d \"Manage optional local verification provider adapters\"\ncomplete -c todos -n \"__fish_seen_subcommand_from verify-providers\" -a \"set\" -d \"Create or update a local verification provider\"\ncomplete -c todos -n \"__fish_seen_subcommand_from verify-providers\" -a \"list\" -d \"List local verification providers\"\ncomplete -c todos -n \"__fish_seen_subcommand_from verify-providers\" -a \"capabilities\" -d \"Show local verification provider capabilities\"\ncomplete -c todos -n \"__fish_seen_subcommand_from verify-providers\" -a \"remove\" -d \"Remove a local verification provider\"\ncomplete -c todos -n \"__fish_seen_subcommand_from verify-providers\" -a \"run\" -d \"Run a local verification provider and optionally record task evidence\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"runs\" -d \"Manage the local run ledger and evidence capture\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"begin\" -d \"Preview or apply an idempotent loop run transaction\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"start\" -d \"Start a local run ledger entry for a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"list\" -d \"List local run ledger entries\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"show\" -d \"Show a run ledger with events, commands, files, and artifacts\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"simulate\" -d \"Dry-run replay a recorded context pack or run fixture without mutating local state\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"event\" -d \"Record a progress, comment, claim, or generic run event\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"command\" -d \"Record command/test evidence for a run\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"file\" -d \"Record a file touched by a run\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"artifact\" -d \"Record a local artifact for a run in the content-addressed store\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"artifact-verify\" -d \"Verify locally stored run artifact content against recorded checksums\"\ncomplete -c todos -n \"__fish_seen_subcommand_from runs\" -a \"finish\" -d \"Finish a run ledger entry idempotently\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"findings\" -d \"Manage local task findings for loop dedupe and resolution\"\ncomplete -c todos -n \"__fish_seen_subcommand_from findings\" -a \"upsert\" -d \"Preview or apply an idempotent finding upsert\"\ncomplete -c todos -n \"__fish_seen_subcommand_from findings\" -a \"resolve-missing\" -d \"Resolve open findings absent from the latest loop finding set\"\ncomplete -c todos -n \"__fish_seen_subcommand_from findings\" -a \"list\" -d \"List compact local findings\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"agent-runs\" -d \"Queue and dispatch local agent runs\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"adapter-set\" -d \"Create or update a local agent run adapter\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"adapters\" -d \"List local agent run adapters\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"adapter-remove\" -d \"Remove a local agent run adapter\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"queue\" -d \"Queue a local agent run for a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"list\" -d \"List queued local agent runs\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"run-next\" -d \"Run the next queued local agent dispatch\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"cancel\" -d \"Cancel a queued or running local agent dispatch\"\ncomplete -c todos -n \"__fish_seen_subcommand_from agent-runs\" -a \"retry\" -d \"Queue a retry for a previous local agent dispatch\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"hook\" -d \"Manage git hooks for auto-linking commits to tasks\"\ncomplete -c todos -n \"__fish_seen_subcommand_from hook\" -a \"install\" -d \"Install post-commit hook that auto-links commits to tasks\"\ncomplete -c todos -n \"__fish_seen_subcommand_from hook\" -a \"uninstall\" -d \"Remove the todos post-commit hook\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"dispatch\" -d \"Legacy/emergency only: send tasks or task lists to a tmux window after explicit human choice\"\ncomplete -c todos -n \"__fish_seen_subcommand_from dispatch\" -a \"run\" -d \"Fire all pending dispatches that are due now\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"dispatches\" -d \"List dispatch history\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"machines\" -d \"List registered machines\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"register\" -d \"Register a machine\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"heartbeat\" -d \"Update last-seen and local topology metadata for a machine\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"set-primary\" -d \"Set the primary machine\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"archive\" -d \"Archive a machine (soft-delete)\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"unarchive\" -d \"Unarchive a machine\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"delete\" -d \"Delete a machine (hard delete)\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"status\" -d \"Show machine health status\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"topology\" -d \"Show local machine topology diagnostics\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"sync\" -d \"Sync local bridge bundles with remote machine(s) via SSH\"\ncomplete -c todos -n \"__fish_seen_subcommand_from machines\" -a \"tasks\" -d \"List tasks from a remote machine via SSH\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"api-keys\" -d \"Generate, list, and revoke API keys for secured app/API access\"\ncomplete -c todos -n \"__fish_seen_subcommand_from api-keys\" -a \"create\" -d \"Generate a new API key. The plaintext key is shown once.\"\ncomplete -c todos -n \"__fish_seen_subcommand_from api-keys\" -a \"list\" -d \"List API keys without showing plaintext secrets\"\ncomplete -c todos -n \"__fish_seen_subcommand_from api-keys\" -a \"revoke\" -d \"Revoke an API key by id or prefix\"\ncomplete -c todos -n \"__fish_seen_subcommand_from api-keys\" -a \"verify\" -d \"Verify an API key locally without printing stored hashes\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"env-snapshot\" -d \"Capture and compare local reproducible environment snapshots\"\ncomplete -c todos -n \"__fish_seen_subcommand_from env-snapshot\" -a \"capture\" -d \"Capture runtime, package-manager, git, config hash, and redacted environment metadata\"\ncomplete -c todos -n \"__fish_seen_subcommand_from env-snapshot\" -a \"compare\" -d \"Compare two environment snapshot JSON files\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"knowledge\" -d \"Manage local project knowledge records, decisions, tradeoffs, and context snapshots\"\ncomplete -c todos -n \"__fish_seen_subcommand_from knowledge\" -a \"add\" -d \"Add a local knowledge record\"\ncomplete -c todos -n \"__fish_seen_subcommand_from knowledge\" -a \"snapshot\" -d \"Save a local context snapshot and attach it as a knowledge record\"\ncomplete -c todos -n \"__fish_seen_subcommand_from knowledge\" -a \"list\" -d \"List local knowledge records\"\ncomplete -c todos -n \"__fish_seen_subcommand_from knowledge\" -a \"search\" -d \"Search local knowledge records\"\ncomplete -c todos -n \"__fish_seen_subcommand_from knowledge\" -a \"show\" -d \"Show one local knowledge record\"\ncomplete -c todos -n \"__fish_seen_subcommand_from knowledge\" -a \"export\" -d \"Export local knowledge records as deterministic JSON or Markdown\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"risks\" -d \"Manage local project and plan risks, and score local plan/project health\"\ncomplete -c todos -n \"__fish_seen_subcommand_from risks\" -a \"add\" -d \"Add a local risk register entry\"\ncomplete -c todos -n \"__fish_seen_subcommand_from risks\" -a \"list\" -d \"List local risk register entries\"\ncomplete -c todos -n \"__fish_seen_subcommand_from risks\" -a \"show\" -d \"Show one local risk\"\ncomplete -c todos -n \"__fish_seen_subcommand_from risks\" -a \"update\" -d \"Update a local risk\"\ncomplete -c todos -n \"__fish_seen_subcommand_from risks\" -a \"close\" -d \"Close a risk as resolved or accepted\"\ncomplete -c todos -n \"__fish_seen_subcommand_from risks\" -a \"score\" -d \"Score local health for a plan or project\"\ncomplete -c todos -n \"__fish_seen_subcommand_from risks\" -a \"export\" -d \"Export local risk register entries as deterministic JSON or Markdown\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"retrospectives\" -d \"Generate and store local retrospectives and lessons learned from project or plan evidence\"\ncomplete -c todos -n \"__fish_seen_subcommand_from retrospectives\" -a \"create\" -d \"Create a local retrospective report\"\ncomplete -c todos -n \"__fish_seen_subcommand_from retrospectives\" -a \"list\" -d \"List stored local retrospectives\"\ncomplete -c todos -n \"__fish_seen_subcommand_from retrospectives\" -a \"show\" -d \"Show one stored local retrospective\"\ncomplete -c todos -n \"__fish_seen_subcommand_from retrospectives\" -a \"export\" -d \"Export stored local retrospectives as deterministic JSON or Markdown\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"reliability\" -d \"Generate local-only agent reliability scorecards from tasks, runs, verification evidence, locks, retries, and handoffs\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reliability\" -a \"show\" -d \"Show one local agent reliability scorecard\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reliability\" -a \"list\" -d \"List local agent reliability scorecards\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reliability\" -a \"export\" -d \"Export local agent reliability scorecards as deterministic JSON or Markdown\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"onboarding\" -d \"List, show, write, or import bundled local onboarding fixtures\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"snapshots\" -d \"List, read, or poll local agent snapshots\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"sdk-fixtures\" -d \"List, show, or write local SDK integration fixtures\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"reviews\" -d \"Manage local review queues, reviewer claims, returns, approvals, and routing rules\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reviews\" -a \"list\" -d \"List local tasks waiting in review queues\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reviews\" -a \"request\" -d \"Request local review for a task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reviews\" -a \"claim\" -d \"Claim a task from the local review queue\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reviews\" -a \"approve\" -d \"Approve a reviewed task\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reviews\" -a \"return\" -d \"Return a reviewed task with requested changes\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reviews\" -a \"reopen\" -d \"Reopen a reviewed task for another review pass\"\ncomplete -c todos -n \"__fish_seen_subcommand_from reviews\" -a \"rules\" -d \"Manage local review routing rules\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"roadmaps\" -d \"Manage local roadmaps, milestones, and release groupings\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"create\" -d \"Create a local roadmap\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"list\" -d \"List local roadmaps\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"show\" -d \"Show a roadmap summary\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"update\" -d \"Update a local roadmap\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"delete\" -d \"Delete a local roadmap and its local milestone/release config\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"milestones\" -d \"Manage roadmap milestones\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"releases\" -d \"Manage roadmap release groups\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"export\" -d \"Export a roadmap as JSON bundle or Markdown\"\ncomplete -c todos -n \"__fish_seen_subcommand_from roadmaps\" -a \"import\" -d \"Preview or apply a roadmap JSON bundle\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"capacity\" -d \"Manage local capacity profiles and planning forecasts\"\ncomplete -c todos -n \"__fish_seen_subcommand_from capacity\" -a \"set\" -d \"Create or update a local agent capacity profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from capacity\" -a \"list\" -d \"List local capacity profiles\"\ncomplete -c todos -n \"__fish_seen_subcommand_from capacity\" -a \"remove\" -d \"Remove a local capacity profile\"\ncomplete -c todos -n \"__fish_seen_subcommand_from capacity\" -a \"forecast\" -d \"Forecast local plan or project completion from estimates and capacity\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"audit-ledger\" -d \"Create and verify tamper-evident local audit ledger checkpoints\"\ncomplete -c todos -n \"__fish_seen_subcommand_from audit-ledger\" -a \"show\" -d \"Build a local audit hash chain from current evidence\"\ncomplete -c todos -n \"__fish_seen_subcommand_from audit-ledger\" -a \"seal\" -d \"Store a local audit ledger checkpoint for later verification\"\ncomplete -c todos -n \"__fish_seen_subcommand_from audit-ledger\" -a \"list\" -d \"List local audit ledger checkpoints\"\ncomplete -c todos -n \"__fish_seen_subcommand_from audit-ledger\" -a \"verify\" -d \"Verify current local evidence against a sealed checkpoint\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"release-compat\" -d \"Check local release compatibility, migrations, exports, and Bun install guidance\"\ncomplete -c todos -n \"__fish_seen_subcommand_from release-compat\" -a \"check\" -d \"Build a local release compatibility report\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"usage\" -d \"Report local task, run, command, cost, duration, storage, and quota usage\"\ncomplete -c todos -n \"__fish_seen_subcommand_from usage\" -a \"report\" -d \"Build an aggregate local usage ledger\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"backup\" -d \"Create, verify, restore, and inspect local backup bundles\"\ncomplete -c todos -n \"__fish_seen_subcommand_from backup\" -a \"create\" -d \"Create a local backup bundle with a manifest and checksums\"\ncomplete -c todos -n \"__fish_seen_subcommand_from backup\" -a \"verify\" -d \"Verify a local backup bundle checksum, manifest, bridge schema, and current SQLite integrity\"\ncomplete -c todos -n \"__fish_seen_subcommand_from backup\" -a \"restore\" -d \"Dry-run or apply a local backup restore. Dry-run is the default.\"\ncomplete -c todos -n \"__fish_seen_subcommand_from backup\" -a \"integrity\" -d \"Check local SQLite, bridge, count, and orphan-row integrity\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"storage\" -d \"Inspect local storage and Stage B configured intent; remote runtime stays disabled in Stage A\"\ncomplete -c todos -n \"__fish_seen_subcommand_from storage\" -a \"status\" -d \"Show redacted local status and configured remote intent; remote_enabled remains false in Stage A\"\ncomplete -c todos -n \"__fish_seen_subcommand_from storage\" -a \"sync-plan\" -d \"Show a no-network Stage B-deferred sync design; it never enables or runs remote sync\"\ncomplete -c todos -n \"__fish_seen_subcommand_from storage\" -a \"shadow-status\" -d \"Stage B deferred: remote shadow status is unavailable while Stage A authority is disabled\"\ncomplete -c todos -n \"__fish_seen_subcommand_from storage\" -a \"shadow-drain\" -d \"Stage B deferred: remote shadow drain is unavailable while Stage A authority is disabled\"\ncomplete -c todos -n \"__fish_seen_subcommand_from storage\" -a \"artifacts\" -d \"Stage B-deferred S3 artifact design; apply is denied in Stage A\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"scale\" -d \"Benchmark local performance, archive readiness, compaction, and SQLite integrity\"\ncomplete -c todos -n \"__fish_seen_subcommand_from scale\" -a \"report\" -d \"Build a local scale hardening report without network access\"\ncomplete -c todos -n \"__fish_seen_subcommand_from scale\" -a \"compact\" -d \"Preview or apply local SQLite optimization and VACUUM compaction\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"webhooks\" -d \"Manage Hasna event webhook subscriptions\"\ncomplete -c todos -n \"__fish_seen_subcommand_from webhooks\" -a \"add\" -d \"Add or replace a webhook or command subscription\"\ncomplete -c todos -n \"__fish_seen_subcommand_from webhooks\" -a \"list\" -d \"List configured subscriptions\"\ncomplete -c todos -n \"__fish_seen_subcommand_from webhooks\" -a \"status\" -d \"Show events webhook storage status\"\ncomplete -c todos -n \"__fish_seen_subcommand_from webhooks\" -a \"remove\" -d \"Remove a subscription\"\ncomplete -c todos -n \"__fish_seen_subcommand_from webhooks\" -a \"test\" -d \"Send a test event to one subscription\"\ncomplete -c todos -n \"__fish_seen_subcommand_from webhooks\" -a \"match\" -d \"Check whether a sample event matches one subscription without delivering\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"events\" -d \"Emit, list, and replay Hasna events\"\ncomplete -c todos -n \"__fish_seen_subcommand_from events\" -a \"emit\" -d \"Emit an event from this app\"\ncomplete -c todos -n \"__fish_seen_subcommand_from events\" -a \"list\" -d \"List recorded events\"\ncomplete -c todos -n \"__fish_seen_subcommand_from events\" -a \"replay\" -d \"Replay recorded events\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"completions\" -d \"Generate shell completions for bash, zsh, or fish\"\ncomplete -c todos -n \"__fish_use_subcommand\" -a \"manual\" -d \"Print the complete local CLI manual\"\n\n"
};
export const TODOS_CLI_COMMAND_HELP: Readonly<Record<string, string>> = {
  "add": "Usage: todos add [options] <title>\n\nCreate a new task\n\nOptions:\n  -d, --description <text>  Task description\n  -p, --priority <level>    Priority: low, medium, high, critical\n  --parent <id>             Parent task ID\n  -t, --tags <tags>         Comma-separated tags\n  --tag <tags>              Comma-separated tags (alias for --tags)\n  --plan <id>               Assign to a plan\n  --assign <agent>          Assign to agent\n  --status <status>         Initial status\n  --list <id>               Task list ID\n  --task-list <id>          Task list ID (alias for --list)\n  --estimated <minutes>     Estimated time in minutes\n  --sla-minutes <minutes>   SLA minutes before unfinished work is escalated\n  --sla <minutes>           Alias for --sla-minutes\n  --approval                Require approval before completion\n  --recurrence <rule>       Recurrence rule, e.g. 'every day', 'every weekday',\n                            'every 2 weeks'\n  --due <date>              Due date (ISO string or YYYY-MM-DD)\n  --reason <text>           Why this task exists\n  --project <id>            Assign to project by ID or slug (overrides\n                            auto-detect)\n  -h, --help                display help for command\n",
  "task": "Usage: todos task [options] [command]\n\nTask subcommands for deterministic automation\n\nOptions:\n  -h, --help                        display help for command\n\nCommands:\n  upsert [options]                  Create or update a task by stable metadata\n                                    fingerprint\n  route-state [options] <id>        Show deterministic routing eligibility and\n                                    workflow pointers for a task\n  workflow-pointers [options] <id>  Update OpenLoops workflow invocation/run\n                                    artifact pointers on a task\n  help [command]                    display help for command\n",
  "task upsert": "Usage: todos task upsert [options]\n\nCreate or update a task by stable metadata fingerprint\n\nOptions:\n  --fingerprint <key>              Stable dedupe fingerprint\n  --title <text>                   Task title\n  -d, --description <text>         Task description\n  -p, --priority <level>           Priority: low, medium, high, critical\n  -s, --status <status>            Task status\n  --list <id>                      Task list ID\n  --task-list <id>                 Task list ID (alias for --list)\n  -t, --tags <tags>                Comma-separated tags\n  --tag <tags>                     Comma-separated tags (alias for --tags)\n  --metadata-json <json>           JSON object merged into task metadata\n  --working-dir <path>             Working directory to store on create/update\n  --project <id>                   Assign to project by ID, slug, or path\n  --assign <agent>                 Assign to agent\n  --expectation-id <id>            Expectation metadata ID\n  --expectation-fingerprint <key>  Expectation metadata fingerprint\n  --evidence-paths <paths>         Comma-separated evidence paths\n  --origin-loop-id <id>            Origin loop ID\n  --origin-run-id <id>             Origin run ID\n  --expected <json-or-text>        Expected value metadata\n  --observed <json-or-text>        Observed value metadata\n  --acceptance <json-or-text>      Acceptance metadata\n  -h, --help                       display help for command\n",
  "task route-state": "Usage: todos task route-state [options] <id>\n\nShow deterministic routing eligibility and workflow pointers for a task\n\nOptions:\n  --verify-project-root  Filesystem-check the resolved project root and surface\n                         missing_project_root before admission\n  -h, --help             display help for command\n",
  "task workflow-pointers": "Usage: todos task workflow-pointers [options] <id>\n\nUpdate OpenLoops workflow invocation/run artifact pointers on a task\n\nOptions:\n  --invocation <id>    Current workflow invocation ID\n  --run <id>           Current workflow run ID\n  --manifest <path>    Latest run manifest path\n  --evaluation <path>  Latest evaluator artifact path\n  --state <state>      Human-visible workflow state\n  --actor <agent>      Agent or workflow updating the pointers\n  --clear              Clear all workflow pointers before applying explicit\n                       pointer values\n  --clear-invocation   Clear current workflow invocation ID\n  --clear-run          Clear current workflow run ID\n  --clear-manifest     Clear latest run manifest path\n  --clear-evaluation   Clear latest evaluator artifact path\n  --clear-state        Clear human-visible workflow state\n  -h, --help           display help for command\n",
  "list": "Usage: todos list [options]\n\nList tasks\n\nOptions:\n  -s, --status <status>      Filter by status\n  -p, --priority <priority>  Filter by priority\n  --assigned <agent>         Filter by assigned agent\n  --tags <tags>              Filter by tags (comma-separated)\n  --tag <tags>               Filter by tags (alias for --tags)\n  -a, --all                  Show all tasks (including completed/cancelled)\n  --list <ref>               Filter by task list UUID, unique UUID prefix, or\n                             project-scoped slug\n  --task-list <ref>          Filter by task list UUID, unique UUID prefix, or\n                             project-scoped slug (alias for --list)\n  --project-name <name>      Filter by project name\n  --agent-name <name>        Filter by agent name/assigned\n  --sort <field>             Sort by: updated, created, priority, status\n  --format <fmt>             Output format: table (default), compact, csv, json\n  --due-today                Only tasks due today or earlier\n  --overdue                  Only overdue tasks (past due_at)\n  --recurring                Only recurring tasks\n  --limit <n>                Max tasks to return\n  -h, --help                 display help for command\n",
  "count": "Usage: todos count [options]\n\nShow task count by status\n\nOptions:\n  -h, --help  display help for command\n",
  "show": "Usage: todos show [options] <id>\n\nShow full task details\n\nOptions:\n  -h, --help  display help for command\n",
  "inspect": "Usage: todos inspect [options] [id]\n\nFull orientation for a task — details, description, dependencies, blocker,\nfiles, commits, comments. If no ID given, shows current in-progress task for\n--agent.\n\nOptions:\n  -h, --help  display help for command\n",
  "history": "Usage: todos history [options] <id>\n\nShow change history for a task (audit log)\n\nOptions:\n  -h, --help  display help for command\n",
  "update": "Usage: todos update [options] <id>\n\nUpdate a task\n\nOptions:\n  --title <text>             New title\n  -d, --description <text>   New description\n  -s, --status <status>      New status\n  -p, --priority <priority>  New priority\n  --assign <agent>           Assign to agent\n  --tags <tags>              New tags (comma-separated)\n  --tag <tags>               New tags (alias for --tags)\n  --list <id>                Move to a task list (UUID authoritative;\n                             project-scoped slug accepted)\n  --task-list <id>           Move to a task list (alias for --list)\n  --clear-list               Detach from its task list (reset task_list_id to\n                             null)\n  --working-dir <path>       Repair the task's working_dir to a specific path\n                             (routing metadata)\n  --clear-working-dir        Reset the task's working_dir to null (undo path for\n                             routing repairs)\n  --plan <id>                Move to a plan\n  --clear-plan               Remove from its current plan\n  --estimated <minutes>      Estimated time in minutes\n  --sla-minutes <minutes>    SLA minutes before unfinished work is escalated\n  --sla <minutes>            Alias for --sla-minutes\n  --due <date>               Due date (ISO string or YYYY-MM-DD), empty to clear\n  --recurrence <rule>        Recurrence rule, empty to clear\n  --approval                 Require approval before completion\n  --clear-approval           Remove the approval requirement\n  -h, --help                 display help for command\n",
  "done": "Usage: todos done [options] <id>\n\nMark a task as completed\n\nOptions:\n  --attach-ids <ids>        Comma-separated @hasna/attachments IDs to link as\n                            evidence\n  --files-changed <files>   Comma-separated list of files changed\n  --test-results <results>  Test results summary\n  --commit-hash <hash>      Git commit hash\n  --notes <notes>           Completion notes\n  --confidence <0-1>        Agent's confidence 0.0-1.0 that the task is fully\n                            complete (default: 1.0, <0.7 flagged for review)\n  -h, --help                display help for command\n",
  "approve": "Usage: todos approve [options] <id>\n\nApprove a task that requires approval\n\nOptions:\n  -h, --help  display help for command\n",
  "start": "Usage: todos start [options] <id>\n\nClaim, lock, and start a task\n\nOptions:\n  -h, --help  display help for command\n",
  "lock": "Usage: todos lock [options] <id>\n\nAcquire exclusive lock on a task\n\nOptions:\n  -h, --help  display help for command\n",
  "unlock": "Usage: todos unlock [options] <id>\n\nRelease lock on a task\n\nOptions:\n  -h, --help  display help for command\n",
  "delete": "Usage: todos delete [options] <id>\n\nDelete a task\n\nOptions:\n  -h, --help  display help for command\n",
  "remove": "Usage: todos remove [options] <id>\n\nRemove/delete a task (alias for delete)\n\nOptions:\n  -h, --help  display help for command\n",
  "bulk": "Usage: todos bulk [options] <action> <ids...>\n\nBulk operation on multiple tasks (done, start, delete, plan)\n\nOptions:\n  --plan <id>   Plan ID for the plan/move-plan action\n  --clear-plan  Remove plan assignment for the plan/move-plan action\n  -h, --help    display help for command\n",
  "plans": "Usage: todos plans [options]\n\nList and manage plans\n\nOptions:\n  --add <name>              Create a plan\n  --slug <slug>             Readable plan slug (with --add)\n  -d, --description <text>  Plan description (with --add)\n  --show <id-or-slug>       Show plan details with its tasks\n  --artifact <id-or-slug>   Show local Markdown artifact diagnostics for a plan\n  --write-artifacts         Write local Markdown artifacts for all\n                            project-scoped plans in scope\n  --delete <id>             Delete a plan\n  --complete <id>           Mark a plan as completed\n  -h, --help                display help for command\n",
  "templates": "Usage: todos templates [options]\n\nList and manage task templates\n\nOptions:\n  --add <name>              Create a template\n  --title <pattern>         Title pattern (with --add)\n  -d, --description <text>  Default description\n  -p, --priority <level>    Default priority\n  -t, --tags <tags>         Default tags (comma-separated)\n  --delete <id>             Delete a template\n  --update <id>             Update a template\n  --use <id>                Create a task from a template\n  --var <vars...>           Variable substitutions: key=value (e.g. --var\n                            feature=login)\n  -h, --help                display help for command\n",
  "template-init": "Usage: todos template-init|templates-init [options]\n\nInitialize the bundled local template library\n\nOptions:\n  -h, --help  display help for command\n",
  "templates-init": "Usage: todos template-init|templates-init [options]\n\nInitialize the bundled local template library\n\nOptions:\n  -h, --help  display help for command\n",
  "template-library": "Usage: todos template-library|templates-library [options]\n\nList, show, or write the bundled local template library as editable JSON files\n\nOptions:\n  --show <name>  Show one bundled template as JSON\n  --write <dir>  Write all bundled templates to editable JSON files\n  -h, --help     display help for command\n",
  "templates-library": "Usage: todos template-library|templates-library [options]\n\nList, show, or write the bundled local template library as editable JSON files\n\nOptions:\n  --show <name>  Show one bundled template as JSON\n  --write <dir>  Write all bundled templates to editable JSON files\n  -h, --help     display help for command\n",
  "template-preview": "Usage: todos template-preview|templates-preview [options] <id>\n\nPreview a template without creating tasks — shows resolved titles, deps, and\npriorities\n\nOptions:\n  --var <vars...>  Variable substitution in key=value format (e.g. --var\n                   name=invoices)\n  -h, --help       display help for command\n",
  "templates-preview": "Usage: todos template-preview|templates-preview [options] <id>\n\nPreview a template without creating tasks — shows resolved titles, deps, and\npriorities\n\nOptions:\n  --var <vars...>  Variable substitution in key=value format (e.g. --var\n                   name=invoices)\n  -h, --help       display help for command\n",
  "template-export": "Usage: todos template-export|templates-export [options] <id>\n\nExport a template as JSON to stdout\n\nOptions:\n  -h, --help  display help for command\n",
  "templates-export": "Usage: todos template-export|templates-export [options] <id>\n\nExport a template as JSON to stdout\n\nOptions:\n  -h, --help  display help for command\n",
  "template-import": "Usage: todos template-import|templates-import [options] [file]\n\nImport a template from a JSON file\n\nOptions:\n  --file <path>  Path to template JSON file (alternative to positional arg)\n  -h, --help     display help for command\n",
  "templates-import": "Usage: todos template-import|templates-import [options] [file]\n\nImport a template from a JSON file\n\nOptions:\n  --file <path>  Path to template JSON file (alternative to positional arg)\n  -h, --help     display help for command\n",
  "template-history": "Usage: todos template-history|templates-history [options] <id>\n\nShow version history of a template\n\nOptions:\n  -h, --help  display help for command\n",
  "templates-history": "Usage: todos template-history|templates-history [options] <id>\n\nShow version history of a template\n\nOptions:\n  -h, --help  display help for command\n",
  "project-bootstrap": "Usage: todos project-bootstrap [options] [path]\n\nDiscover a local workspace and initialize project task state\n\nOptions:\n  --name <name>       Project display name\n  --task-list <slug>  Default task list slug\n  --route-enabled     Mark the default task list as eligible for OpenLoops\n                      task-created routing\n  --dry-run           Show discovery without writing local state\n  -h, --help          display help for command\n",
  "comment": "Usage: todos comment|log-progress [options] <id> <text>\n\nAdd a comment to a task (alias: log-progress, for recording intermediate\nprogress)\n\nOptions:\n  --pct <percent>  Progress percentage (0-100) to record alongside the note\n  -h, --help       display help for command\n",
  "log-progress": "Usage: todos comment|log-progress [options] <id> <text>\n\nAdd a comment to a task (alias: log-progress, for recording intermediate\nprogress)\n\nOptions:\n  --pct <percent>  Progress percentage (0-100) to record alongside the note\n  -h, --help       display help for command\n",
  "search": "Usage: todos search [options] <query>\n\nSearch local tasks, or run/save a cross-entity search view\n\nOptions:\n  --status <status>            Filter by status\n  --priority <p>               Filter by priority\n  --assigned <agent>           Filter by assigned agent\n  --agent-id <agent>           Filter by creator/run/comment agent\n  --task-list <id>             Filter by task list\n  --plan <id>                  Filter by plan\n  --task <id>                  Filter runs/comments by task\n  --tag <tag>                  Filter by task tag (repeatable or\n                               comma-separated) (default: [])\n  --field-label <label>        Filter by local field label (repeatable or\n                               comma-separated) (default: [])\n  --field-owner <owner>        Filter by local field owner\n  --field-area <area>          Filter by local field area\n  --field-severity <severity>  Filter by local field severity\n  --field-custom <json>        Filter by local custom fields as JSON\n  --since <date>               Only tasks updated after this date (ISO)\n  --created-after <date>       Only records created after this date (ISO)\n  --blocked                    Only blocked tasks (incomplete dependencies)\n  --has-deps                   Only tasks with dependencies\n  --depends-on <id>            Only tasks that depend on a task\n  --blocks <id>                Only tasks that block a task\n  --scope <scope>              Search scope: tasks, projects, plans, runs,\n                               comments, all (default: \"tasks\")\n  --limit <n>                  Maximum results (default: \"100\")\n  --filter <json>              Merge an advanced saved-search filter JSON object\n  --save-as <name>             Save this search as a named view\n  --description <text>         Saved view description\n  --all-projects               Do not auto-scope the search to the current\n                               project\n  -h, --help                   display help for command\n",
  "views": "Usage: todos views [options] [command]\n\nManage local saved search views\n\nOptions:\n  -h, --help             display help for command\n\nCommands:\n  save [options] <name>  Save a local search view\n  list [options]         List local saved search views\n  run <name>             Run a local saved search view\n  delete <name>          Delete a local saved search view\n  help [command]         display help for command\n",
  "views save": "Usage: todos views save [options] <name>\n\nSave a local search view\n\nOptions:\n  --query <query>              Search query\n  --scope <scope>              Search scope: tasks, projects, plans, runs,\n                               comments, all (default: \"tasks\")\n  --description <text>         Description\n  --status <status>            Filter by status\n  --priority <p>               Filter by priority\n  --assigned <agent>           Filter by assigned agent\n  --agent-id <agent>           Filter by creator/run/comment agent\n  --task-list <id>             Filter by task list\n  --plan <id>                  Filter by plan\n  --task <id>                  Filter runs/comments by task\n  --tag <tag>                  Filter by task tag (repeatable or\n                               comma-separated) (default: [])\n  --field-label <label>        Filter by local field label (repeatable or\n                               comma-separated) (default: [])\n  --field-owner <owner>        Filter by local field owner\n  --field-area <area>          Filter by local field area\n  --field-severity <severity>  Filter by local field severity\n  --field-custom <json>        Filter by local custom fields as JSON\n  --since <date>               Only records updated after this date (ISO)\n  --created-after <date>       Only records created after this date (ISO)\n  --blocked                    Only blocked tasks\n  --has-deps                   Only tasks with dependencies\n  --depends-on <id>            Only tasks that depend on a task\n  --blocks <id>                Only tasks that block a task\n  --limit <n>                  Maximum results (default: \"100\")\n  --filter <json>              Merge an advanced saved-search filter JSON object\n  --all-projects               Do not auto-scope the view to the current project\n  -h, --help                   display help for command\n",
  "views list": "Usage: todos views list [options]\n\nList local saved search views\n\nOptions:\n  --scope <scope>  Filter by scope\n  -h, --help       display help for command\n",
  "views run": "Usage: todos views run [options] <name>\n\nRun a local saved search view\n\nOptions:\n  -h, --help  display help for command\n",
  "views delete": "Usage: todos views delete [options] <name>\n\nDelete a local saved search view\n\nOptions:\n  -h, --help  display help for command\n",
  "deps": "Usage: todos deps [options] <id>\n\nManage task dependencies\n\nOptions:\n  --needs <dep-id>         Add dependency (this task needs dep-id)\n  --remove <dep-id>        Remove dependency\n  --graph                  Show the dependency graph instead of direct edges\n  --direction <direction>  Graph direction: up, down, or both (default: \"both\")\n  -h, --help               display help for command\n",
  "projects": "Usage: todos projects [options]\n\nList and manage projects\n\nOptions:\n  --add <path>            Register a project by path\n  --show <project>        Resolve and show a project\n  --update <project>      Update a project's name, path, or description\n  --deregister <project>  Deregister a project without deleting its tasks;\n                          refuses projects with incomplete tasks\n  --path-prefix <prefix>  Require deregistered project path to start with this\n                          prefix\n  --dry-run               Show what would change without modifying local state\n  --name <name>           Project name (with --add)\n  --path <path>           Project path (with --update)\n  --description <text>    Project description (with --add or --update)\n  --task-list-id <id>     Custom task list ID (with --add)\n  -h, --help              display help for command\n",
  "project-panel": "Usage: todos project-panel [options]\n\nEmit a contract-valid project dashboard panel for todos\n\nOptions:\n  --project <project>  Project path, id, task-list slug, or name. Defaults to\n                       the detected project\n  --limit <n>          Maximum panel items/resources (default: \"20\")\n  --contract           Emit hasna.project_panel.v1 contract JSON\n  -j, --json           Output JSON\n  -h, --help           display help for command\n",
  "project-rename": "Usage: todos project-rename [options] <id-or-slug> <new-slug>\n\nRename a project slug. Cascades to matching task lists. Task prefixes (e.g.\nAPP-00001) are unchanged.\n\nOptions:\n  --name <name>  Also update the project display name\n  -j, --json     Output as JSON\n  -h, --help     display help for command\n",
  "projects-path": "Usage: todos projects-path [options] [command]\n\nManage machine-local path overrides for projects\n\nOptions:\n  -h, --help                         display help for command\n\nCommands:\n  set [options] <project-id> <path>  Set the local path for a project on this\n                                     machine\n  list [options] <project-id>        List all machine path overrides for a\n                                     project\n  remove [options] <project-id>      Remove the local path override for a\n                                     project on this machine\n  help [command]                     display help for command\n",
  "projects-path set": "Usage: todos projects-path set [options] <project-id> <path>\n\nSet the local path for a project on this machine\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "projects-path list": "Usage: todos projects-path list [options] <project-id>\n\nList all machine path overrides for a project\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "projects-path remove": "Usage: todos projects-path remove [options] <project-id>\n\nRemove the local path override for a project on this machine\n\nOptions:\n  --machine <id>  Machine ID to remove override for (default: this machine)\n  -h, --help      display help for command\n",
  "extract": "Usage: todos extract [options] <path>\n\nExtract TODO/FIXME/HACK/BUG/XXX/NOTE comments from source files and create tasks\n\nOptions:\n  --dry-run             Show extracted comments without creating tasks\n  --pattern <tags>      Comma-separated tags to look for (default:\n                        TODO,FIXME,HACK,XXX,BUG,NOTE)\n  -t, --tags <tags>     Extra comma-separated tags to add to created tasks\n  --assign <agent>      Assign extracted tasks to an agent\n  --list <id>           Task list ID\n  --ext <extensions>    Comma-separated file extensions to scan (e.g. ts,py,go)\n  --exclude <patterns>  Comma-separated gitignore-style path patterns to skip\n  --no-gitignore        Do not read .gitignore from the scanned root\n  --index               Include a local source index in JSON output\n  -h, --help            display help for command\n",
  "extract-watch": "Usage: todos extract-watch [options] <path>\n\nPoll a local source tree for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create\ntasks\n\nOptions:\n  --dry-run             Show extracted comments without creating tasks\n  --once                Run a single watcher scan and exit (default: true)\n  --max-runs <n>        Maximum watcher scans before exiting\n  --interval <ms>       Polling interval in milliseconds (default: \"2000\")\n  --pattern <tags>      Comma-separated tags to look for\n  -t, --tags <tags>     Extra comma-separated tags to add to created tasks\n  --assign <agent>      Assign extracted tasks to an agent\n  --list <id>           Task list ID\n  --ext <extensions>    Comma-separated file extensions to scan\n  --exclude <patterns>  Comma-separated gitignore-style path patterns to skip\n  --no-gitignore        Do not read .gitignore from the watched root\n  -h, --help            display help for command\n",
  "export": "Usage: todos export [options]\n\nExport tasks\n\nOptions:\n  -f, --format <format>        Format: json, md, todos.md, or bridge (default:\n                               \"json\")\n  -o, --output <path>          Write export output to a file\n  --encrypt                    Encrypt bridge exports with a local encryption\n                               profile\n  --encryption-profile <name>  Encryption profile name (default: \"default\")\n  --allow-plaintext-sensitive  Suppress plaintext bridge export warning\n  -h, --help                   display help for command\n",
  "bridge-import": "Usage: todos bridge-import [options] <file>\n\nDry-run or apply a local hasna/todos bridge export bundle\n\nOptions:\n  --apply              Apply the import. Defaults to dry-run.\n  --decrypt            Decrypt an encrypted bridge export before importing\n  --resolve-conflicts  Safely merge existing local tasks by filling blank\n                       fields, unioning tags, and recording unresolved\n                       divergences\n  -h, --help           display help for command\n",
  "todos-md-import": "Usage: todos todos-md-import|markdown-import [options] <file>\n\nDry-run or apply a local todos.md Markdown import\n\nOptions:\n  --apply              Apply the import. Defaults to dry-run.\n  --resolve-conflicts  Safely merge embedded bridge task conflicts while\n                       preserving local divergent fields\n  -h, --help           display help for command\n",
  "markdown-import": "Usage: todos todos-md-import|markdown-import [options] <file>\n\nDry-run or apply a local todos.md Markdown import\n\nOptions:\n  --apply              Apply the import. Defaults to dry-run.\n  --resolve-conflicts  Safely merge embedded bridge task conflicts while\n                       preserving local divergent fields\n  -h, --help           display help for command\n",
  "import-md": "Usage: todos todos-md-import|markdown-import [options] <file>\n\nDry-run or apply a local todos.md Markdown import\n\nOptions:\n  --apply              Apply the import. Defaults to dry-run.\n  --resolve-conflicts  Safely merge embedded bridge task conflicts while\n                       preserving local divergent fields\n  -h, --help           display help for command\n",
  "sync": "Usage: todos sync [options]\n\nSync tasks with an agent task list (Claude uses native task list; others use\nJSON lists)\n\nOptions:\n  --task-list <id>  Task list ID (Claude auto-detects from\n                    CLAUDE_CODE_TASK_LIST_ID or CLAUDE_CODE_SESSION_ID)\n  --agent <name>    Agent/provider to sync (default: claude)\n  --all             Sync across all configured agents (TODOS_SYNC_AGENTS or\n                    default: claude,codex,gemini)\n  --push            One-way: push SQLite tasks to agent task list\n  --pull            One-way: pull agent task list into SQLite\n  --prefer <side>   Conflict strategy: local or remote (default: \"remote\")\n  -h, --help        display help for command\n",
  "init": "Usage: todos init [options] <name>\n\nRegister an agents and get a short UUID\n\nOptions:\n  -d, --description <text>  Agent description\n  -h, --help                display help for command\n",
  "heartbeat": "Usage: todos heartbeat [options] [agent]\n\nUpdate last_seen_at to signal you're still active\n\nOptions:\n  -h, --help  display help for command\n",
  "release": "Usage: todos release [options] [agent]\n\nRelease/logout an agent — clears session binding so the name is immediately\navailable\n\nOptions:\n  --session-id <id>  Only release if session ID matches\n  -h, --help         display help for command\n",
  "focus": "Usage: todos focus [options] [project]\n\nFocus on a project (or clear focus if no project given)\n\nOptions:\n  -h, --help  display help for command\n",
  "agents": "Usage: todos agents [options]\n\nList registered agents\n\nOptions:\n  -h, --help  display help for command\n",
  "agents-normalize": "Usage: todos agents-normalize|normalize-agents [options]\n\nRename invalid/generated agent names (agent, agent-1, name-2, two-word names) to\nsafe one-word names\n\nOptions:\n  -h, --help  display help for command\n",
  "normalize-agents": "Usage: todos agents-normalize|normalize-agents [options]\n\nRename invalid/generated agent names (agent, agent-1, name-2, two-word names) to\nsafe one-word names\n\nOptions:\n  -h, --help  display help for command\n",
  "agent-update": "Usage: todos agent-update|agents-update [options] <name>\n\nUpdate an agent's description, role, or other fields\n\nOptions:\n  --description <text>  New description\n  --role <role>         New role\n  --title <title>       New title\n  -h, --help            display help for command\n",
  "agents-update": "Usage: todos agent-update|agents-update [options] <name>\n\nUpdate an agent's description, role, or other fields\n\nOptions:\n  --description <text>  New description\n  --role <role>         New role\n  --title <title>       New title\n  -h, --help            display help for command\n",
  "agent": "Usage: todos agent [options] <name>\n\nShow all info about an agent: tasks, status, last seen, stats\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "org": "Usage: todos org [options]\n\nShow agent org chart — who reports to who\n\nOptions:\n  --set <agent=manager>  Set reporting: 'seneca=julius' or 'seneca=' to clear\n  -h, --help             display help for command\n",
  "lists": "Usage: todos lists|task-lists [options]\n\nList and manage task lists\n\nOptions:\n  --add <name>              Create a task list\n  --show <id>               Resolve and show a task list\n  --update <id>             Update a task list\n  --name <name>             Name (with --update)\n  --slug <slug>             Custom slug (with --add or --update)\n  -d, --description <text>  Description (with --add or --update)\n  --delete <id>             Delete a task list\n  -h, --help                display help for command\n",
  "task-lists": "Usage: todos lists|task-lists [options]\n\nList and manage task lists\n\nOptions:\n  --add <name>              Create a task list\n  --show <id>               Resolve and show a task list\n  --update <id>             Update a task list\n  --name <name>             Name (with --update)\n  --slug <slug>             Custom slug (with --add or --update)\n  -d, --description <text>  Description (with --add or --update)\n  --delete <id>             Delete a task list\n  -h, --help                display help for command\n",
  "tl": "Usage: todos lists|task-lists [options]\n\nList and manage task lists\n\nOptions:\n  --add <name>              Create a task list\n  --show <id>               Resolve and show a task list\n  --update <id>             Update a task list\n  --name <name>             Name (with --update)\n  --slug <slug>             Custom slug (with --add or --update)\n  -d, --description <text>  Description (with --add or --update)\n  --delete <id>             Delete a task list\n  -h, --help                display help for command\n",
  "upgrade": "Usage: todos upgrade|self-update [options]\n\nUpdate todos to the latest version\n\nOptions:\n  --check     Only check for updates, don't install\n  -h, --help  display help for command\n",
  "self-update": "Usage: todos upgrade|self-update [options]\n\nUpdate todos to the latest version\n\nOptions:\n  --check     Only check for updates, don't install\n  -h, --help  display help for command\n",
  "config": "Usage: todos config [options]\n\nView or update configuration\n\nOptions:\n  --get <key>        Get a config value\n  --set <key=value>  Set a config value (e.g. completion_guard.enabled=true)\n  -h, --help         display help for command\n",
  "encryption": "Usage: todos encryption [options] [command]\n\nManage local encryption profiles for fields and secure exports\n\nOptions:\n  -h, --help             display help for command\n\nCommands:\n  list                   List local encryption profiles\n  set [options] <name>   Create or update a local encryption profile\n  status [name]          Show whether a local encryption profile is locked or\n                         unlocked\n  remove <name>          Remove a local encryption profile\n  test [options] [name]  Encrypt and decrypt a local test payload without\n                         storing key material\n  help [command]         display help for command\n",
  "encryption list": "Usage: todos encryption list [options]\n\nList local encryption profiles\n\nOptions:\n  -h, --help  display help for command\n",
  "encryption set": "Usage: todos encryption set [options] <name>\n\nCreate or update a local encryption profile\n\nOptions:\n  --key-env <name>      Environment variable that supplies the encryption key\n                        (default: \"TODOS_ENCRYPTION_KEY\")\n  --description <text>  Profile description\n  -h, --help            display help for command\n",
  "encryption status": "Usage: todos encryption status [options] [name]\n\nShow whether a local encryption profile is locked or unlocked\n\nOptions:\n  -h, --help  display help for command\n",
  "encryption remove": "Usage: todos encryption remove [options] <name>\n\nRemove a local encryption profile\n\nOptions:\n  -h, --help  display help for command\n",
  "encryption test": "Usage: todos encryption test [options] [name]\n\nEncrypt and decrypt a local test payload without storing key material\n\nOptions:\n  --text <text>  Payload text (default: \"hasna/todos encryption test\")\n  -h, --help     display help for command\n",
  "redaction": "Usage: todos redaction [options] [command]\n\nManage local secret redaction patterns and scans\n\nOptions:\n  -h, --help             display help for command\n\nCommands:\n  status                 Show local secret redaction configuration\n  add [options]          Add local secret redaction regex patterns or object key\n                         names\n  scan [options] [text]  Scan text or a file for secret-like values without\n                         printing values\n  help [command]         display help for command\n",
  "redaction status": "Usage: todos redaction status [options]\n\nShow local secret redaction configuration\n\nOptions:\n  -h, --help  display help for command\n",
  "redaction add": "Usage: todos redaction add [options]\n\nAdd local secret redaction regex patterns or object key names\n\nOptions:\n  --pattern <list>  Comma-separated regex patterns to redact from text\n  --key <list>      Comma-separated metadata/object key names to redact\n  -h, --help        display help for command\n",
  "redaction scan": "Usage: todos redaction scan [options] [text]\n\nScan text or a file for secret-like values without printing values\n\nOptions:\n  --file <path>  File to scan\n  -h, --help     display help for command\n",
  "retention": "Usage: todos retention [options] [command]\n\nPreview or apply local retention cleanup for old comments, runs, verification\nevidence, and expired artifact files\n\nOptions:\n  -h, --help         display help for command\n\nCommands:\n  cleanup [options]  Dry-run by default; add --apply and the exact --confirm\n                     value to delete local retention data\n  help [command]     display help for command\n",
  "retention cleanup": "Usage: todos retention cleanup [options]\n\nDry-run by default; add --apply and the exact --confirm value to delete local\nretention data\n\nOptions:\n  --older-than-days <days>  Prune records older than this many days\n  --project <id>            Project ID to scope cleanup\n  --task-status <list>      Comma-separated task statuses to include\n  --run-status <list>       Comma-separated run statuses to include\n  --include <list>          Comma-separated scopes:\n                            comments,runs,verifications,expired-artifacts\n  --apply                   Apply the cleanup. Without this flag the command\n                            only previews.\n  --confirm <value>         Required exact confirmation for --apply\n  -h, --help                display help for command\n",
  "trust": "Usage: todos trust [options] [command]\n\nManage local workspace trust and permission profiles\n\nOptions:\n  -h, --help              display help for command\n\nCommands:\n  list                    List local workspace trust profiles\n  status [path]           Show local trust status for a workspace path\n  add [options] <path>    Add or update a local workspace trust profile\n  remove <path>           Remove a local workspace trust profile\n  check [options] [path]  Check whether a local command, tool, or write path is\n                          allowed\n  help [command]          display help for command\n",
  "trust list": "Usage: todos trust list [options]\n\nList local workspace trust profiles\n\nOptions:\n  -h, --help  display help for command\n",
  "trust status": "Usage: todos trust status [options] [path]\n\nShow local trust status for a workspace path\n\nOptions:\n  -h, --help  display help for command\n",
  "trust add": "Usage: todos trust add [options] <path>\n\nAdd or update a local workspace trust profile\n\nOptions:\n  --preset <preset>       restricted, readonly, standard, or trusted (default:\n                          \"standard\")\n  --trusted <value>       Override trusted boolean\n  --allow-command <list>  Comma-separated command prefixes or patterns\n  --deny-command <list>   Comma-separated denied command substrings or patterns\n  --tool <list>           Comma-separated tool permission names\n  --write-scope <list>    Comma-separated allowed write scopes relative to the\n                          root\n  --redact-env <list>     Comma-separated environment key patterns to redact\n  --no-prompt             Do not require prompts for unsafe checks\n  -h, --help              display help for command\n",
  "trust remove": "Usage: todos trust remove [options] <path>\n\nRemove a local workspace trust profile\n\nOptions:\n  -h, --help  display help for command\n",
  "trust check": "Usage: todos trust check [options] [path]\n\nCheck whether a local command, tool, or write path is allowed\n\nOptions:\n  --command <command>  Command line to check\n  --tool <tool>        Tool permission to check\n  --write <path>       Write path to check\n  --env <list>         Comma-separated environment keys to test for redaction\n  -h, --help           display help for command\n",
  "sandbox": "Usage: todos sandbox [options] [command]\n\nManage local runner sandbox profiles and dry-run checks\n\nOptions:\n  -h, --help                   display help for command\n\nCommands:\n  list                         List local runner sandbox profiles\n  set [options] <name> [root]  Add or update a local runner sandbox profile\n  remove <name>                Remove a local runner sandbox profile\n  check [options] [name]       Check whether a local runner action is allowed\n  explain [options] [name]     Dry-run explain output for a local runner sandbox\n                               check\n  help [command]               display help for command\n",
  "sandbox list": "Usage: todos sandbox list [options]\n\nList local runner sandbox profiles\n\nOptions:\n  -h, --help  display help for command\n",
  "sandbox set": "Usage: todos sandbox set [options] <name> [root]\n\nAdd or update a local runner sandbox profile\n\nOptions:\n  --allow-command <list>  Comma-separated command prefixes or patterns\n  --deny-command <list>   Comma-separated denied command substrings or patterns\n  --cwd-boundary <path>   Directory boundary for command cwd\n  --write-scope <list>    Comma-separated allowed write scopes relative to the\n                          root\n  --env-allow <list>      Comma-separated environment keys or patterns to pass\n                          through\n  --redact-env <list>     Comma-separated environment key patterns to redact\n  --network <policy>      Network policy: none, local, or full (default: \"none\")\n  --no-approval           Do not require approval when checks fail\n  --no-audit              Do not include audit evidence in check output\n  -h, --help              display help for command\n",
  "sandbox remove": "Usage: todos sandbox remove [options] <name>\n\nRemove a local runner sandbox profile\n\nOptions:\n  -h, --help  display help for command\n",
  "sandbox check": "Usage: todos sandbox check [options] [name]\n\nCheck whether a local runner action is allowed\n\nOptions:\n  --path <path>        Workspace path to evaluate\n  --cwd <path>         Command working directory\n  --command <command>  Command line to check\n  --write <list>       Comma-separated write paths to check\n  --env <list>         Comma-separated environment keys to test\n  --network            Request network access\n  -h, --help           display help for command\n",
  "sandbox explain": "Usage: todos sandbox explain [options] [name]\n\nDry-run explain output for a local runner sandbox check\n\nOptions:\n  --path <path>        Workspace path to evaluate\n  --cwd <path>         Command working directory\n  --command <command>  Command line to check\n  --write <list>       Comma-separated write paths to check\n  --env <list>         Comma-separated environment keys to test\n  --network            Request network access\n  -h, --help           display help for command\n",
  "extensions": "Usage: todos extensions [options] [command]\n\nManage local workflow extension registry\n\nOptions:\n  -h, --help                    display help for command\n\nCommands:\n  list                          List installed local extensions\n  discover [options] [project]  Discover local extension manifests from config\n                                and project .todos folders\n  inspect <source>              Validate a local extension manifest, directory,\n                                or offline bundle without installing it\n  install [options] <source>    Install or update a local extension from a\n                                manifest, directory, or offline bundle\n  compat <source>               Run local CLI/MCP compatibility checks and\n                                runner sandbox dry-runs for an extension\n  verify [options] <source>     Verify a local extension source checksum and\n                                optional signature without installing it\n  remove <name>                 Remove a local extension from the registry\n  help [command]                display help for command\n",
  "extensions list": "Usage: todos extensions list [options]\n\nList installed local extensions\n\nOptions:\n  -h, --help  display help for command\n",
  "extensions discover": "Usage: todos extensions discover [options] [project]\n\nDiscover local extension manifests from config and project .todos folders\n\nOptions:\n  --no-installed  Do not include installed extension registry records\n  -h, --help      display help for command\n",
  "extensions inspect": "Usage: todos extensions inspect [options] <source>\n\nValidate a local extension manifest, directory, or offline bundle without\ninstalling it\n\nOptions:\n  -h, --help  display help for command\n",
  "extensions install": "Usage: todos extensions install [options] <source>\n\nInstall or update a local extension from a manifest, directory, or offline\nbundle\n\nOptions:\n  --trust              Mark the extension trusted immediately\n  --checksum <sha256>  Expected sha256:<hex> checksum for the source manifest or\n                       bundle\n  --signature <value>  Optional detached signature over the checksum\n  --public-key <pem>   Public key PEM string used to verify --signature\n  -h, --help           display help for command\n",
  "extensions compat": "Usage: todos extensions compat [options] <source>\n\nRun local CLI/MCP compatibility checks and runner sandbox dry-runs for an\nextension\n\nOptions:\n  -h, --help  display help for command\n",
  "extensions verify": "Usage: todos extensions verify [options] <source>\n\nVerify a local extension source checksum and optional signature without\ninstalling it\n\nOptions:\n  --checksum <sha256>  Expected sha256:<hex> checksum for the source manifest or\n                       bundle\n  --signature <value>  Optional detached signature over the checksum\n  --public-key <pem>   Public key PEM string used to verify --signature\n  -h, --help           display help for command\n",
  "extensions remove": "Usage: todos extensions remove [options] <name>\n\nRemove a local extension from the registry\n\nOptions:\n  -h, --help  display help for command\n",
  "workflows": "Usage: todos workflows [options] [command]\n\nList and render local guided workflow prompts\n\nOptions:\n  -h, --help           display help for command\n\nCommands:\n  list                 List bundled local workflow prompts\n  show [options] <id>  Render a guided workflow prompt as Markdown or JSON\n  export [options]     Export bundled local workflow prompt metadata\n  help [command]       display help for command\n",
  "workflows list": "Usage: todos workflows list [options]\n\nList bundled local workflow prompts\n\nOptions:\n  -h, --help  display help for command\n",
  "workflows show": "Usage: todos workflows show [options] <id>\n\nRender a guided workflow prompt as Markdown or JSON\n\nOptions:\n  --objective <text>  Objective or goal text\n  --task <id>         Task ID to ground the workflow\n  --agent <name>      Agent identity\n  --context <text>    Additional local context\n  --format <format>   Output format: markdown or json (default: \"markdown\")\n  -h, --help          display help for command\n",
  "workflows export": "Usage: todos workflows export [options]\n\nExport bundled local workflow prompt metadata\n\nOptions:\n  --format <format>  Output format: json or markdown (default: \"json\")\n  -h, --help         display help for command\n",
  "policies": "Usage: todos policies [options] [command]\n\nManage local policy packs for task done gates\n\nOptions:\n  -h, --help                   display help for command\n\nCommands:\n  list                         List local policy packs\n  set [options] <name> [root]  Add or update a local policy pack\n  remove <name>                Remove a local policy pack\n  validate <name> <task-id>    Validate a task against a local policy pack\n  explain <name> <task-id>     Dry-run explain output for local policy-pack\n                               validation\n  help [command]               display help for command\n",
  "policies list": "Usage: todos policies list [options]\n\nList local policy packs\n\nOptions:\n  -h, --help  display help for command\n",
  "policies set": "Usage: todos policies set [options] <name> [root]\n\nAdd or update a local policy pack\n\nOptions:\n  --version <number>             Policy pack version\n  --required-command <list>      Comma-separated passed command patterns\n                                 required for the task\n  --prohibited-command <list>    Comma-separated command patterns that must not\n                                 appear in evidence\n  --prohibited-path <list>       Comma-separated changed file or artifact path\n                                 patterns that must not appear\n  --required-status <list>       Comma-separated allowed task statuses\n  --require-passed-verification  Require at least one passed verification record\n  --require-commit               Require at least one linked commit\n  --require-pr                   Require at least one linked pull request\n  --require-approval             Require task approval fields\n  --require-run                  Require at least one local run ledger\n  --require-artifact             Require at least one verification or run\n                                 artifact\n  --evidence-min <number>        Minimum total evidence record count\n  --branch-pattern <pattern>     Require a linked branch matching a string,\n                                 wildcard, or /regex/\n  -h, --help                     display help for command\n",
  "policies remove": "Usage: todos policies remove [options] <name>\n\nRemove a local policy pack\n\nOptions:\n  -h, --help  display help for command\n",
  "policies validate": "Usage: todos policies validate [options] <name> <task-id>\n\nValidate a task against a local policy pack\n\nOptions:\n  -h, --help  display help for command\n",
  "policies explain": "Usage: todos policies explain [options] <name> <task-id>\n\nDry-run explain output for local policy-pack validation\n\nOptions:\n  -h, --help  display help for command\n",
  "approvals": "Usage: todos approvals [options] [command]\n\nManage local approval gates and manual checkpoints\n\nOptions:\n  -h, --help                          display help for command\n\nCommands:\n  require [options] <task-id> <gate>  Require a local manual approval gate\n                                      before risky work\n  approve [options] <task-id> <gate>  Approve a local approval gate\n  reject [options] <task-id> <gate>   Reject a local approval gate\n  expire [options] <task-id> <gate>   Expire a pending local approval gate\n  check <task-id> <gate>              Check whether a local approval gate allows\n                                      work to proceed\n  list <task-id>                      List local approval gates for a task\n  help [command]                      display help for command\n",
  "approvals require": "Usage: todos approvals require [options] <task-id> <gate>\n\nRequire a local manual approval gate before risky work\n\nOptions:\n  --reviewer <name>   Expected reviewer\n  --requester <name>  Requester or agent creating the gate\n  --reason <text>     Why this gate is required\n  --plan <id>         Related local plan ID\n  --run <id>          Related local run ledger ID\n  --expires-at <iso>  ISO timestamp when this pending gate expires\n  -h, --help          display help for command\n",
  "approvals approve": "Usage: todos approvals approve [options] <task-id> <gate>\n\nApprove a local approval gate\n\nOptions:\n  --reviewer <name>  Reviewer or approver\n  --note <text>      Approval note\n  -h, --help         display help for command\n",
  "approvals reject": "Usage: todos approvals reject [options] <task-id> <gate>\n\nReject a local approval gate\n\nOptions:\n  --reviewer <name>  Reviewer or approver\n  --reason <text>    Rejection reason\n  -h, --help         display help for command\n",
  "approvals expire": "Usage: todos approvals expire [options] <task-id> <gate>\n\nExpire a pending local approval gate\n\nOptions:\n  --reviewer <name>  Reviewer or agent expiring the gate\n  --reason <text>    Expiration reason\n  -h, --help         display help for command\n",
  "approvals check": "Usage: todos approvals check [options] <task-id> <gate>\n\nCheck whether a local approval gate allows work to proceed\n\nOptions:\n  -h, --help  display help for command\n",
  "approvals list": "Usage: todos approvals list [options] <task-id>\n\nList local approval gates for a task\n\nOptions:\n  -h, --help  display help for command\n",
  "event-hooks": "Usage: todos event-hooks [options] [command]\n\nManage local event hooks and automation triggers\n\nOptions:\n  -h, --help             display help for command\n\nCommands:\n  list                   List local event hooks\n  set [options] <name>   Add or update a local event hook\n  remove <name>          Remove a local event hook\n  test [options] <name>  Deliver a test event to one local event hook\n  help [command]         display help for command\n",
  "event-hooks list": "Usage: todos event-hooks list [options]\n\nList local event hooks\n\nOptions:\n  -h, --help  display help for command\n",
  "event-hooks set": "Usage: todos event-hooks set [options] <name>\n\nAdd or update a local event hook\n\nOptions:\n  --event <list>         Comma-separated events, or *\n  --target <target>      stdout, file, socket, or script (default: \"file\")\n  --file <path>          Append JSONL events to this file for file targets\n  --socket <path>        Unix socket path for socket targets\n  --command <command>    Local script command for script targets\n  --cwd <path>           Working directory for script targets\n  --sandbox <name>       Runner sandbox profile used before script execution\n  --env <list>           Comma-separated KEY=value environment entries for\n                         script targets\n  --attempts <number>    Delivery attempts for socket/script targets (default:\n                         \"1\")\n  --backoff-ms <number>  Backoff between retry attempts in milliseconds\n  --disabled             Store hook disabled\n  -h, --help             display help for command\n",
  "event-hooks remove": "Usage: todos event-hooks remove [options] <name>\n\nRemove a local event hook\n\nOptions:\n  -h, --help  display help for command\n",
  "event-hooks test": "Usage: todos event-hooks test [options] <name>\n\nDeliver a test event to one local event hook\n\nOptions:\n  --event <event>   Event type to emit (default: \"task.completed\")\n  --payload <json>  JSON payload for the test event\n  --task <id>       Task ID to include in the payload\n  -h, --help        display help for command\n",
  "terminal-notifications": "Usage: todos terminal-notifications [options] [command]\n\nManage local terminal notification watch rules\n\nOptions:\n  -h, --help             display help for command\n\nCommands:\n  list                   List local terminal notification rules\n  set [options] <name>   Add or update a local terminal notification watch rule\n  remove <name>          Remove a local terminal notification rule\n  test [options] <name>  Evaluate a local terminal notification rule against a\n                         sample event\n  help [command]         display help for command\n",
  "terminal-notifications list": "Usage: todos terminal-notifications list [options]\n\nList local terminal notification rules\n\nOptions:\n  -h, --help  display help for command\n",
  "terminal-notifications set": "Usage: todos terminal-notifications set [options] <name>\n\nAdd or update a local terminal notification watch rule\n\nOptions:\n  --event <list>          Comma-separated events, or *\n  --min-severity <level>  info, warning, or critical (default: \"info\")\n  --format <format>       line or json (default: \"line\")\n  --status <list>         Comma-separated task statuses to match\n  --priority <list>       Comma-separated priorities to match\n  --agent <list>          Comma-separated agent IDs to match\n  --project <list>        Comma-separated project IDs to match\n  --contains <list>       Comma-separated payload text fragments to match\n  --quiet-hours <range>   Suppress notifications during HH:MM-HH:MM\n  --quiet-timezone <tz>   Quiet hours timezone: local or utc (default: \"local\")\n  --bell                  Ring the terminal bell for critical matches\n  --disabled              Store rule disabled\n  -h, --help              display help for command\n",
  "terminal-notifications remove": "Usage: todos terminal-notifications remove [options] <name>\n\nRemove a local terminal notification rule\n\nOptions:\n  -h, --help  display help for command\n",
  "terminal-notifications test": "Usage: todos terminal-notifications test [options] <name>\n\nEvaluate a local terminal notification rule against a sample event\n\nOptions:\n  --event <event>    Event type to emit (default: \"task.failed\")\n  --payload <json>   JSON payload for the test event\n  --task <id>        Task ID to include in the payload\n  --timestamp <iso>  Timestamp to use for quiet-hours evaluation\n  -h, --help         display help for command\n",
  "serve": "Usage: todos serve [options]\n\nStart the web dashboard\n\nOptions:\n  --port <port>    Port number (default: \"19427\")\n  --host <host>    Host to bind (default: 127.0.0.1 localhost only, use 0.0.0.0\n                   for all interfaces)\n  --api-key <key>  Require this API key for /api/* requests\n  --no-open        Don't open browser automatically\n  -h, --help       display help for command\n",
  "watch": "Usage: todos watch [options]\n\nLive-updating task list (refreshes every few seconds)\n\nOptions:\n  -s, --status <status>     Filter by status (default: pending,in_progress)\n  -i, --interval <seconds>  Refresh interval in seconds (default: \"5\")\n  -h, --help                display help for command\n",
  "stream": "Usage: todos stream [options]\n\nSubscribe to real-time task events via SSE (requires todos serve)\n\nOptions:\n  --agent <id>     Filter to events for a specific agent\n  --events <list>  Comma-separated event types (default: all) (default:\n                   \"task.created,task.started,task.completed,task.failed,task.assigned,task.status_changed\")\n  --port <n>       Server port (default: \"3000\")\n  --json           Output raw JSON events\n  -h, --help       display help for command\n",
  "interactive": "Usage: todos interactive [options]\n\nLaunch interactive TUI\n\nOptions:\n  -h, --help  display help for command\n",
  "blame": "Usage: todos blame [options] <file>\n\nShow which tasks/agents touched a file and why — combines task_files +\ntask_commits\n\nOptions:\n  -h, --help  display help for command\n",
  "dashboard": "Usage: todos dashboard [options]\n\nLive-updating dashboard showing project health, agents, task flow\n\nOptions:\n  --project <id>     Filter to project\n  --refresh <ms>     Refresh interval in ms (default: 2000) (default: \"2000\")\n  --snapshot         Print a deterministic local dashboard snapshot instead of\n                     launching the TUI\n  --view <view>      Snapshot/TUI view: overview, projects, tasks, plans, runs,\n                     dependencies, inbox, search (default: \"overview\")\n  --search <query>   Populate the search view with a local task search\n  --limit <n>        Rows per dashboard section in snapshot mode (default: \"8\")\n  --format <format>  Snapshot format: markdown or json (default: \"markdown\")\n  -j, --json         Output snapshot as JSON\n  -h, --help         display help for command\n",
  "references": "Usage: todos references|refs [options] [command]\n\nResolve local file, symbol, git, plan, run, task, and agent references\n\nOptions:\n  -h, --help                       display help for command\n\nCommands:\n  resolve [options] <mentions...>  Resolve mentions using only local workspace,\n                                   git, and todos state\n  help [command]                   display help for command\n",
  "refs": "Usage: todos references|refs [options] [command]\n\nResolve local file, symbol, git, plan, run, task, and agent references\n\nOptions:\n  -h, --help                       display help for command\n\nCommands:\n  resolve [options] <mentions...>  Resolve mentions using only local workspace,\n                                   git, and todos state\n  help [command]                   display help for command\n",
  "references resolve": "Usage: todos references resolve [options] <mentions...>\n\nResolve mentions using only local workspace, git, and todos state\n\nOptions:\n  --workspace <path>        Workspace root for file, symbol, and git references\n  --max-symbol-matches <n>  Maximum symbol matches per symbol mention (default:\n                            \"20\")\n  -j, --json                Output as JSON\n  -h, --help                display help for command\n",
  "next": "Usage: todos next [options]\n\nShow the best pending task to work on next\n\nOptions:\n  --agent <id>    Prefer tasks assigned to this agent\n  --project <id>  Filter to project\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "claim": "Usage: todos claim [options] <agent>\n\nAtomically claim the best pending task for an agent\n\nOptions:\n  --project <id>       Filter to project\n  --steal-stale        Steal the highest-priority stale task when no pending\n                       task is available\n  --stale-minutes <n>  How long a task must be stale before stealing (default:\n                       30) (default: \"30\")\n  -j, --json           Output as JSON\n  -h, --help           display help for command\n",
  "steal": "Usage: todos steal [options] <agent>\n\nWork-stealing: take the highest-priority stale task from another agent\n\nOptions:\n  --stale-minutes <n>  How long a task must be stale (default: 30) (default:\n                       \"30\")\n  --project <id>       Filter to project\n  -h, --help           display help for command\n",
  "status": "Usage: todos status [options]\n\nShow full project health snapshot\n\nOptions:\n  --agent <id>    Include next task for this agent\n  --project <id>  Filter to project\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "recap": "Usage: todos recap [options]\n\nShow what happened in the last N hours — completed tasks, new tasks, agent\nactivity, blockers\n\nOptions:\n  --hours <n>     Look back N hours (default: 8) (default: \"8\")\n  --project <id>  Filter to project\n  -h, --help      display help for command\n",
  "standup": "Usage: todos standup [options]\n\nGenerate standup notes — completed since yesterday, in progress, blocked.\nGrouped by agent.\n\nOptions:\n  --since <date>  ISO date or 'yesterday' (default: yesterday)\n  --project <id>  Filter to project\n  -h, --help      display help for command\n",
  "fail": "Usage: todos fail [options] <id>\n\nMark a task as failed with optional reason and retry\n\nOptions:\n  --reason <text>  Why it failed\n  --agent <id>     Agent reporting the failure\n  --retry          Auto-create a retry copy\n  -j, --json       Output as JSON\n  -h, --help       display help for command\n",
  "active": "Usage: todos active [options]\n\nShow all currently in-progress tasks\n\nOptions:\n  --project <id>  Filter to project\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "stale": "Usage: todos stale [options]\n\nFind tasks stuck in_progress with no recent activity\n\nOptions:\n  --minutes <n>   Stale threshold in minutes (default: \"30\")\n  --project <id>  Filter to project\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "redistribute": "Usage: todos redistribute [options] <agent>\n\nRelease stale in-progress tasks and claim the best one (work-stealing)\n\nOptions:\n  --max-age <minutes>  Stale threshold in minutes (default: \"60\")\n  --project <id>       Limit to a specific project\n  --limit <n>          Max stale tasks to release\n  -j, --json           Output as JSON\n  -h, --help           display help for command\n",
  "assign": "Usage: todos assign [options] <id> <agent>\n\nAssign a task to an agent\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "unassign": "Usage: todos unassign [options] <id>\n\nRemove task assignment\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "tag": "Usage: todos tag [options] <id> <tag>\n\nAdd a tag to a task\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "untag": "Usage: todos untag [options] <id> <tag>\n\nRemove a tag from a task\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "pin": "Usage: todos pin [options] <id>\n\nEscalate task to critical priority\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "summary": "Usage: todos summary [options]\n\nGenerate a markdown summary of recent task activity\n\nOptions:\n  --days <n>      Days of history to include (default: \"7\")\n  --project <id>  Filter to project\n  --agent <id>    Filter to agent\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "doctor": "Usage: todos doctor [options] [command]\n\nDiagnose and optionally repair local task data issues\n\nOptions:\n  --apply            Apply safe repairs. Defaults to dry-run.\n  --fix              Alias for --apply\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n\nCommands:\n  routing [options]  Diagnose (and with --apply, safely repair) task\n                     routing-metadata drift: working_dir, task_list_id linkage,\n                     invalid paths, cross-repo intent\n",
  "doctor routing": "Usage: todos doctor routing [options]\n\nDiagnose (and with --apply, safely repair) task routing-metadata drift:\nworking_dir, task_list_id linkage, invalid paths, cross-repo intent\n\nOptions:\n  --apply                   Apply safe auto-repairs (working_dir, task_list_id\n                            UUID relink) with per-task comments, a DB backup,\n                            and an undo record. Defaults to dry-run.\n  --fix                     Alias for --apply\n  --project <id>            Scope to a single project (id, slug, or path)\n  --tag <tag>               Scope to tasks carrying this tag\n  --status <statuses>       Comma-separated statuses to inspect (default:\n                            pending,in_progress)\n  --shard <index/total>     Deterministic project-stable one-based shard, e.g.\n                            1/6\n  --include-archived        Include archived tasks\n  --no-verify-project-root  Skip machine-local project-root existence checks\n  --limit <n>               Cap the number of tasks inspected\n  --undo-record <path>      Where to write the undo record when --apply mutates\n  -j, --json                Emit the machine-consumable JSON contract\n                            (todos.routing_doctor.v1)\n  -h, --help                display help for command\n\nExit codes (for OpenLoops / deterministic consumers):\n  0  no findings (clean)\n  1  routing-metadata findings present (drift detected)\n  2  invalid invocation (bad --shard/--status/--project/--limit)\n\nJSON contract: --json emits { schema_version, generated_at, ok, dry_run, scope,\nsummary{inspected,eligible,findings_total,by_category,by_repair_class,safe_auto,\nblockers,unsupported,repaired,repair_failed}, findings[], repairs[] }. Each finding\ncarries repair_class: safe_auto | blocker_human | blocker_cross_repo |\nblocker_invalid_path | unsupported. Only safe_auto findings are ever mutated by --apply.\n",
  "health": "Usage: todos health [options]\n\nCheck todos system health — database, config, connectivity\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "report": "Usage: todos report [options]\n\nAnalytics report: task activity, completion rates, agent breakdown\n\nOptions:\n  --days <n>      Days to include in report (default: \"7\")\n  --project <id>  Filter to project\n  --markdown      Output as markdown\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "today": "Usage: todos today [options]\n\nShow task activity from today\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "yesterday": "Usage: todos yesterday [options]\n\nShow task activity from yesterday\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "mine": "Usage: todos mine [options] <agent>\n\nShow tasks assigned to you, grouped by status\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "blocked": "Usage: todos blocked [options]\n\nShow tasks blocked by incomplete dependencies\n\nOptions:\n  -j, --json      Output as JSON\n  --project <id>  Filter to project\n  -h, --help      display help for command\n",
  "overdue": "Usage: todos overdue [options]\n\nShow tasks past their due date\n\nOptions:\n  -j, --json      Output as JSON\n  --project <id>  Filter to project\n  -h, --help      display help for command\n",
  "sla": "Usage: todos sla [options]\n\nShow overdue or SLA-breached tasks that need escalation\n\nOptions:\n  -j, --json      Output as JSON\n  --project <id>  Filter to project\n  --agent <id>    Filter to assigned agent\n  --limit <n>     Max tasks to show (default: \"50\")\n  -h, --help      display help for command\n",
  "week": "Usage: todos week [options]\n\nShow task activity from the past 7 days\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "burndown": "Usage: todos burndown [options]\n\nShow task completion velocity over the past 7 days\n\nOptions:\n  --days <n>  Number of days (default: \"7\")\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "log": "Usage: todos log [options]\n\nShow recent task activity log (git-log style)\n\nOptions:\n  --limit <n>  Number of entries (default: \"30\")\n  -j, --json   Output as JSON\n  -h, --help   display help for command\n",
  "timeline": "Usage: todos timeline [options]\n\nShow a unified local activity timeline for tasks, projects, plans, or runs\n\nOptions:\n  --task <id>      Filter to a task\n  --project <id>   Filter to a project\n  --plan <id>      Filter to a plan\n  --run <id>       Filter to a run ledger\n  --since <iso>    Only include entries at or after this ISO timestamp\n  --until <iso>    Only include entries at or before this ISO timestamp\n  --limit <n>      Number of entries (default: \"50\")\n  --offset <n>     Entries to skip; omitted starts at the first entry\n  --order <order>  Sort order: asc or desc (default: \"desc\")\n  -j, --json       Output as JSON\n  -h, --help       display help for command\n",
  "ready": "Usage: todos ready [options]\n\nShow all tasks ready to be claimed (pending, unblocked, unlocked)\n\nOptions:\n  -j, --json             Output as JSON\n  --project <id>         Filter to project\n  --limit <n>            Max tasks to show (default: \"20\")\n  --source-root <path>   Read-only source root to scan for .hasna/todos/todos.db\n                         (repeatable) (default: [])\n  --source-store <path>  Read-only todos SQLite store path to scan (repeatable)\n                         (default: [])\n  --include <pattern>    Include source repo/store paths matching substring or\n                         glob (repeatable or comma-separated) (default: [])\n  --exclude <pattern>    Exclude source repo/store paths matching substring or\n                         glob (repeatable or comma-separated) (default: [])\n  -h, --help             display help for command\n",
  "sprint": "Usage: todos sprint [options]\n\nSprint dashboard: in-progress, next up, blockers, and overdue\n\nOptions:\n  -j, --json      Output as JSON\n  --project <id>  Filter to project\n  -h, --help      display help for command\n",
  "reports": "Usage: todos reports [options] [command]\n\nBuild local agent-native reports from tasks, plans, runs, and verification\nevidence\n\nOptions:\n  -h, --help       display help for command\n\nCommands:\n  local [options]  Build a local JSON or Markdown report for agent planning and\n                   standups\n  help [command]   display help for command\n",
  "reports local": "Usage: todos reports local [options]\n\nBuild a local JSON or Markdown report for agent planning and standups\n\nOptions:\n  --project <id>     Filter to project\n  --plan <id>        Filter to plan\n  --agent <id>       Filter to agent or assignee\n  --since <iso>      Only include task, run, and verification activity since\n                     this timestamp\n  --until <iso>      Only include task, run, and verification activity until\n                     this timestamp\n  --limit <n>        Maximum rows per report section (default: \"20\")\n  --format <format>  Output format: json or markdown (default: \"markdown\")\n  -j, --json         Output JSON\n  -h, --help         display help for command\n",
  "handoff": "Usage: todos handoff [options]\n\nCreate or view agent session handoffs\n\nOptions:\n  --create               Create a new handoff\n  --read <id>            Read one handoff by ID or prefix\n  --export <id>          Export one handoff bundle by ID or prefix\n  --import <file>        Import a handoff bundle from a JSON file\n  --output <path>        Write exported handoff bundle to a file\n  --apply                Apply an imported handoff bundle; imports default to\n                         dry-run preview\n  --ack <id>             Acknowledge a handoff as read for an agent\n  --recover              Create a recovery handoff from active stale session\n                         context\n  --agent <name>         Agent name\n  --session <id>         Session ID for handoff or recovery context\n  --summary <text>       Handoff summary\n  --completed <items>    Comma-separated completed items\n  --in-progress <items>  Comma-separated in-progress items\n  --blockers <items>     Comma-separated blockers\n  --next <items>         Comma-separated next steps\n  --tasks <ids>          Comma-separated task IDs or prefixes\n  --files <paths>        Comma-separated relevant files\n  --runs <ids>           Comma-separated run IDs\n  --unread-for <agent>   Only list handoffs not acknowledged by this agent\n  --reason <text>        Recovery reason\n  -j, --json             Output as JSON\n  --limit <n>            Number of handoffs to show (default: \"5\")\n  -h, --help             display help for command\n",
  "priorities": "Usage: todos priorities [options]\n\nShow task counts grouped by priority\n\nOptions:\n  -j, --json      Output as JSON\n  --project <id>  Filter to project\n  -h, --help      display help for command\n",
  "context": "Usage: todos context [options]\n\nSession start context: status, latest handoff, next task, overdue\n\nOptions:\n  --agent <name>  Agent name for handoff lookup\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "release-notes": "Usage: todos release-notes [options]\n\nGenerate local release notes and changelog output from completed tasks\n\nOptions:\n  --project <id>       Project filter\n  --plan <id>          Plan filter\n  --task <ids>         Comma-separated task IDs or prefixes\n  --tag <tag>          Only include completed tasks with a tag\n  --since <iso>        Only include tasks completed at or after this ISO\n                       timestamp\n  --until <iso>        Only include tasks completed at or before this ISO\n                       timestamp\n  --title <text>       Release notes title (default: \"Release Notes\")\n  --version <version>  Release version label\n  --format <format>    Output format: markdown or json (default: \"markdown\")\n  --out <path>         Write output to a local file\n  -j, --json           Output JSON\n  -h, --help           display help for command\n",
  "context-pack": "Usage: todos context-pack [options] <task-id>\n\nBuild a deterministic local agent context pack for a task\n\nOptions:\n  --profile <profile>      Agent profile: codex, claude, takumi, generic\n                           (default: \"generic\")\n  --format <format>        Output format: markdown or json (default: \"markdown\")\n  --run <id>               Limit run evidence to a specific run ID or prefix\n  --comments <n>           Recent comments to include (default: \"8\")\n  --files <n>              Relevant files to include (default: \"24\")\n  --verifications <n>      Verification records to include (default: \"10\")\n  --runs <n>               Run ledgers to include (default: \"3\")\n  --dependencies <n>       Dependencies per direction to include (default: \"12\")\n  --plan-tasks <n>         Plan sibling tasks to include (default: \"20\")\n  --max-text <n>           Max characters for long text fields (default: \"6000\")\n  --summary-chars <n>      Max characters for local omission summaries (default:\n                           \"480\")\n  --token-budget <n>       Approximate token budget for compacting context\n                           locally\n  --include <sections>     Comma-separated sections to include before budgeting\n  --exclude <sections>     Comma-separated sections to omit before budgeting\n  --compact                Render compact Markdown or minified JSON\n  --stale-after-hours <n>  Warn when task state is older than this many hours\n                           (default: \"72\")\n  -h, --help               display help for command\n",
  "calendar": "Usage: todos calendar [options] [command]\n\nList and export local calendar events\n\nOptions:\n  -h, --help               display help for command\n\nCommands:\n  list [options]           List local calendar events from tasks, SLA\n                           thresholds, runs, and local items\n  add [options] <title>    Create a local reminder, milestone, or work block\n  export [options]         Export deterministic local calendar events as ICS\n  import [options] <path>  Import VEVENT entries from an ICS file as local\n                           imported calendar items\n  help [command]           display help for command\n",
  "calendar list": "Usage: todos calendar list [options]\n\nList local calendar events from tasks, SLA thresholds, runs, and local items\n\nOptions:\n  --from <iso>         Start window\n  --to <iso>           End window\n  --project <id>       Project filter\n  --task <id>          Task filter\n  --plan <id>          Plan filter\n  --kind <kind>        Event kind filter\n  --include-completed  Include completed/cancelled tasks\n  --no-runs            Exclude run events\n  --no-sla             Exclude SLA threshold events\n  --no-local           Exclude local calendar items\n  --limit <n>          Max events (default: \"50\")\n  -j, --json           Output JSON\n  -h, --help           display help for command\n",
  "calendar add": "Usage: todos calendar add [options] <title>\n\nCreate a local reminder, milestone, or work block\n\nOptions:\n  --kind <kind>         task_reminder, milestone, work_block, imported (default:\n                        \"work_block\")\n  --start <iso>         Start timestamp\n  --end <iso>           End timestamp\n  --timezone <tz>       Timezone label\n  --project <id>        Project link\n  --task <id>           Task link\n  --plan <id>           Plan link\n  --run <id>            Run link\n  --rrule <rule>        Natural recurrence rule or ICS RRULE\n  --description <text>  Description\n  --metadata <json>     Metadata JSON object\n  -j, --json            Output JSON\n  -h, --help            display help for command\n",
  "calendar export": "Usage: todos calendar export [options]\n\nExport deterministic local calendar events as ICS\n\nOptions:\n  --from <iso>    Start window\n  --to <iso>      End window\n  --project <id>  Project filter\n  --task <id>     Task filter\n  --plan <id>     Plan filter\n  --kind <kind>   Event kind filter\n  --name <text>   Calendar name (default: \"Hasna Todos\")\n  --redact        Redact event summaries and descriptions\n  --out <path>    Write ICS to file\n  -j, --json      Output JSON envelope\n  -h, --help      display help for command\n",
  "calendar import": "Usage: todos calendar import [options] <path>\n\nImport VEVENT entries from an ICS file as local imported calendar items\n\nOptions:\n  -j, --json  Output JSON\n  -h, --help  display help for command\n",
  "notifications": "Usage: todos notifications [options] [command]\n\nCheck local due-date, SLA, stale-task, run, and reminder alerts\n\nOptions:\n  -h, --help       display help for command\n\nCommands:\n  check [options]  Evaluate local notification alerts and optionally emit local\n                   hooks or terminal watch rules\n  help [command]   display help for command\n",
  "notifications check": "Usage: todos notifications check [options]\n\nEvaluate local notification alerts and optionally emit local hooks or terminal\nwatch rules\n\nOptions:\n  --project <id>            Project filter\n  --agent <id>              Agent filter\n  --now <iso>               Evaluation timestamp\n  --due-within-minutes <n>  Warn for tasks and reminders due within this many\n                            minutes (default: \"60\")\n  --stale-minutes <n>       Minutes before an in-progress task is stale\n                            (default: \"30\")\n  --run-since <iso>         Only include completed run alerts at or after this\n                            timestamp\n  --no-runs                 Exclude completed run alerts\n  --no-calendar             Exclude local calendar reminder alerts\n  --emit-hooks              Emit matching local event hooks for generated alerts\n  --terminal                Evaluate terminal notification rules for generated\n                            alerts\n  --quiet-hours <range>     Suppress hook and terminal delivery during\n                            HH:MM-HH:MM\n  --quiet-timezone <tz>     Quiet hours timezone: local or utc (default:\n                            \"local\")\n  --limit <n>               Max alerts (default: \"100\")\n  -j, --json                Output JSON\n  -h, --help                display help for command\n",
  "board": "Usage: todos board [options] [command]\n\nRender local task and plan kanban boards\n\nOptions:\n  -h, --help                        display help for command\n\nCommands:\n  create [options] <name>           Create a local kanban board\n  list [options]                    List local kanban boards\n  show [options] <board>            Render a local kanban board\n  tui [options] <board>             Render a keyboard-oriented terminal board\n                                    snapshot\n  move [options] <board> <card-id>  Move a task or plan card to a lane or\n                                    explicit status\n  export [options] [board]          Export local board definitions as a portable\n                                    JSON bundle\n  import [options] <path>           Import local board definitions from a JSON\n                                    bundle\n  delete [options] <board>          Delete a local board definition\n  help [command]                    display help for command\n",
  "board create": "Usage: todos board create [options] <name>\n\nCreate a local kanban board\n\nOptions:\n  --scope <scope>   Board scope: tasks or plans (default: \"tasks\")\n  --project <id>    Project filter\n  --task-list <id>  Task list filter\n  --plan <id>       Plan filter for task boards\n  --agent <id>      Agent filter\n  --lane <spec...>  Lane spec: Name=status,status[:wip_limit]\n  --filter <json>   Saved board filters as JSON\n  -j, --json        Output JSON\n  -h, --help        display help for command\n",
  "board list": "Usage: todos board list [options]\n\nList local kanban boards\n\nOptions:\n  --scope <scope>  Filter by tasks or plans\n  --project <id>   Filter by project\n  --agent <id>     Filter by agent\n  -j, --json       Output JSON\n  -h, --help       display help for command\n",
  "board show": "Usage: todos board show [options] <board>\n\nRender a local kanban board\n\nOptions:\n  -j, --json  Output JSON snapshot\n  -h, --help  display help for command\n",
  "board tui": "Usage: todos board tui [options] <board>\n\nRender a keyboard-oriented terminal board snapshot\n\nOptions:\n  -j, --json  Output JSON snapshot with key bindings\n  -h, --help  display help for command\n",
  "board move": "Usage: todos board move [options] <board> <card-id>\n\nMove a task or plan card to a lane or explicit status\n\nOptions:\n  --lane <id>        Target lane id or name\n  --status <status>  Explicit target workflow status\n  -j, --json         Output JSON\n  -h, --help         display help for command\n",
  "board export": "Usage: todos board export [options] [board]\n\nExport local board definitions as a portable JSON bundle\n\nOptions:\n  --out <path>  Write bundle to file\n  -j, --json    Output JSON\n  -h, --help    display help for command\n",
  "board import": "Usage: todos board import [options] <path>\n\nImport local board definitions from a JSON bundle\n\nOptions:\n  -j, --json  Output JSON\n  -h, --help  display help for command\n",
  "board delete": "Usage: todos board delete [options] <board>\n\nDelete a local board definition\n\nOptions:\n  -j, --json  Output JSON\n  -h, --help  display help for command\n",
  "time": "Usage: todos time [options] [command]\n\nTrack local task time and focus sessions\n\nOptions:\n  -h, --help                         display help for command\n\nCommands:\n  log [options] <task-id> <minutes>  Log completed local time against a task\n  start [options] [task-id]          Start a local focus session\n  pause [options] <session-id>       Pause an active focus session\n  resume [options] <session-id>      Resume a paused focus session\n  stop [options] <session-id>        Stop a focus session and log task time when\n                                     linked to a task\n  list [options]                     List local focus sessions\n  idle [options]                     Show active focus sessions that need an\n                                     idle prompt\n  report [options]                   Report local actual time against estimates\n  help [command]                     display help for command\n",
  "time log": "Usage: todos time log [options] <task-id> <minutes>\n\nLog completed local time against a task\n\nOptions:\n  --agent <id>        Agent logging the time\n  --run <id>          Run ID to link\n  --started-at <iso>  ISO timestamp when work started\n  --ended-at <iso>    ISO timestamp when work ended\n  --notes <text>      Notes about the work\n  -j, --json          Output JSON\n  -h, --help          display help for command\n",
  "time start": "Usage: todos time start [options] [task-id]\n\nStart a local focus session\n\nOptions:\n  --plan <id>             Plan ID to link\n  --run <id>              Run ID to link\n  --agent <id>            Agent starting the session\n  --title <text>          Focus session title\n  --started-at <iso>      ISO timestamp when focus started\n  --idle-after <minutes>  Prompt when the session has been active this many\n                          minutes\n  --notes <text>          Session notes\n  -j, --json              Output JSON\n  -h, --help              display help for command\n",
  "time pause": "Usage: todos time pause [options] <session-id>\n\nPause an active focus session\n\nOptions:\n  --at <iso>  ISO pause timestamp\n  -j, --json  Output JSON\n  -h, --help  display help for command\n",
  "time resume": "Usage: todos time resume [options] <session-id>\n\nResume a paused focus session\n\nOptions:\n  --at <iso>  ISO resume timestamp\n  -j, --json  Output JSON\n  -h, --help  display help for command\n",
  "time stop": "Usage: todos time stop [options] <session-id>\n\nStop a focus session and log task time when linked to a task\n\nOptions:\n  --at <iso>      ISO stop timestamp\n  --cancel        Cancel instead of completing; does not create a time log\n  --notes <text>  Completion notes\n  -j, --json      Output JSON\n  -h, --help      display help for command\n",
  "time list": "Usage: todos time list [options]\n\nList local focus sessions\n\nOptions:\n  --task <id>        Filter by task\n  --plan <id>        Filter by plan\n  --run <id>         Filter by run\n  --agent <id>       Filter by agent\n  --status <status>  Filter by status\n  --all              Include completed and cancelled sessions\n  --limit <n>        Max sessions (default: \"20\")\n  -j, --json         Output JSON\n  -h, --help         display help for command\n",
  "time idle": "Usage: todos time idle [options]\n\nShow active focus sessions that need an idle prompt\n\nOptions:\n  --agent <id>  Filter by agent\n  --now <iso>   Reference time\n  -j, --json    Output JSON\n  -h, --help    display help for command\n",
  "time report": "Usage: todos time report [options]\n\nReport local actual time against estimates\n\nOptions:\n  --project <id>  Filter by project\n  --plan <id>     Filter by plan\n  --agent <id>    Filter by agent\n  --since <iso>   Only tasks updated or completed since this date\n  --include-open  Include open tasks\n  -j, --json      Output JSON\n  -h, --help      display help for command\n",
  "fields": "Usage: todos fields [options] [command]\n\nManage local labels, priority, severity, owner, area, and custom fields\n\nOptions:\n  -h, --help                display help for command\n\nCommands:\n  show [options] <task-id>  Show local fields for a task\n  set [options] <task-id>   Set local fields for a task\n  query [options]           Query tasks by local fields\n  help [command]            display help for command\n",
  "fields show": "Usage: todos fields show [options] <task-id>\n\nShow local fields for a task\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "fields set": "Usage: todos fields set [options] <task-id>\n\nSet local fields for a task\n\nOptions:\n  --labels <labels>      Comma-separated labels\n  --priority <priority>  Priority: low, medium, high, critical\n  --severity <severity>  Local severity, for example s0, s1, s2\n  --owner <owner>        Local owner or responsible agent\n  --area <area>          Local area or component\n  --custom <json>        Custom fields as a JSON object\n  --field <pairs...>     Custom key=value pairs\n  --replace-custom       Replace custom fields instead of merging\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "fields query": "Usage: todos fields query [options]\n\nQuery tasks by local fields\n\nOptions:\n  --labels <labels>      Comma-separated labels all matching tasks must have\n  --priority <priority>  Priority: low, medium, high, critical\n  --severity <severity>  Local severity\n  --owner <owner>        Local owner or responsible agent\n  --area <area>          Local area or component\n  --custom <json>        Custom field query as a JSON object\n  --field <pairs...>     Custom key=value pairs\n  --limit <n>            Maximum tasks to return (default: \"100\")\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "workflow": "Usage: todos workflow [options] [command]\n\nManage local project workflow states\n\nOptions:\n  -h, --help                       display help for command\n\nCommands:\n  states [options]                 List local workflow states\n  set [options] <task-id> <state>  Set a task's local workflow state\n  tasks [options] <state>          List tasks by local workflow state\n  migrate [options]                Backfill local workflow state metadata from\n                                   canonical task statuses\n  help [command]                   display help for command\n",
  "workflow states": "Usage: todos workflow states [options]\n\nList local workflow states\n\nOptions:\n  --project-path <path>  Project path override for workflow configuration\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "workflow set": "Usage: todos workflow set [options] <task-id> <state>\n\nSet a task's local workflow state\n\nOptions:\n  --actor <agent>        Agent or user changing the state\n  --project-path <path>  Project path override for workflow configuration\n  --force                Bypass configured transition guards\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "workflow tasks": "Usage: todos workflow tasks [options] <state>\n\nList tasks by local workflow state\n\nOptions:\n  --project <id>         Project filter\n  --task-list <id>       Task list filter\n  --project-path <path>  Project path override for workflow configuration\n  --limit <n>            Maximum tasks to return (default: \"100\")\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "workflow migrate": "Usage: todos workflow migrate [options]\n\nBackfill local workflow state metadata from canonical task statuses\n\nOptions:\n  --apply                Write migration metadata\n  --project <id>         Project filter\n  --task-list <id>       Task list filter\n  --project-path <path>  Project path override for workflow configuration\n  --limit <n>            Maximum tasks to inspect (default: \"10000\")\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "dedupe": "Usage: todos dedupe [options] [command]\n\nFind and merge likely duplicate local tasks\n\nOptions:\n  -h, --help                                             display help for command\n\nCommands:\n  scan [options]                                         Scan local tasks for likely duplicates\n  merge [options] <primary-task-id> <duplicate-task-id>  Merge a duplicate task into a primary task and archive the duplicate\n  help [command]                                         display help for command\n",
  "dedupe scan": "Usage: todos dedupe scan [options]\n\nScan local tasks for likely duplicates\n\nOptions:\n  --threshold <n>     Minimum duplicate score from 0 to 1 (default: \"0.74\")\n  --limit <n>         Maximum tasks to compare (default: \"1000\")\n  --include-archived  Include archived tasks\n  -j, --json          Output as JSON\n  -h, --help          display help for command\n",
  "dedupe merge": "Usage: todos dedupe merge [options] <primary-task-id> <duplicate-task-id>\n\nMerge a duplicate task into a primary task and archive the duplicate\n\nOptions:\n  --agent <agent>    Agent ID recording the merge\n  --reason <reason>  Human-readable merge reason\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "issues": "Usage: todos issues [options] [command]\n\nImport external issue data into local tasks\n\nOptions:\n  -h, --help               display help for command\n\nCommands:\n  import [options] [text]  Dry-run or apply local imports from GitHub, Linear,\n                           Jira, or plain URL issue data\n  report [options] [json]  Dry-run or apply testers.issue_report.v1 payloads\n                           into local tasks\n  help [command]           display help for command\n",
  "issues import": "Usage: todos issues import [options] [text]\n\nDry-run or apply local imports from GitHub, Linear, Jira, or plain URL issue\ndata\n\nOptions:\n  --file <path>          Read issue data from a JSON, Markdown, or text file\n  --url <url>            Source issue URL\n  --provider <provider>  github, linear, jira, or url\n  --project <id>         Project ID for created tasks\n  --list <id>            Task list ID for created tasks\n  --priority <priority>  Default priority for records without explicit priority\n                         (default: \"medium\")\n  --apply                Create local tasks; default is dry-run preview\n  --allow-network        Allow explicit provider CLI/API fetches when supported\n  --no-inbox             Do not create linked inbox evidence for applied imports\n  --no-dedupe            Do not skip records that match existing source metadata\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "issues report": "Usage: todos issues report [options] [json]\n\nDry-run or apply testers.issue_report.v1 payloads into local tasks\n\nOptions:\n  --file <path>          Read a tester issue report JSON object, array, or {\n                         reports: [] } bundle\n  --project <id>         Project ID for created tasks\n  --list <id>            Task list ID for created tasks\n  --priority <priority>  Default priority when report severity is missing\n                         (default: \"medium\")\n  --assign <agent>       Assign created or updated tasks to an agent\n  --apply                Create or update local tasks; default is dry-run\n                         preview\n  --no-update-existing   Match existing tasks without updating them\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "inbox": "Usage: todos inbox [options] [command]\n\nCapture local inbox items from pasted errors, CI logs, git context, files, or\nGitHub issue URLs\n\nOptions:\n  -h, --help              display help for command\n\nCommands:\n  add [options] [text]    Create a local inbox item and linked task from text,\n                          stdin, or a file\n  git [options]           Capture local git status and optional diff/stat\n                          context into the inbox\n  parse [options] [text]  Preview or apply deterministic local natural-language\n                          task intake\n  list [options]          List local inbox items\n  show [options] <id>     Show one inbox item\n  help [command]          display help for command\n",
  "inbox add": "Usage: todos inbox add [options] [text]\n\nCreate a local inbox item and linked task from text, stdin, or a file\n\nOptions:\n  --file <path>          Read captured context from a file\n  --source-type <type>   pasted_error, ci_log, git_context, github_issue, file,\n                         or other\n  --source-name <name>   Human-readable source name\n  --source-url <url>     Source URL, including GitHub issue URLs\n  --title <title>        Task/inbox title\n  --priority <priority>  Task priority\n  --tags <tags>          Comma-separated extra tags\n  --metadata <json>      Additional JSON metadata\n  --no-task              Only store inbox item; do not create a linked task\n  -j, --json             Output as JSON\n  -h, --help             display help for command\n",
  "inbox git": "Usage: todos inbox git [options]\n\nCapture local git status and optional diff/stat context into the inbox\n\nOptions:\n  --diff           Include git diff --stat and short diff context\n  --title <title>  Task/inbox title\n  -j, --json       Output as JSON\n  -h, --help       display help for command\n",
  "inbox parse": "Usage: todos inbox parse [options] [text]\n\nPreview or apply deterministic local natural-language task intake\n\nOptions:\n  --file <path>           Read natural-language input from a file\n  --priority <priority>   Default priority for parsed tasks (default: \"medium\")\n  --project <id>          Project ID for applied tasks\n  --list <id>             Task list ID for applied tasks\n  --reference-date <iso>  Reference date for due today/tomorrow/next week\n  --apply                 Create parsed tasks; default is dry-run preview\n  -j, --json              Output as JSON\n  -h, --help              display help for command\n",
  "inbox list": "Usage: todos inbox list [options]\n\nList local inbox items\n\nOptions:\n  --status <status>     new, triaged, or ignored\n  --source-type <type>  Filter by source type\n  --limit <n>           Max rows (default: \"50\")\n  -j, --json            Output as JSON\n  -h, --help            display help for command\n",
  "inbox show": "Usage: todos inbox show [options] <id>\n\nShow one inbox item\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "report-failure": "Usage: todos report-failure [options]\n\nCreate a task from a test/build/typecheck failure and auto-assign it\n\nOptions:\n  --error <message>  Error message or summary\n  --type <type>      Failure type: test, build, typecheck, runtime, other\n                     (default: \"test\")\n  --file <path>      File where failure occurred\n  --stack <trace>    Stack trace or detailed output\n  --title <title>    Custom task title (auto-generated if omitted)\n  --priority <p>     Priority: low, medium, high, critical\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "hooks": "Usage: todos hooks [options] [command]\n\nManage Claude Code hook integration\n\nOptions:\n  -h, --help      display help for command\n\nCommands:\n  install         Install Claude Code hooks for auto-sync\n  help [command]  display help for command\n",
  "hooks install": "Usage: todos hooks install [options]\n\nInstall Claude Code hooks for auto-sync\n\nOptions:\n  -h, --help  display help for command\n",
  "mcp": "Usage: todos mcp [options]\n\nStart MCP server (stdio)\n\nOptions:\n  --register <agent>    Register MCP server with an agent (claude, codex,\n                        gemini, all)\n  --unregister <agent>  Unregister MCP server from an agent (claude, codex,\n                        gemini, all)\n  -g, --global          Register/unregister globally (user-level) instead of\n                        project-level\n  -h, --help            display help for command\n",
  "import": "Usage: todos import [options] <url>\n\nImport a GitHub issue as a task\n\nOptions:\n  --project <id>  Project ID\n  --list <id>     Task list ID\n  -h, --help      display help for command\n",
  "link-commit": "Usage: todos link-commit [options] <task-id> <sha>\n\nLink a git commit to a task\n\nOptions:\n  --message <text>  Commit message\n  --author <name>   Commit author\n  --files <list>    Comma-separated list of changed files\n  -h, --help        display help for command\n",
  "find-commit": "Usage: todos find-commit [options] <sha>\n\nFind which task explains a git commit SHA\n\nOptions:\n  -h, --help  display help for command\n",
  "link-ref": "Usage: todos link-ref [options] <task-id> <ref>\n\nLink a git branch or pull request to a task\n\nOptions:\n  --type <type>      Ref type: branch or pull_request (default: \"branch\")\n  --url <url>        Remote URL for the branch or pull request\n  --provider <name>  Provider name, e.g. git or github\n  --metadata <json>  Additional JSON metadata\n  -h, --help         display help for command\n",
  "find-ref": "Usage: todos find-ref [options] <ref>\n\nFind tasks linked to a git branch or pull request\n\nOptions:\n  -h, --help  display help for command\n",
  "branch-plan": "Usage: todos branch-plan [options] [task-id]\n\nCreate a local branch-safe work plan from task or plan files\n\nOptions:\n  --branch <name>  Branch name to plan\n  --base <name>    Base branch (default: \"main\")\n  --plan <id>      Plan ID scope instead of a single task\n  --path <list>    Comma-separated extra paths expected for this branch\n  --root <path>    Git root to inspect (defaults to the current directory at\n                   execution)\n  --no-git-status  Skip local git status checks\n  -h, --help       display help for command\n",
  "record-verification": "Usage: todos record-verification [options] <task-id> <command>\n\nRecord a verification command and result for a task\n\nOptions:\n  --status <status>  Verification status: passed, failed, or unknown (default:\n                     \"unknown\")\n  --summary <text>   Short output summary\n  --artifact <path>  Artifact or log path\n  --agent <name>     Agent that ran the command\n  -h, --help         display help for command\n",
  "trace": "Usage: todos trace [options] <task-id>\n\nShow local git refs, commits, changed files, and verification commands for a\ntask\n\nOptions:\n  -h, --help  display help for command\n",
  "contracts": "Usage: todos contracts [options] [command]\n\nManage local task contracts, acceptance criteria, and review gates\n\nOptions:\n  -h, --help                          display help for command\n\nCommands:\n  set [options] <task-id>             Set acceptance criteria, required\n                                      verification, artifacts, files, risk, and\n                                      done definition\n  show <task-id>                      Show the local task contract and review\n                                      state\n  request-review [options] <task-id>  Request local review for a task\n  review [options] <task-id>          Record local review approval, requested\n                                      changes, or reopen state\n  check <task-id>                     Check whether local task evidence\n                                      satisfies the task contract\n  help [command]                      display help for command\n",
  "contracts set": "Usage: todos contracts set [options] <task-id>\n\nSet acceptance criteria, required verification, artifacts, files, risk, and done\ndefinition\n\nOptions:\n  --criteria <items>  Semicolon-separated acceptance criteria\n  --verify <items>    Semicolon-separated required verification commands\n  --artifact <items>  Comma-separated expected artifact paths\n  --file <items>      Comma-separated relevant file paths\n  --risk <level>      Risk level: low, medium, high, or critical\n  --done <items>      Semicolon-separated done-definition checklist items\n  -h, --help          display help for command\n",
  "contracts show": "Usage: todos contracts show [options] <task-id>\n\nShow the local task contract and review state\n\nOptions:\n  -h, --help  display help for command\n",
  "contracts request-review": "Usage: todos contracts request-review [options] <task-id>\n\nRequest local review for a task\n\nOptions:\n  --requester <name>  Requester agent\n  --reviewer <name>   Reviewer agent or human\n  --notes <text>      Review notes\n  -h, --help          display help for command\n",
  "contracts review": "Usage: todos contracts review [options] <task-id>\n\nRecord local review approval, requested changes, or reopen state\n\nOptions:\n  --state <state>    approved, changes_requested, or reopened\n  --reviewer <name>  Reviewer agent or human\n  --notes <text>     Review notes\n  --changes <items>  Semicolon-separated requested changes\n  -h, --help         display help for command\n",
  "contracts check": "Usage: todos contracts check [options] <task-id>\n\nCheck whether local task evidence satisfies the task contract\n\nOptions:\n  -h, --help  display help for command\n",
  "verify-providers": "Usage: todos verify-providers [options] [command]\n\nManage optional local verification provider adapters\n\nOptions:\n  -h, --help            display help for command\n\nCommands:\n  set [options] <name>  Create or update a local verification provider\n  list                  List local verification providers\n  capabilities <name>   Show local verification provider capabilities\n  remove <name>         Remove a local verification provider\n  run [options] <name>  Run a local verification provider and optionally record\n                        task evidence\n  help [command]        display help for command\n",
  "verify-providers set": "Usage: todos verify-providers set [options] <name>\n\nCreate or update a local verification provider\n\nOptions:\n  --kind <kind>           command, testbox, ci_log, browser, or script\n  --command <command>     Local command template. Supports {task_id},\n                          {agent_id}, {artifact_path}, and {url}\n  --cwd <path>            Command working directory\n  --capabilities <items>  Comma-separated capability labels\n  --attempts <n>          Retry attempts (default: \"1\")\n  --backoff-ms <n>        Retry backoff in milliseconds\n  --timeout-ms <n>        Command timeout in milliseconds\n  --env <json>            Static provider environment as a JSON object\n  -h, --help              display help for command\n",
  "verify-providers list": "Usage: todos verify-providers list [options]\n\nList local verification providers\n\nOptions:\n  -h, --help  display help for command\n",
  "verify-providers capabilities": "Usage: todos verify-providers capabilities [options] <name>\n\nShow local verification provider capabilities\n\nOptions:\n  -h, --help  display help for command\n",
  "verify-providers remove": "Usage: todos verify-providers remove [options] <name>\n\nRemove a local verification provider\n\nOptions:\n  -h, --help  display help for command\n",
  "verify-providers run": "Usage: todos verify-providers run [options] <name>\n\nRun a local verification provider and optionally record task evidence\n\nOptions:\n  --task <id>          Task ID to record verification evidence against\n  --agent <name>       Agent running the provider\n  --command <command>  Override provider command for this run\n  --cwd <path>         Command working directory\n  --log <text>         CI log text to classify\n  --log-file <path>    CI log file to classify\n  --artifact <path>    Local artifact or screenshot path\n  --url <url>          Browser URL label\n  --metadata <json>    Additional run metadata\n  -h, --help           display help for command\n",
  "runs": "Usage: todos runs [options] [command]\n\nManage the local run ledger and evidence capture\n\nOptions:\n  -h, --help                                 display help for command\n\nCommands:\n  begin [options] <task-id>                  Preview or apply an idempotent loop run transaction\n  start [options] <task-id>                  Start a local run ledger entry for a task\n  list [task-id]                             List local run ledger entries\n  show <run-id>                              Show a run ledger with events, commands, files, and artifacts\n  simulate [options] <fixture>               Dry-run replay a recorded context pack or run fixture without mutating local state\n  event [options] <run-id> <type> [message]  Record a progress, comment, claim, or generic run event\n  command [options] <run-id> <command>       Record command/test evidence for a run\n  file [options] <run-id> <path>             Record a file touched by a run\n  artifact [options] <run-id> <path>         Record a local artifact for a run in the content-addressed store\n  artifact-verify <run-id>                   Verify locally stored run artifact content against recorded checksums\n  finish [options] [run-id]                  Finish a run ledger entry idempotently\n  help [command]                             display help for command\n",
  "runs begin": "Usage: todos runs begin [options] <task-id>\n\nPreview or apply an idempotent loop run transaction\n\nOptions:\n  --key <key>         Stable idempotency key for this loop transaction\n  --loop-id <id>      Loop identifier; used as the key when --key/--loop-run-id\n                      are omitted\n  --loop-run-id <id>  Loop run identifier; used as the key when --key is omitted\n  --agent <name>      Agent starting the run\n  --title <text>      Run title\n  --summary <text>    Run summary\n  --metadata <json>   Additional JSON metadata\n  --claim             Claim/start the task for the agent before recording the\n                      run\n  --apply             Apply the transaction; omitted means dry-run\n  -h, --help          display help for command\n",
  "runs start": "Usage: todos runs start [options] <task-id>\n\nStart a local run ledger entry for a task\n\nOptions:\n  --agent <name>     Agent starting the run\n  --title <text>     Run title\n  --summary <text>   Run summary\n  --metadata <json>  Additional JSON metadata\n  --claim            Claim/start the task for the agent before recording the run\n  -h, --help         display help for command\n",
  "runs list": "Usage: todos runs list [options] [task-id]\n\nList local run ledger entries\n\nOptions:\n  -h, --help  display help for command\n",
  "runs show": "Usage: todos runs show [options] <run-id>\n\nShow a run ledger with events, commands, files, and artifacts\n\nOptions:\n  -h, --help  display help for command\n",
  "runs simulate": "Usage: todos runs simulate [options] <fixture>\n\nDry-run replay a recorded context pack or run fixture without mutating local\nstate\n\nOptions:\n  --agent <name>     Agent identity to include in the simulation\n  --scenario <name>  Scenario label for the deterministic replay\n  --format <format>  Output format: json or markdown (default: \"json\")\n  -h, --help         display help for command\n",
  "runs event": "Usage: todos runs event [options] <run-id> <type> [message]\n\nRecord a progress, comment, claim, or generic run event\n\nOptions:\n  --agent <name>  Agent recording the event\n  --data <json>   Additional JSON event data\n  -h, --help      display help for command\n",
  "runs command": "Usage: todos runs command [options] <run-id> <command>\n\nRecord command/test evidence for a run\n\nOptions:\n  --status <status>   Command status: passed, failed, or unknown (default:\n                      \"unknown\")\n  --exit-code <code>  Process exit code\n  --summary <text>    Short output summary\n  --artifact <path>   Optional local artifact/log path\n  --tokens <n>        Token count reported by the agent or model\n  --cost-usd <n>      USD cost reported by the agent or model\n  --duration-ms <n>   Duration in milliseconds reported by the agent or model\n  --sandbox <name>    Runner sandbox profile to check before recording\n  --cwd <path>        Command working directory for sandbox checks\n  --write <list>      Comma-separated write paths for sandbox checks\n  --env <list>        Comma-separated environment keys for sandbox checks\n  --network           Request network access for sandbox checks\n  --agent <name>      Agent that ran the command\n  -h, --help          display help for command\n",
  "runs file": "Usage: todos runs file [options] <run-id> <path>\n\nRecord a file touched by a run\n\nOptions:\n  --status <status>  File status: planned, active, modified, reviewed, or\n                     removed (default: \"modified\")\n  --note <text>      Why the file was touched\n  --agent <name>     Agent touching the file\n  -h, --help         display help for command\n",
  "runs artifact": "Usage: todos runs artifact [options] <run-id> <path>\n\nRecord a local artifact for a run in the content-addressed store\n\nOptions:\n  --type <type>            Artifact type, e.g. log, screenshot, report\n  --description <text>     Artifact description\n  --size <bytes>           Size in bytes\n  --sha256 <hash>          SHA-256 checksum\n  --metadata <json>        Additional JSON metadata\n  --no-store               Record metadata only and do not copy local content\n  --require-file           Fail if the artifact file cannot be stored\n  --retention-days <days>  Retention period for stored content metadata\n  --agent <name>           Agent adding the artifact\n  -h, --help               display help for command\n",
  "runs artifact-verify": "Usage: todos runs artifact-verify [options] <run-id>\n\nVerify locally stored run artifact content against recorded checksums\n\nOptions:\n  -h, --help  display help for command\n",
  "runs finish": "Usage: todos runs finish [options] [run-id]\n\nFinish a run ledger entry idempotently\n\nOptions:\n  --key <key>        Resolve run by idempotency key when run-id is omitted\n  --task <task-id>   Task scope for --key lookup\n  --status <status>  completed, failed, or cancelled (default: \"completed\")\n  --summary <text>   Final summary\n  --agent <name>     Agent finishing the run\n  --dry-run          Preview without mutating\n  -h, --help         display help for command\n",
  "findings": "Usage: todos findings [options] [command]\n\nManage local task findings for loop dedupe and resolution\n\nOptions:\n  -h, --help                 display help for command\n\nCommands:\n  upsert [options]           Preview or apply an idempotent finding upsert\n  resolve-missing [options]  Resolve open findings absent from the latest loop\n                             finding set\n  list [options]             List compact local findings\n  help [command]             display help for command\n",
  "findings upsert": "Usage: todos findings upsert [options]\n\nPreview or apply an idempotent finding upsert\n\nOptions:\n  --task <task-id>       Task ID\n  --fingerprint <value>  Stable finding fingerprint\n  --title <text>         Finding title\n  --severity <severity>  low, medium, high, or critical (default: \"medium\")\n  --status <status>      open, resolved, or ignored (default: \"open\")\n  --source <source>      Loop/tool source name\n  --summary <text>       Bounded finding summary\n  --artifact <path>      Local artifact path/reference; content is not read\n  --run <run-id>         Run ledger ID or prefix\n  --metadata <json>      Additional JSON metadata\n  --apply                Apply the upsert; omitted means dry-run\n  -h, --help             display help for command\n",
  "findings resolve-missing": "Usage: todos findings resolve-missing [options]\n\nResolve open findings absent from the latest loop finding set\n\nOptions:\n  --task <task-id>       Task ID\n  --fingerprints <list>  Comma-separated fingerprints still present\n  --source <source>      Only resolve findings from this source\n  --run <run-id>         Run ledger ID or prefix for audit metadata\n  --status <status>      resolved or ignored (default: \"resolved\")\n  --agent <name>         Agent resolving findings\n  --reason <text>        Resolution reason\n  --limit <n>            Maximum findings returned (default: \"50\")\n  --apply                Apply resolution; omitted means dry-run\n  -h, --help             display help for command\n",
  "findings list": "Usage: todos findings list [options]\n\nList compact local findings\n\nOptions:\n  --task <task-id>   Filter by task\n  --run <run-id>     Filter by run\n  --status <status>  Filter by open, resolved, or ignored\n  --source <source>  Filter by source\n  --limit <n>        Maximum findings returned (default: \"50\")\n  -h, --help         display help for command\n",
  "agent-runs": "Usage: todos agent-runs [options] [command]\n\nQueue and dispatch local agent runs\n\nOptions:\n  -h, --help                    display help for command\n\nCommands:\n  adapter-set [options] <name>  Create or update a local agent run adapter\n  adapters                      List local agent run adapters\n  adapter-remove <name>         Remove a local agent run adapter\n  queue [options] <task-id>     Queue a local agent run for a task\n  list                          List queued local agent runs\n  run-next [options]            Run the next queued local agent dispatch\n  cancel <run-id>               Cancel a queued or running local agent dispatch\n  retry <run-id>                Queue a retry for a previous local agent\n                                dispatch\n  help [command]                display help for command\n",
  "agent-runs adapter-set": "Usage: todos agent-runs adapter-set [options] <name>\n\nCreate or update a local agent run adapter\n\nOptions:\n  --command <command>  Local command template. Supports {task_id}, {run_id}, and\n                       {agent_id}\n  --sandbox <name>     Runner sandbox profile to check before launch\n  --cwd <path>         Command working directory\n  --env <json>         Static adapter environment as a JSON object\n  -h, --help           display help for command\n",
  "agent-runs adapters": "Usage: todos agent-runs adapters [options]\n\nList local agent run adapters\n\nOptions:\n  -h, --help  display help for command\n",
  "agent-runs adapter-remove": "Usage: todos agent-runs adapter-remove [options] <name>\n\nRemove a local agent run adapter\n\nOptions:\n  -h, --help  display help for command\n",
  "agent-runs queue": "Usage: todos agent-runs queue [options] <task-id>\n\nQueue a local agent run for a task\n\nOptions:\n  --adapter <name>     Configured adapter name\n  --command <command>  Custom command template\n  --sandbox <name>     Runner sandbox profile\n  --cwd <path>         Command working directory\n  --agent <name>       Agent identity for the run\n  --title <text>       Run title\n  --summary <text>     Run summary\n  --metadata <json>    Additional metadata\n  --claim              Claim/start the task before queueing\n  -h, --help           display help for command\n",
  "agent-runs list": "Usage: todos agent-runs list [options]\n\nList queued local agent runs\n\nOptions:\n  -h, --help  display help for command\n",
  "agent-runs run-next": "Usage: todos agent-runs run-next [options]\n\nRun the next queued local agent dispatch\n\nOptions:\n  --adapter <name>  Only run queue entries for this adapter\n  --dry-run         Return the command that would run without executing it\n  -h, --help        display help for command\n",
  "agent-runs cancel": "Usage: todos agent-runs cancel [options] <run-id>\n\nCancel a queued or running local agent dispatch\n\nOptions:\n  -h, --help  display help for command\n",
  "agent-runs retry": "Usage: todos agent-runs retry [options] <run-id>\n\nQueue a retry for a previous local agent dispatch\n\nOptions:\n  -h, --help  display help for command\n",
  "hook": "Usage: todos hook [options] [command]\n\nManage git hooks for auto-linking commits to tasks\n\nOptions:\n  -h, --help      display help for command\n\nCommands:\n  install         Install post-commit hook that auto-links commits to tasks\n  uninstall       Remove the todos post-commit hook\n  help [command]  display help for command\n",
  "hook install": "Usage: todos hook install [options]\n\nInstall post-commit hook that auto-links commits to tasks\n\nOptions:\n  -h, --help  display help for command\n",
  "hook uninstall": "Usage: todos hook uninstall [options]\n\nRemove the todos post-commit hook\n\nOptions:\n  -h, --help  display help for command\n",
  "dispatch": "Usage: todos dispatch [options] [command] <target>\n\nLegacy/emergency only: send tasks or task lists to a tmux window after explicit\nhuman choice\n\nArguments:\n  target                      legacy/emergency tmux target: window,\n                              session:window, or session:window.pane\n\nOptions:\n  --tasks <ids>               Comma-separated task IDs to dispatch\n  --list <id>                 Task list ID or slug to dispatch\n  --filter-status <statuses>  Comma-separated task statuses to include (default:\n                              pending) (default: \"pending\")\n  --delay <ms>                Delay in ms between message and Enter\n                              (auto-calculated if omitted)\n  --at <datetime>             ISO datetime to schedule the dispatch\n  --multiple <targets>        Comma-separated list of additional\n                              legacy/emergency tmux targets (fan-out)\n  --stagger <ms>              Delay between targets when using --multiple\n                              (default: 500ms)\n  --confirm-busy              Send even if the target tmux pane appears busy\n  --dry-run                   Preview the formatted message without sending\n  -h, --help                  display help for command\n\nCommands:\n  run [options]               Fire all pending dispatches that are due now\n",
  "dispatch run": "Usage: todos dispatch run [options]\n\nFire all pending dispatches that are due now\n\nOptions:\n  --all           Ignore scheduled_at and fire all pending immediately\n  --confirm-busy  Send even if a target tmux pane appears busy\n  --dry-run       Preview without sending\n  -h, --help      display help for command\n",
  "dispatches": "Usage: todos dispatches [options]\n\nList dispatch history\n\nOptions:\n  --status <status>  Filter by status: pending, sent, failed, cancelled\n  --limit <n>        Max results (default: 20)\n  --cancel <id>      Cancel a pending dispatch by ID\n  -h, --help         display help for command\n",
  "machines": "Usage: todos machines [options] [command]\n\nList registered machines\n\nOptions:\n  -a, --all                       Include archived machines\n  -h, --help                      display help for command\n\nCommands:\n  register [options] <name>       Register a machine\n  heartbeat [options] [name]      Update last-seen and local topology metadata\n                                  for a machine\n  set-primary <name>              Set the primary machine\n  archive <name>                  Archive a machine (soft-delete)\n  unarchive <name>                Unarchive a machine\n  delete <name>                   Delete a machine (hard delete)\n  status                          Show machine health status\n  topology [options]              Show local machine topology diagnostics\n  sync [options]                  Sync local bridge bundles with remote\n                                  machine(s) via SSH\n  tasks [options] <machine-name>  List tasks from a remote machine via SSH\n",
  "machines register": "Usage: todos machines register [options] <name>\n\nRegister a machine\n\nArguments:\n  name                     Machine name\n\nOptions:\n  --hostname <host>        OS hostname\n  --platform <platform>    OS platform\n  --ssh <address>          SSH address (e.g. user@host)\n  --arch <arch>            Architecture (e.g. linux-arm64)\n  --tailscale-name <name>  User-provided Tailscale/MagicDNS name\n  --tailscale-ip <ip>      User-provided Tailscale IP\n  --lan-address <address>  User-provided LAN address\n  --workspace <path>       Local workspace path for this machine\n  --git-root <path>        Local git root for this machine\n  --primary                Set as primary machine\n  -j, --json               Output as JSON\n  -h, --help               display help for command\n",
  "machines heartbeat": "Usage: todos machines heartbeat [options] [name]\n\nUpdate last-seen and local topology metadata for a machine\n\nOptions:\n  --hostname <host>        OS hostname\n  --platform <platform>    OS platform\n  --ssh <address>          SSH address (e.g. user@host)\n  --arch <arch>            Architecture (e.g. linux-arm64)\n  --tailscale-name <name>  User-provided Tailscale/MagicDNS name\n  --tailscale-ip <ip>      User-provided Tailscale IP\n  --lan-address <address>  User-provided LAN address\n  --workspace <path>       Local workspace path for this machine\n  --git-root <path>        Local git root for this machine\n  -j, --json               Output as JSON\n  -h, --help               display help for command\n",
  "machines set-primary": "Usage: todos machines set-primary [options] <name>\n\nSet the primary machine\n\nArguments:\n  name        Machine name\n\nOptions:\n  -h, --help  display help for command\n",
  "machines archive": "Usage: todos machines archive [options] <name>\n\nArchive a machine (soft-delete)\n\nArguments:\n  name        Machine name\n\nOptions:\n  -h, --help  display help for command\n",
  "machines unarchive": "Usage: todos machines unarchive [options] <name>\n\nUnarchive a machine\n\nArguments:\n  name        Machine name\n\nOptions:\n  -h, --help  display help for command\n",
  "machines delete": "Usage: todos machines delete [options] <name>\n\nDelete a machine (hard delete)\n\nArguments:\n  name        Machine name\n\nOptions:\n  -h, --help  display help for command\n",
  "machines status": "Usage: todos machines status [options]\n\nShow machine health status\n\nOptions:\n  -h, --help  display help for command\n",
  "machines topology": "Usage: todos machines topology [options]\n\nShow local machine topology diagnostics\n\nOptions:\n  --stale-minutes <n>  Minutes before a machine is considered stale (default:\n                       \"30\")\n  --include-archived   Include archived machines\n  -j, --json           Output as JSON\n  -h, --help           display help for command\n",
  "machines sync": "Usage: todos machines sync [options]\n\nSync local bridge bundles with remote machine(s) via SSH\n\nOptions:\n  --machine <name>  Specific machine name (default: all with SSH)\n  --ssh <address>   Ad-hoc SSH address for bootstrap sync without a registered\n                    peer\n  --dry-run         Show what would be synced without importing\n  --push            Also push a local bridge bundle to the remote machine\n  -j, --json        Output as JSON\n  -h, --help        display help for command\n",
  "machines tasks": "Usage: todos machines tasks [options] <machine-name>\n\nList tasks from a remote machine via SSH\n\nArguments:\n  machine-name       Machine name (must have SSH address)\n\nOptions:\n  --status <status>  Filter by status\n  -h, --help         display help for command\n",
  "api-keys": "Usage: todos api-keys|api-key [options] [command]\n\nGenerate, list, and revoke API keys for secured app/API access\n\nOptions:\n  -h, --help                        display help for command\n\nCommands:\n  create|generate [options] <name>  Generate a new API key. The plaintext key is\n                                    shown once.\n  list [options]                    List API keys without showing plaintext\n                                    secrets\n  revoke <id-or-prefix>             Revoke an API key by id or prefix\n  verify <key>                      Verify an API key locally without printing\n                                    stored hashes\n  help [command]                    display help for command\n",
  "api-key": "Usage: todos api-keys|api-key [options] [command]\n\nGenerate, list, and revoke API keys for secured app/API access\n\nOptions:\n  -h, --help                        display help for command\n\nCommands:\n  create|generate [options] <name>  Generate a new API key. The plaintext key is\n                                    shown once.\n  list [options]                    List API keys without showing plaintext\n                                    secrets\n  revoke <id-or-prefix>             Revoke an API key by id or prefix\n  verify <key>                      Verify an API key locally without printing\n                                    stored hashes\n  help [command]                    display help for command\n",
  "api-keys create": "Usage: todos api-keys create|generate [options] <name>\n\nGenerate a new API key. The plaintext key is shown once.\n\nOptions:\n  --expires-at <iso>    Optional ISO timestamp when this key expires\n  --permissions <list>  Comma-separated permissions (default: *)\n  -h, --help            display help for command\n",
  "api-keys generate": "Usage: todos api-keys create|generate [options] <name>\n\nGenerate a new API key. The plaintext key is shown once.\n\nOptions:\n  --expires-at <iso>    Optional ISO timestamp when this key expires\n  --permissions <list>  Comma-separated permissions (default: *)\n  -h, --help            display help for command\n",
  "api-keys list": "Usage: todos api-keys list [options]\n\nList API keys without showing plaintext secrets\n\nOptions:\n  --include-revoked  Include revoked keys\n  -h, --help         display help for command\n",
  "api-keys revoke": "Usage: todos api-keys revoke [options] <id-or-prefix>\n\nRevoke an API key by id or prefix\n\nOptions:\n  -h, --help  display help for command\n",
  "api-keys verify": "Usage: todos api-keys verify [options] <key>\n\nVerify an API key locally without printing stored hashes\n\nOptions:\n  -h, --help  display help for command\n",
  "env-snapshot": "Usage: todos env-snapshot|environment-snapshot [options] [command]\n\nCapture and compare local reproducible environment snapshots\n\nOptions:\n  -h, --help              display help for command\n\nCommands:\n  capture [options]       Capture runtime, package-manager, git, config hash,\n                          and redacted environment metadata\n  compare <left> <right>  Compare two environment snapshot JSON files\n  help [command]          display help for command\n",
  "environment-snapshot": "Usage: todos env-snapshot|environment-snapshot [options] [command]\n\nCapture and compare local reproducible environment snapshots\n\nOptions:\n  -h, --help              display help for command\n\nCommands:\n  capture [options]       Capture runtime, package-manager, git, config hash,\n                          and redacted environment metadata\n  compare <left> <right>  Compare two environment snapshot JSON files\n  help [command]          display help for command\n",
  "env-snapshot capture": "Usage: todos env-snapshot capture [options]\n\nCapture runtime, package-manager, git, config hash, and redacted environment\nmetadata\n\nOptions:\n  --root <path>         Project root to inspect\n  --task <id>           Attach snapshot evidence to a task\n  --run <id>            Attach snapshot artifact to a task run\n  --agent <name>        Agent name for attached evidence\n  --command <command>   Command or verification step this snapshot explains\n  --output <path>       Write snapshot JSON to a specific path\n  --include-env-values  Include nonsecret environment values; secret-like keys\n                        are still redacted\n  -h, --help            display help for command\n",
  "env-snapshot compare": "Usage: todos env-snapshot compare [options] <left> <right>\n\nCompare two environment snapshot JSON files\n\nArguments:\n  left        Left snapshot JSON path\n  right       Right snapshot JSON path\n\nOptions:\n  -h, --help  display help for command\n",
  "knowledge": "Usage: todos knowledge [options] [command]\n\nManage local project knowledge records, decisions, tradeoffs, and context\nsnapshots\n\nOptions:\n  -h, --help                    display help for command\n\nCommands:\n  add [options] <type> <title>  Add a local knowledge record\n  snapshot [options]            Save a local context snapshot and attach it as a\n                                knowledge record\n  list [options]                List local knowledge records\n  search [options] <query>      Search local knowledge records\n  show [options] <id>           Show one local knowledge record\n  export [options]              Export local knowledge records as deterministic\n                                JSON or Markdown\n  help [command]                display help for command\n",
  "knowledge add": "Usage: todos knowledge add [options] <type> <title>\n\nAdd a local knowledge record\n\nOptions:\n  --content <text>        Record body or note\n  --decision <text>       Decision outcome\n  --rationale <text>      Decision rationale\n  --alternative <text>    Alternative considered; repeatable (default: [])\n  --task <id>             Link to a task\n  --project <id>          Link to a project\n  --plan <id>             Link to a plan\n  --agent <id>            Agent that authored or owns the record\n  --tag <tag>             Tag; repeatable or comma-separated (default: [])\n  --metadata-json <json>  JSON object metadata\n  -j, --json              Output as JSON\n  -h, --help              display help for command\n",
  "knowledge snapshot": "Usage: todos knowledge snapshot [options]\n\nSave a local context snapshot and attach it as a knowledge record\n\nOptions:\n  --summary <text>        Snapshot summary\n  --title <text>          Knowledge record title\n  --snapshot-type <type>  Snapshot type: interrupt, complete, handoff,\n                          checkpoint (default: \"checkpoint\")\n  --task <id>             Link to a task\n  --project <id>          Link to a project\n  --agent <id>            Agent that produced the snapshot\n  --file <path>           Open or relevant file; repeatable (default: [])\n  --attempt <text>        Attempt summary; repeatable (default: [])\n  --blocker <text>        Blocker summary; repeatable (default: [])\n  --next <text>           Next steps\n  --tag <tag>             Tag; repeatable or comma-separated (default: [])\n  --metadata-json <json>  JSON object metadata\n  -j, --json              Output as JSON\n  -h, --help              display help for command\n",
  "knowledge list": "Usage: todos knowledge list [options]\n\nList local knowledge records\n\nOptions:\n  --type <type>   Filter by record type\n  --task <id>     Filter by task\n  --project <id>  Filter by project\n  --plan <id>     Filter by plan\n  --agent <id>    Filter by agent\n  --tag <tag>     Filter by tag\n  --limit <n>     Maximum records (default: \"50\")\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "knowledge search": "Usage: todos knowledge search [options] <query>\n\nSearch local knowledge records\n\nOptions:\n  --type <type>   Filter by record type\n  --task <id>     Filter by task\n  --project <id>  Filter by project\n  --plan <id>     Filter by plan\n  --agent <id>    Filter by agent\n  --tag <tag>     Filter by tag\n  --limit <n>     Maximum records (default: \"50\")\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "knowledge show": "Usage: todos knowledge show [options] <id>\n\nShow one local knowledge record\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "knowledge export": "Usage: todos knowledge export [options]\n\nExport local knowledge records as deterministic JSON or Markdown\n\nOptions:\n  --query <text>     Search query before exporting\n  --type <type>      Filter by record type\n  --task <id>        Filter by task\n  --project <id>     Filter by project\n  --plan <id>        Filter by plan\n  --agent <id>       Filter by agent\n  --tag <tag>        Filter by tag\n  --limit <n>        Maximum records (default: \"100\")\n  --format <format>  json or markdown (default: \"json\")\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "risks": "Usage: todos risks [options] [command]\n\nManage local project and plan risks, and score local plan/project health\n\nOptions:\n  -h, --help             display help for command\n\nCommands:\n  add [options] <title>  Add a local risk register entry\n  list [options]         List local risk register entries\n  show [options] <id>    Show one local risk\n  update [options] <id>  Update a local risk\n  close [options] <id>   Close a risk as resolved or accepted\n  score [options]        Score local health for a plan or project\n  export [options]       Export local risk register entries as deterministic\n                         JSON or Markdown\n  help [command]         display help for command\n",
  "risks add": "Usage: todos risks add [options] <title>\n\nAdd a local risk register entry\n\nOptions:\n  --description <text>         Risk description\n  --status <status>            Risk status: open, mitigating, resolved, accepted\n                               (default: \"open\")\n  --severity <severity>        Risk severity: low, medium, high, critical\n                               (default: \"medium\")\n  --probability <probability>  Risk probability: low, medium, high (default:\n                               \"medium\")\n  --owner <owner>              Risk owner\n  --mitigation <text>          Mitigation plan\n  --due <iso>                  Risk mitigation due date\n  --project <id>               Link to a project\n  --plan <id>                  Link to a plan\n  --task <id>                  Link to a task\n  --tag <tag>                  Tag; repeatable or comma-separated (default: [])\n  --metadata-json <json>       JSON object metadata\n  -j, --json                   Output as JSON\n  -h, --help                   display help for command\n",
  "risks list": "Usage: todos risks list [options]\n\nList local risk register entries\n\nOptions:\n  --status <status>            Filter by status\n  --severity <severity>        Filter by severity\n  --probability <probability>  Filter by probability\n  --owner <owner>              Filter by owner\n  --project <id>               Filter by project\n  --plan <id>                  Filter by plan\n  --task <id>                  Filter by task\n  --tag <tag>                  Filter by tag\n  --include-closed             Include resolved and accepted risks\n  --limit <n>                  Maximum records (default: \"50\")\n  -j, --json                   Output as JSON\n  -h, --help                   display help for command\n",
  "risks show": "Usage: todos risks show [options] <id>\n\nShow one local risk\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "risks update": "Usage: todos risks update [options] <id>\n\nUpdate a local risk\n\nOptions:\n  --title <title>              New title\n  --description <text>         Risk description\n  --status <status>            Risk status\n  --severity <severity>        Risk severity\n  --probability <probability>  Risk probability\n  --owner <owner>              Risk owner\n  --mitigation <text>          Mitigation plan\n  --due <iso>                  Risk mitigation due date\n  --project <id>               Link to a project\n  --plan <id>                  Link to a plan\n  --task <id>                  Link to a task\n  --tag <tag>                  Replace tags; repeatable or comma-separated\n                               (default: [])\n  --metadata-json <json>       Replace JSON object metadata\n  -j, --json                   Output as JSON\n  -h, --help                   display help for command\n",
  "risks close": "Usage: todos risks close [options] <id>\n\nClose a risk as resolved or accepted\n\nOptions:\n  --status <status>  resolved or accepted (default: \"resolved\")\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "risks score": "Usage: todos risks score [options]\n\nScore local health for a plan or project\n\nOptions:\n  --plan <id>     Plan to score\n  --project <id>  Project to score\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "risks export": "Usage: todos risks export [options]\n\nExport local risk register entries as deterministic JSON or Markdown\n\nOptions:\n  --status <status>            Filter by status\n  --severity <severity>        Filter by severity\n  --probability <probability>  Filter by probability\n  --owner <owner>              Filter by owner\n  --project <id>               Filter by project\n  --plan <id>                  Filter by plan\n  --task <id>                  Filter by task\n  --tag <tag>                  Filter by tag\n  --include-closed             Include resolved and accepted risks\n  --limit <n>                  Maximum records (default: \"100\")\n  --format <format>            json or markdown (default: \"json\")\n  -j, --json                   Output as JSON\n  -h, --help                   display help for command\n",
  "retrospectives": "Usage: todos retrospectives|retro [options] [command]\n\nGenerate and store local retrospectives and lessons learned from project or plan\nevidence\n\nOptions:\n  -h, --help           display help for command\n\nCommands:\n  create [options]     Create a local retrospective report\n  list [options]       List stored local retrospectives\n  show [options] <id>  Show one stored local retrospective\n  export [options]     Export stored local retrospectives as deterministic JSON\n                       or Markdown\n  help [command]       display help for command\n",
  "retro": "Usage: todos retrospectives|retro [options] [command]\n\nGenerate and store local retrospectives and lessons learned from project or plan\nevidence\n\nOptions:\n  -h, --help           display help for command\n\nCommands:\n  create [options]     Create a local retrospective report\n  list [options]       List stored local retrospectives\n  show [options] <id>  Show one stored local retrospective\n  export [options]     Export stored local retrospectives as deterministic JSON\n                       or Markdown\n  help [command]       display help for command\n",
  "retrospectives create": "Usage: todos retrospectives create [options]\n\nCreate a local retrospective report\n\nOptions:\n  --title <title>     Report title\n  --project <id>      Project to summarize\n  --plan <id>         Plan to summarize\n  --agent <id>        Agent creating the retrospective\n  --create-followups  Create suggested local follow-up tasks\n  -j, --json          Output as JSON\n  -h, --help          display help for command\n",
  "retrospectives list": "Usage: todos retrospectives list [options]\n\nList stored local retrospectives\n\nOptions:\n  --project <id>  Filter by project\n  --plan <id>     Filter by plan\n  --agent <id>    Filter by creating agent\n  --limit <n>     Maximum records (default: \"50\")\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "retrospectives show": "Usage: todos retrospectives show [options] <id>\n\nShow one stored local retrospective\n\nOptions:\n  --format <format>  json or markdown (default: \"json\")\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "retrospectives export": "Usage: todos retrospectives export [options]\n\nExport stored local retrospectives as deterministic JSON or Markdown\n\nOptions:\n  --project <id>     Filter by project\n  --plan <id>        Filter by plan\n  --agent <id>       Filter by creating agent\n  --limit <n>        Maximum records (default: \"100\")\n  --format <format>  json or markdown (default: \"json\")\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "reliability": "Usage: todos reliability|scorecards [options] [command]\n\nGenerate local-only agent reliability scorecards from tasks, runs, verification\nevidence, locks, retries, and handoffs\n\nOptions:\n  -h, --help              display help for command\n\nCommands:\n  show [options] <agent>  Show one local agent reliability scorecard\n  list [options]          List local agent reliability scorecards\n  export [options]        Export local agent reliability scorecards as\n                          deterministic JSON or Markdown\n  help [command]          display help for command\n",
  "scorecards": "Usage: todos reliability|scorecards [options] [command]\n\nGenerate local-only agent reliability scorecards from tasks, runs, verification\nevidence, locks, retries, and handoffs\n\nOptions:\n  -h, --help              display help for command\n\nCommands:\n  show [options] <agent>  Show one local agent reliability scorecard\n  list [options]          List local agent reliability scorecards\n  export [options]        Export local agent reliability scorecards as\n                          deterministic JSON or Markdown\n  help [command]          display help for command\n",
  "reliability show": "Usage: todos reliability show [options] <agent>\n\nShow one local agent reliability scorecard\n\nOptions:\n  --project <id>               Filter by project\n  --since <iso>                Only include task and evidence created at or\n                               after this timestamp\n  --stale-after-hours <hours>  Task locks older than this are considered stale\n                               (default: \"24\")\n  --format <format>            json or markdown (default: \"json\")\n  -j, --json                   Output as JSON\n  -h, --help                   display help for command\n",
  "reliability list": "Usage: todos reliability list [options]\n\nList local agent reliability scorecards\n\nOptions:\n  --agent <id>                 Filter by agent id or name\n  --project <id>               Filter by project\n  --since <iso>                Only include task and evidence created at or\n                               after this timestamp\n  --stale-after-hours <hours>  Task locks older than this are considered stale\n                               (default: \"24\")\n  --limit <n>                  Maximum scorecards (default: \"50\")\n  -j, --json                   Output as JSON\n  -h, --help                   display help for command\n",
  "reliability export": "Usage: todos reliability export [options]\n\nExport local agent reliability scorecards as deterministic JSON or Markdown\n\nOptions:\n  --agent <id>                 Filter by agent id or name\n  --project <id>               Filter by project\n  --since <iso>                Only include task and evidence created at or\n                               after this timestamp\n  --stale-after-hours <hours>  Task locks older than this are considered stale\n                               (default: \"24\")\n  --limit <n>                  Maximum scorecards (default: \"100\")\n  --format <format>            json or markdown (default: \"json\")\n  -j, --json                   Output as JSON\n  -h, --help                   display help for command\n",
  "onboarding": "Usage: todos onboarding|demo-fixtures [options]\n\nList, show, write, or import bundled local onboarding fixtures\n\nOptions:\n  --show <name>        Show one fixture bridge bundle as JSON\n  --write <dir>        Write all bundled fixture bridge bundles to a directory\n  --import <name>      Dry-run or apply an onboarding fixture import\n  --apply              Apply an onboarding fixture import. Defaults to dry-run.\n  --resolve-conflicts  Safely merge existing local tasks while preserving\n                       divergent fields\n  -h, --help           display help for command\n",
  "demo-fixtures": "Usage: todos onboarding|demo-fixtures [options]\n\nList, show, write, or import bundled local onboarding fixtures\n\nOptions:\n  --show <name>        Show one fixture bridge bundle as JSON\n  --write <dir>        Write all bundled fixture bridge bundles to a directory\n  --import <name>      Dry-run or apply an onboarding fixture import\n  --apply              Apply an onboarding fixture import. Defaults to dry-run.\n  --resolve-conflicts  Safely merge existing local tasks while preserving\n                       divergent fields\n  -h, --help           display help for command\n",
  "snapshots": "Usage: todos snapshots|local-snapshots [options]\n\nList, read, or poll local agent snapshots\n\nOptions:\n  --show <type>      Read one snapshot: projects, tasks, plans, runs,\n                     dependencies, events, or evidence\n  --poll             Poll snapshot resources and return only snapshots changed\n                     since --since\n  --types <list>     Comma-separated snapshot types for polling\n  --project-id <id>  Filter snapshots to one local project id\n  --since <iso>      Only include events or changed snapshots after this cursor\n  --limit <n>        Maximum items per snapshot (default: \"100\")\n  --markdown         Render the selected snapshot as Markdown\n  -h, --help         display help for command\n",
  "local-snapshots": "Usage: todos snapshots|local-snapshots [options]\n\nList, read, or poll local agent snapshots\n\nOptions:\n  --show <type>      Read one snapshot: projects, tasks, plans, runs,\n                     dependencies, events, or evidence\n  --poll             Poll snapshot resources and return only snapshots changed\n                     since --since\n  --types <list>     Comma-separated snapshot types for polling\n  --project-id <id>  Filter snapshots to one local project id\n  --since <iso>      Only include events or changed snapshots after this cursor\n  --limit <n>        Maximum items per snapshot (default: \"100\")\n  --markdown         Render the selected snapshot as Markdown\n  -h, --help         display help for command\n",
  "sdk-fixtures": "Usage: todos sdk-fixtures [options]\n\nList, show, or write local SDK integration fixtures\n\nOptions:\n  --show         Print the full fixture pack JSON\n  --write <dir>  Write fixture pack, bridge fixture, contract snapshots, and\n                 example index to a directory\n  -h, --help     display help for command\n",
  "reviews": "Usage: todos reviews|review-queue [options] [command]\n\nManage local review queues, reviewer claims, returns, approvals, and routing\nrules\n\nOptions:\n  -h, --help                   display help for command\n\nCommands:\n  list [options]               List local tasks waiting in review queues\n  request [options] <task-id>  Request local review for a task\n  claim [options] <task-id>    Claim a task from the local review queue\n  approve [options] <task-id>  Approve a reviewed task\n  return [options] <task-id>   Return a reviewed task with requested changes\n  reopen [options] <task-id>   Reopen a reviewed task for another review pass\n  rules                        Manage local review routing rules\n  help [command]               display help for command\n",
  "review-queue": "Usage: todos reviews|review-queue [options] [command]\n\nManage local review queues, reviewer claims, returns, approvals, and routing\nrules\n\nOptions:\n  -h, --help                   display help for command\n\nCommands:\n  list [options]               List local tasks waiting in review queues\n  request [options] <task-id>  Request local review for a task\n  claim [options] <task-id>    Claim a task from the local review queue\n  approve [options] <task-id>  Approve a reviewed task\n  return [options] <task-id>   Return a reviewed task with requested changes\n  reopen [options] <task-id>   Reopen a reviewed task for another review pass\n  rules                        Manage local review routing rules\n  help [command]               display help for command\n",
  "reviews list": "Usage: todos reviews list [options]\n\nList local tasks waiting in review queues\n\nOptions:\n  --queue <name>      Filter by review queue\n  --state <state>     Filter by review state\n  --reviewer <name>   Filter by assigned or claiming reviewer\n  --requester <name>  Filter by requester\n  --project <id>      Filter by project ID\n  --limit <n>         Maximum queue items\n  -h, --help          display help for command\n",
  "reviews request": "Usage: todos reviews request [options] <task-id>\n\nRequest local review for a task\n\nOptions:\n  --requester <name>  Requester agent or human\n  --reviewer <name>   Preferred reviewer\n  --queue <name>      Review queue name\n  --reason <text>     Reason for review\n  --notes <text>      Reviewer notes\n  -h, --help          display help for command\n",
  "reviews claim": "Usage: todos reviews claim [options] <task-id>\n\nClaim a task from the local review queue\n\nOptions:\n  --reviewer <name>  Reviewer claiming the task\n  --note <text>      Claim note\n  -h, --help         display help for command\n",
  "reviews approve": "Usage: todos reviews approve [options] <task-id>\n\nApprove a reviewed task\n\nOptions:\n  --reviewer <name>  Reviewer approving the task\n  --note <text>      Approval note\n  -h, --help         display help for command\n",
  "reviews return": "Usage: todos reviews return [options] <task-id>\n\nReturn a reviewed task with requested changes\n\nOptions:\n  --reviewer <name>  Reviewer returning the task\n  --changes <list>   Semicolon- or comma-separated requested changes\n  --note <text>      Return note\n  -h, --help         display help for command\n",
  "reviews reopen": "Usage: todos reviews reopen [options] <task-id>\n\nReopen a reviewed task for another review pass\n\nOptions:\n  --reviewer <name>  Reviewer reopening the review\n  --note <text>      Reopen note\n  -h, --help         display help for command\n",
  "reviews rules": "Usage: todos reviews rules [options] [command]\n\nManage local review routing rules\n\nOptions:\n  -h, --help            display help for command\n\nCommands:\n  list                  List local review routing rules\n  set [options] <name>  Create or update a local review routing rule\n  remove <name>         Remove a local review routing rule\n  help [command]        display help for command\n",
  "reviews rules list": "Usage: todos reviews rules list [options]\n\nList local review routing rules\n\nOptions:\n  -h, --help  display help for command\n",
  "reviews rules set": "Usage: todos reviews rules set [options] <name>\n\nCreate or update a local review routing rule\n\nOptions:\n  --queue <name>       Queue name\n  --reviewers <list>   Comma-separated reviewer names\n  --tags <list>        Comma-separated task tags matched by this rule\n  --priorities <list>  Comma-separated priorities matched by this rule\n  --project <id>       Project ID matched by this rule\n  --disable            Disable this rule\n  -h, --help           display help for command\n",
  "reviews rules remove": "Usage: todos reviews rules remove [options] <name>\n\nRemove a local review routing rule\n\nOptions:\n  -h, --help  display help for command\n",
  "roadmaps": "Usage: todos roadmaps|roadmap [options] [command]\n\nManage local roadmaps, milestones, and release groupings\n\nOptions:\n  -h, --help                  display help for command\n\nCommands:\n  create [options] <name>     Create a local roadmap\n  list [options]              List local roadmaps\n  show [options] <roadmap>    Show a roadmap summary\n  update [options] <roadmap>  Update a local roadmap\n  delete <roadmap>            Delete a local roadmap and its local\n                              milestone/release config\n  milestones                  Manage roadmap milestones\n  releases                    Manage roadmap release groups\n  export [options] <roadmap>  Export a roadmap as JSON bundle or Markdown\n  import [options] <path>     Preview or apply a roadmap JSON bundle\n  help [command]              display help for command\n",
  "roadmap": "Usage: todos roadmaps|roadmap [options] [command]\n\nManage local roadmaps, milestones, and release groupings\n\nOptions:\n  -h, --help                  display help for command\n\nCommands:\n  create [options] <name>     Create a local roadmap\n  list [options]              List local roadmaps\n  show [options] <roadmap>    Show a roadmap summary\n  update [options] <roadmap>  Update a local roadmap\n  delete <roadmap>            Delete a local roadmap and its local\n                              milestone/release config\n  milestones                  Manage roadmap milestones\n  releases                    Manage roadmap release groups\n  export [options] <roadmap>  Export a roadmap as JSON bundle or Markdown\n  import [options] <path>     Preview or apply a roadmap JSON bundle\n  help [command]              display help for command\n",
  "roadmaps create": "Usage: todos roadmaps create [options] <name>\n\nCreate a local roadmap\n\nOptions:\n  --description <text>  Description\n  --project <id>        Project ID\n  --status <status>     planned, active, completed, archived\n  --owner <name>        Owner name\n  --agent <name>        Agent owner\n  --release <name>      Default release label\n  -h, --help            display help for command\n",
  "roadmaps list": "Usage: todos roadmaps list [options]\n\nList local roadmaps\n\nOptions:\n  --project <id>     Project ID\n  --status <status>  Filter by status\n  -h, --help         display help for command\n",
  "roadmaps show": "Usage: todos roadmaps show [options] <roadmap>\n\nShow a roadmap summary\n\nOptions:\n  --format <format>  json or markdown (default: \"json\")\n  -h, --help         display help for command\n",
  "roadmaps update": "Usage: todos roadmaps update [options] <roadmap>\n\nUpdate a local roadmap\n\nOptions:\n  --name <name>         New name\n  --description <text>  Description\n  --project <id>        Project ID\n  --status <status>     planned, active, completed, archived\n  --owner <name>        Owner name\n  --agent <name>        Agent owner\n  --release <name>      Release label\n  -h, --help            display help for command\n",
  "roadmaps delete": "Usage: todos roadmaps delete [options] <roadmap>\n\nDelete a local roadmap and its local milestone/release config\n\nOptions:\n  -h, --help  display help for command\n",
  "roadmaps milestones": "Usage: todos roadmaps milestones [options] [command]\n\nManage roadmap milestones\n\nOptions:\n  -h, --help                       display help for command\n\nCommands:\n  add [options] <roadmap> <title>  Add a milestone to a roadmap\n  update [options] <milestone>     Update a roadmap milestone\n  help [command]                   display help for command\n",
  "roadmaps milestones add": "Usage: todos roadmaps milestones add [options] <roadmap> <title>\n\nAdd a milestone to a roadmap\n\nOptions:\n  --description <text>  Description\n  --due <iso>           Due date or timestamp\n  --status <status>     planned, active, completed, blocked, archived\n  --owner <name>        Owner name\n  --agent <name>        Agent owner\n  --tasks <list>        Comma-separated task IDs\n  --plans <list>        Comma-separated plan IDs\n  --runs <list>         Comma-separated run IDs\n  --release <name>      Release label\n  --tags <list>         Comma-separated tags\n  -h, --help            display help for command\n",
  "roadmaps milestones update": "Usage: todos roadmaps milestones update [options] <milestone>\n\nUpdate a roadmap milestone\n\nOptions:\n  --title <title>       Title\n  --description <text>  Description\n  --due <iso>           Due date or timestamp\n  --status <status>     planned, active, completed, blocked, archived\n  --owner <name>        Owner name\n  --agent <name>        Agent owner\n  --tasks <list>        Comma-separated task IDs\n  --plans <list>        Comma-separated plan IDs\n  --runs <list>         Comma-separated run IDs\n  --release <name>      Release label\n  --tags <list>         Comma-separated tags\n  -h, --help            display help for command\n",
  "roadmaps releases": "Usage: todos roadmaps releases [options] [command]\n\nManage roadmap release groups\n\nOptions:\n  -h, --help                      display help for command\n\nCommands:\n  set [options] <roadmap> <name>  Create or update a release grouping\n  help [command]                  display help for command\n",
  "roadmaps releases set": "Usage: todos roadmaps releases set [options] <roadmap> <name>\n\nCreate or update a release grouping\n\nOptions:\n  --release-version <version>  Version label\n  --status <status>            planned, active, completed, blocked, archived\n  --milestones <list>          Comma-separated milestone IDs\n  --tasks <list>               Comma-separated task IDs\n  --plans <list>               Comma-separated plan IDs\n  --runs <list>                Comma-separated run IDs\n  --notes <text>               Release notes\n  -h, --help                   display help for command\n",
  "roadmaps export": "Usage: todos roadmaps export [options] <roadmap>\n\nExport a roadmap as JSON bundle or Markdown\n\nOptions:\n  --format <format>  json or markdown (default: \"json\")\n  --out <path>       Write output to a file\n  -h, --help         display help for command\n",
  "roadmaps import": "Usage: todos roadmaps import [options] <path>\n\nPreview or apply a roadmap JSON bundle\n\nOptions:\n  --apply     Apply the import\n  -h, --help  display help for command\n",
  "capacity": "Usage: todos capacity [options] [command]\n\nManage local capacity profiles and planning forecasts\n\nOptions:\n  -h, --help                      display help for command\n\nCommands:\n  set [options] <agent>           Create or update a local agent capacity\n                                  profile\n  list [options]                  List local capacity profiles\n  remove [options] <agent-or-id>  Remove a local capacity profile\n  forecast [options]              Forecast local plan or project completion from\n                                  estimates and capacity\n  help [command]                  display help for command\n",
  "capacity set": "Usage: todos capacity set [options] <agent>\n\nCreate or update a local agent capacity profile\n\nOptions:\n  --minutes-per-day <minutes>  Available minutes per working day\n  --project <id>               Project ID\n  --days <list>                Working days as 0-6, where 0 is Sunday (default:\n                               \"1,2,3,4,5\")\n  --from <date>                Effective date\n  -h, --help                   display help for command\n",
  "capacity list": "Usage: todos capacity list [options]\n\nList local capacity profiles\n\nOptions:\n  --agent <id>    Filter by agent\n  --project <id>  Filter by project\n  -h, --help      display help for command\n",
  "capacity remove": "Usage: todos capacity remove [options] <agent-or-id>\n\nRemove a local capacity profile\n\nOptions:\n  --project <id>  Project ID for agent-scoped removal\n  -h, --help      display help for command\n",
  "capacity forecast": "Usage: todos capacity forecast [options]\n\nForecast local plan or project completion from estimates and capacity\n\nOptions:\n  --project <id>       Project ID\n  --plan <id>          Plan ID\n  --agent <id>         Agent filter\n  --start-date <date>  Forecast start date\n  --format <format>    json or markdown (default: \"json\")\n  -h, --help           display help for command\n",
  "audit-ledger": "Usage: todos audit-ledger [options] [command]\n\nCreate and verify tamper-evident local audit ledger checkpoints\n\nOptions:\n  -h, --help                     display help for command\n\nCommands:\n  show [options]                 Build a local audit hash chain from current\n                                 evidence\n  seal [options] <name>          Store a local audit ledger checkpoint for later\n                                 verification\n  list                           List local audit ledger checkpoints\n  verify [options] <checkpoint>  Verify current local evidence against a sealed\n                                 checkpoint\n  help [command]                 display help for command\n",
  "audit-ledger show": "Usage: todos audit-ledger show [options]\n\nBuild a local audit hash chain from current evidence\n\nOptions:\n  --project <id>     Project ID\n  --task <id>        Task ID\n  --run <id>         Run ID\n  --entries          Include per-entry hashes and redacted payloads\n  --format <format>  json or markdown (default: \"json\")\n  -h, --help         display help for command\n",
  "audit-ledger seal": "Usage: todos audit-ledger seal [options] <name>\n\nStore a local audit ledger checkpoint for later verification\n\nOptions:\n  --project <id>  Project ID\n  --task <id>     Task ID\n  --run <id>      Run ID\n  --note <text>   Checkpoint note\n  -h, --help      display help for command\n",
  "audit-ledger list": "Usage: todos audit-ledger list [options]\n\nList local audit ledger checkpoints\n\nOptions:\n  -h, --help  display help for command\n",
  "audit-ledger verify": "Usage: todos audit-ledger verify [options] <checkpoint>\n\nVerify current local evidence against a sealed checkpoint\n\nOptions:\n  --format <format>  json or markdown (default: \"json\")\n  -h, --help         display help for command\n",
  "release-compat": "Usage: todos release-compat [options] [command]\n\nCheck local release compatibility, migrations, exports, and Bun install guidance\n\nOptions:\n  -h, --help       display help for command\n\nCommands:\n  check [options]  Build a local release compatibility report\n  help [command]   display help for command\n",
  "release-compat check": "Usage: todos release-compat check [options]\n\nBuild a local release compatibility report\n\nOptions:\n  --root <path>      Package root (defaults to the current directory at\n                     execution)\n  --levels <csv>     Comma-separated migration levels to simulate\n  --format <format>  json or markdown (default: \"json\")\n  -h, --help         display help for command\n",
  "usage": "Usage: todos usage [options] [command]\n\nReport local task, run, command, cost, duration, storage, and quota usage\n\nOptions:\n  -h, --help        display help for command\n\nCommands:\n  report [options]  Build an aggregate local usage ledger\n  help [command]    display help for command\n",
  "usage report": "Usage: todos usage report [options]\n\nBuild an aggregate local usage ledger\n\nOptions:\n  --project <id>           Filter by project\n  --agent <name>           Filter by agent\n  --since <iso>            Only include records created or started at or after\n                           this timestamp\n  --until <iso>            Only include records created or started at or before\n                           this timestamp\n  --max-tasks <n>          Simulate a task quota\n  --max-projects <n>       Simulate a project quota\n  --max-runs <n>           Simulate a run quota\n  --max-commands <n>       Simulate a command quota\n  --max-tokens <n>         Simulate a token quota\n  --max-cost-usd <n>       Simulate a USD cost quota\n  --max-storage-bytes <n>  Simulate an evidence storage quota\n  --format <format>        json or markdown (default: \"json\")\n  -j, --json               Output as JSON\n  -h, --help               display help for command\n",
  "backup": "Usage: todos backup [options] [command]\n\nCreate, verify, restore, and inspect local backup bundles\n\nOptions:\n  -h, --help                display help for command\n\nCommands:\n  create [options]          Create a local backup bundle with a manifest and\n                            checksums\n  verify [options] <file>   Verify a local backup bundle checksum, manifest,\n                            bridge schema, and current SQLite integrity\n  restore [options] <file>  Dry-run or apply a local backup restore. Dry-run is\n                            the default.\n  integrity [options]       Check local SQLite, bridge, count, and orphan-row\n                            integrity\n  help [command]            display help for command\n",
  "backup create": "Usage: todos backup create [options]\n\nCreate a local backup bundle with a manifest and checksums\n\nOptions:\n  -o, --output <path>  Write backup JSON to a file\n  --project-id <id>    Project id to scope the backup. Defaults to auto-detected\n                       project when available.\n  -j, --json           Output as JSON\n  -h, --help           display help for command\n",
  "backup verify": "Usage: todos backup verify [options] <file>\n\nVerify a local backup bundle checksum, manifest, bridge schema, and current\nSQLite integrity\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "backup restore": "Usage: todos backup restore [options] <file>\n\nDry-run or apply a local backup restore. Dry-run is the default.\n\nOptions:\n  --apply              Apply the restore. Defaults to dry-run.\n  --resolve-conflicts  Safely merge existing local tasks while preserving\n                       divergent fields\n  -j, --json           Output as JSON\n  -h, --help           display help for command\n",
  "backup integrity": "Usage: todos backup integrity [options]\n\nCheck local SQLite, bridge, count, and orphan-row integrity\n\nOptions:\n  --project-id <id>  Optional project id to scope bridge counts\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "storage": "Usage: todos storage [options] [command]\n\nInspect local storage and Stage B configured intent; remote runtime stays\ndisabled in Stage A\n\nOptions:\n  -h, --help               display help for command\n\nCommands:\n  status [options]         Show redacted local status and configured remote\n                           intent; remote_enabled remains false in Stage A\n  sync-plan [options]      Show a no-network Stage B-deferred sync design; it\n                           never enables or runs remote sync\n  shadow-status [options]  Stage B deferred: remote shadow status is unavailable\n                           while Stage A authority is disabled\n  shadow-drain [options]   Stage B deferred: remote shadow drain is unavailable\n                           while Stage A authority is disabled\n  artifacts                Stage B-deferred S3 artifact design; apply is denied\n                           in Stage A\n  help [command]           display help for command\n",
  "storage status": "Usage: todos storage status [options]\n\nShow redacted local status and configured remote intent; remote_enabled remains\nfalse in Stage A\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "storage sync-plan": "Usage: todos storage sync-plan [options]\n\nShow a no-network Stage B-deferred sync design; it never enables or runs remote\nsync\n\nOptions:\n  --schema-sql  Include Postgres schema SQL in the dry-run output\n  -j, --json    Output as JSON\n  -h, --help    display help for command\n",
  "storage shadow-status": "Usage: todos storage shadow-status [options]\n\nStage B deferred: remote shadow status is unavailable while Stage A authority is\ndisabled\n\nOptions:\n  -j, --json  Output as JSON\n  -h, --help  display help for command\n",
  "storage shadow-drain": "Usage: todos storage shadow-drain [options]\n\nStage B deferred: remote shadow drain is unavailable while Stage A authority is\ndisabled\n\nOptions:\n  -j, --json      Output as JSON\n  --timeout <ms>  Max drain time in milliseconds (default: \"30000\")\n  -h, --help      display help for command\n",
  "storage artifacts": "Usage: todos storage artifacts [options] [command]\n\nStage B-deferred S3 artifact design; apply is denied in Stage A\n\nOptions:\n  -h, --help          display help for command\n\nCommands:\n  upload [options]    Preview Stage B-deferred uploads locally; --apply is\n                      denied in Stage A\n  download [options]  Preview Stage B-deferred downloads locally; --apply is\n                      denied in Stage A\n  help [command]      display help for command\n",
  "storage artifacts upload": "Usage: todos storage artifacts upload [options]\n\nPreview Stage B-deferred uploads locally; --apply is denied in Stage A\n\nOptions:\n  --run-id <id>             Limit to one run id\n  --task-id <id>            Limit to one task id\n  --limit <n>               Maximum artifacts to scan\n  --include-already-synced  Include artifacts that already have a remote\n                            reference\n  --apply                   Perform S3 uploads. Defaults to dry-run.\n  -j, --json                Output as JSON\n  -h, --help                display help for command\n",
  "storage artifacts download": "Usage: todos storage artifacts download [options]\n\nPreview Stage B-deferred downloads locally; --apply is denied in Stage A\n\nOptions:\n  --run-id <id>   Limit to one run id\n  --task-id <id>  Limit to one task id\n  --limit <n>     Maximum artifacts to scan\n  --force         Download even when local stored content already verifies\n  --apply         Perform S3 downloads. Defaults to dry-run.\n  -j, --json      Output as JSON\n  -h, --help      display help for command\n",
  "scale": "Usage: todos scale [options] [command]\n\nBenchmark local performance, archive readiness, compaction, and SQLite integrity\n\nOptions:\n  -h, --help         display help for command\n\nCommands:\n  report [options]   Build a local scale hardening report without network access\n  compact [options]  Preview or apply local SQLite optimization and VACUUM\n                     compaction\n  help [command]     display help for command\n",
  "scale report": "Usage: todos scale report [options]\n\nBuild a local scale hardening report without network access\n\nOptions:\n  --older-than-days <days>  Archive-readiness window for terminal tasks\n                            (default: \"30\")\n  --format <format>         json or markdown (default: \"markdown\")\n  -j, --json                Output as JSON\n  -h, --help                display help for command\n",
  "scale compact": "Usage: todos scale compact [options]\n\nPreview or apply local SQLite optimization and VACUUM compaction\n\nOptions:\n  --apply            Run PRAGMA optimize and VACUUM; dry-run by default\n  --format <format>  json or markdown (default: \"json\")\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n",
  "webhooks": "Usage: todos webhooks [options] [command]\n\nManage Hasna event webhook subscriptions\n\nOptions:\n  -h, --help              display help for command\n\nCommands:\n  add [options] <target>  Add or replace a webhook or command subscription\n  list [options]          List configured subscriptions\n  status [options]        Show events webhook storage status\n  remove [options] <id>   Remove a subscription\n  test [options] <id>     Send a test event to one subscription\n  match [options] <id>    Check whether a sample event matches one subscription\n                          without delivering\n  help [command]          display help for command\n",
  "webhooks add": "Usage: todos webhooks add [options] <target>\n\nAdd or replace a webhook or command subscription\n\nArguments:\n  target                          Webhook URL or command binary\n\nOptions:\n  --id <id>                       Subscription/channel identifier\n  --transport <kind>              Transport kind: webhook or command (default:\n                                  \"webhook\")\n  --name <name>                   Display name\n  --type <pattern>                Event type filter, e.g. todos.task.*\n  --source <pattern>              Event source filter\n  --subject <pattern>             Event subject filter\n  --severity <pattern>            Event severity filter\n  --data <path=value...>          Event data field filter; string values,\n                                  path!=value negatives, array-member matching,\n                                  dot paths, * segment wildcard, ** recursive\n                                  wildcard (default: [])\n  --metadata <path=value...>      Event metadata field filter; string values,\n                                  path!=value negatives, array-member matching,\n                                  dot paths, * segment wildcard, ** recursive\n                                  wildcard (default: [])\n  --data-json <path=json...>      Event data field filter with typed JSON value;\n                                  path!=json negatives supported (default: [])\n  --metadata-json <path=json...>  Event metadata field filter with typed JSON\n                                  value; path!=json negatives supported\n                                  (default: [])\n  --secret <secret>               Webhook HMAC secret\n  --header <name=value...>        Webhook header (default: [])\n  --arg <arg...>                  Command argument (default: [])\n  --timeout-ms <ms>               Transport timeout in milliseconds\n  --retry-attempts <n>            Maximum delivery attempts\n  --retry-backoff-ms <ms>         Initial retry backoff in milliseconds\n  --redact <path...>              Event field path to redact before delivery\n                                  (default: [])\n  --disabled                      Create channel disabled (default: false)\n  -j, --json                      Print JSON output (default: false)\n  -h, --help                      display help for command\n",
  "webhooks list": "Usage: todos webhooks list [options]\n\nList configured subscriptions\n\nOptions:\n  -j, --json  Print JSON output (default: false)\n  -h, --help  display help for command\n",
  "webhooks status": "Usage: todos webhooks status [options]\n\nShow events webhook storage status\n\nOptions:\n  -j, --json  Print JSON output (default: false)\n  -h, --help  display help for command\n",
  "webhooks remove": "Usage: todos webhooks remove [options] <id>\n\nRemove a subscription\n\nArguments:\n  id          Subscription/channel identifier\n\nOptions:\n  -j, --json  Print JSON output (default: false)\n  -h, --help  display help for command\n",
  "webhooks test": "Usage: todos webhooks test [options] <id>\n\nSend a test event to one subscription\n\nArguments:\n  id                   Subscription/channel identifier\n\nOptions:\n  --source <source>    Event source override\n  --type <type>        Event type (default: \"events.test\")\n  --subject <subject>  Event subject\n  --message <message>  Event message (default: \"Hasna events test delivery\")\n  --data <json>        Event data JSON object\n  --metadata <json>    Event metadata JSON object\n  --honor-filters      Skip delivery when the sample event does not match\n                       channel filters (default: false)\n  -j, --json           Print JSON output (default: false)\n  -h, --help           display help for command\n",
  "webhooks match": "Usage: todos webhooks match [options] <id>\n\nCheck whether a sample event matches one subscription without delivering\n\nArguments:\n  id                   Subscription/channel identifier\n\nOptions:\n  --source <source>    Event source override\n  --type <type>        Event type (default: \"events.test\")\n  --subject <subject>  Event subject\n  --message <message>  Event message (default: \"Hasna events match preview\")\n  --data <json>        Event data JSON object\n  --metadata <json>    Event metadata JSON object\n  -j, --json           Print JSON output (default: false)\n  -h, --help           display help for command\n",
  "events": "Usage: todos events [options] [command]\n\nEmit, list, and replay Hasna events\n\nOptions:\n  -h, --help             display help for command\n\nCommands:\n  emit [options] <type>  Emit an event from this app\n  list [options]         List recorded events\n  replay [options]       Replay recorded events\n  help [command]         display help for command\n",
  "events emit": "Usage: todos events emit [options] <type>\n\nEmit an event from this app\n\nArguments:\n  type                   Event type\n\nOptions:\n  --source <source>      Event source override\n  --subject <subject>    Event subject\n  --severity <severity>  Event severity (default: \"info\")\n  --message <message>    Event message\n  --dedupe-key <key>     Dedupe key\n  --data <json>          Event data JSON object\n  --metadata <json>      Event metadata JSON object\n  --no-deliver           Record without delivering\n  --no-dedupe            Allow duplicate id/dedupeKey events\n  -j, --json             Print JSON output (default: false)\n  -h, --help             display help for command\n",
  "events list": "Usage: todos events list [options]\n\nList recorded events\n\nOptions:\n  --source <source>  Filter by source\n  --type <type>      Filter by type\n  --limit <n>        Limit results\n  -j, --json         Print JSON output (default: false)\n  -h, --help         display help for command\n",
  "events replay": "Usage: todos events replay [options]\n\nReplay recorded events\n\nOptions:\n  --id <id>          Replay one event id\n  --source <source>  Filter by source\n  --type <type>      Filter by type\n  --dry-run          Preview without delivery (default: false)\n  -j, --json         Print JSON output (default: false)\n  -h, --help         display help for command\n",
  "completions": "Usage: todos completions|completion [options] <shell>\n\nGenerate shell completions for bash, zsh, or fish\n\nArguments:\n  shell       Shell to generate: bash, zsh, or fish\n\nOptions:\n  -h, --help  display help for command\n",
  "completion": "Usage: todos completions|completion [options] <shell>\n\nGenerate shell completions for bash, zsh, or fish\n\nArguments:\n  shell       Shell to generate: bash, zsh, or fish\n\nOptions:\n  -h, --help  display help for command\n",
  "manual": "Usage: todos manual [options]\n\nPrint the complete local CLI manual\n\nOptions:\n  --format <format>  markdown or json (default: \"markdown\")\n  -j, --json         Output as JSON\n  -h, --help         display help for command\n"
};
