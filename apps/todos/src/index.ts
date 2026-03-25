// REST SDK Client (for cross-process/cross-machine use)
export { TodosClient, createClient } from "./sdk.js";
export type { TodosClientOptions } from "./sdk.js";

// Core database
export { getDatabase, closeDatabase, resetDatabase, resolvePartialId, now, uuid } from "./db/database.js";

// Tasks
export {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  countTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
  getTaskDependencies,
  getTaskDependents,
  getBlockingDeps,
  bulkUpdateTasks,
  bulkCreateTasks,
  cloneTask,
  getTaskStats,
  getTaskGraph,
  moveTask,
  getNextTask,
  claimNextTask,
  stealTask,
  claimOrSteal,
  logCost,
  getActiveWork,
  failTask,
  getTasksChangedSince,
  getStaleTasks,
  getStatus,
  decomposeTasks,
  setTaskStatus,
  setTaskPriority,
  redistributeStaleTasks,
  getOverdueTasks,
} from "./db/tasks.js";
export type { TaskGraphNode, TaskGraph, BulkCreateTaskInput, ActiveWorkItem, StatusSummary, DecomposeSubtaskInput } from "./db/tasks.js";

// Projects
export {
  createProject,
  getProject,
  getProjectByPath,
  getProjectWithSources,
  listProjects,
  updateProject,
  deleteProject,
  ensureProject,
  nextTaskShortId,
  slugify,
  addProjectSource,
  removeProjectSource,
  listProjectSources,
} from "./db/projects.js";

// Plans
export {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "./db/plans.js";

// Comments
export {
  addComment,
  getComment,
  listComments,
  deleteComment,
  logProgress,
} from "./db/comments.js";

// Agents
export {
  registerAgent,
  isAgentConflict,
  releaseAgent,
  autoReleaseStaleAgents,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgent,
  updateAgentActivity,
  deleteAgent,
  archiveAgent,
  unarchiveAgent,
  getDirectReports,
  getOrgChart,
  matchCapabilities,
  getCapableAgents,
} from "./db/agents.js";
export type { OrgNode } from "./db/agents.js";

// Task Lists
export {
  createTaskList,
  getTaskList,
  getTaskListBySlug,
  listTaskLists,
  updateTaskList,
  deleteTaskList,
  ensureTaskList,
} from "./db/task-lists.js";

// Sessions
export {
  createSession,
  getSession,
  listSessions,
  updateSessionActivity,
  deleteSession,
} from "./db/sessions.js";

// Audit
export { logTaskChange, getTaskHistory, getRecentActivity, getRecap } from "./db/audit.js";
export type { RecapSummary } from "./db/audit.js";

// Training data gatherer (for @hasna/brains fine-tuning integration)
export { gatherTrainingData } from "./lib/gatherer.js";

// Model config (active fine-tuned model ID)
export {
  getActiveModel,
  setActiveModel,
  clearActiveModel,
  DEFAULT_MODEL,
} from "./lib/model-config.js";

// Webhooks
export { createWebhook, getWebhook, listWebhooks, deleteWebhook, dispatchWebhook, listDeliveries } from "./db/webhooks.js";
export type { WebhookDelivery } from "./db/webhooks.js";

// Templates
export { createTemplate, getTemplate, listTemplates, deleteTemplate, updateTemplate, taskFromTemplate, addTemplateTasks, getTemplateWithTasks, getTemplateTasks, tasksFromTemplate, previewTemplate, resolveVariables, evaluateCondition, exportTemplate, importTemplate, getTemplateVersion, listTemplateVersions } from "./db/templates.js";
export type { TemplatePreview, TemplatePreviewTask, UpdateTemplateInput, TemplateExport } from "./db/templates.js";

// Built-in Templates
export { initBuiltinTemplates, BUILTIN_TEMPLATES } from "./db/builtin-templates.js";
export type { BuiltinTemplate } from "./db/builtin-templates.js";

// Checklists
export {
  getChecklist,
  addChecklistItem,
  checkChecklistItem,
  updateChecklistItemText,
  removeChecklistItem,
  clearChecklist,
  getChecklistStats,
} from "./db/checklists.js";

// Handoffs
export { createHandoff, listHandoffs, getLatestHandoff } from "./db/handoffs.js";
export type { Handoff, CreateHandoffInput } from "./db/handoffs.js";

// Task Files
export { addTaskFile, getTaskFile, listTaskFiles, findTasksByFile, updateTaskFileStatus, removeTaskFile, bulkAddTaskFiles } from "./db/task-files.js";
export type { TaskFile, AddTaskFileInput } from "./db/task-files.js";

// Locks
export { acquireLock, releaseLock, checkLock, cleanExpiredLocks } from "./db/locks.js";
export type { ResourceLock } from "./db/locks.js";

// Orgs
export { createOrg, getOrg, getOrgByName, listOrgs, updateOrg, deleteOrg } from "./db/orgs.js";

// Task Relationships
export {
  addTaskRelationship,
  getTaskRelationship,
  removeTaskRelationship,
  removeTaskRelationshipByPair,
  getTaskRelationships,
  findRelatedTaskIds,
  autoDetectFileRelationships,
} from "./db/task-relationships.js";
export { RELATIONSHIP_TYPES } from "./db/task-relationships.js";
export type { TaskRelationship, AddTaskRelationshipInput, RelationshipType } from "./db/task-relationships.js";

// Knowledge Graph
export { syncKgEdges, getRelated, findPath, getImpactAnalysis, getCriticalPath, addKgEdge, removeKgEdges } from "./db/kg.js";
export type { KgEdge } from "./db/kg.js";

// Patrol & Review
export { patrolTasks, getReviewQueue } from "./db/patrol.js";
export type { PatrolIssue, PatrolResult } from "./db/patrol.js";

// Agent Metrics
export { getAgentMetrics, getLeaderboard, scoreTask } from "./db/agent-metrics.js";
export type { AgentMetrics, LeaderboardEntry } from "./db/agent-metrics.js";

// Search
export { searchTasks } from "./lib/search.js";
export type { SearchOptions } from "./lib/search.js";

// Sync
export { defaultSyncAgents, syncWithAgent, syncWithAgents } from "./lib/sync.js";
export type { SyncResult } from "./lib/sync-types.js";

// PG Migrations
export { applyPgMigrations } from "./db/pg-migrate.js";
export type { PgMigrationResult } from "./db/pg-migrate.js";

// Extract
export { extractTodos, extractFromSource, tagToPriority, EXTRACT_TAGS } from "./lib/extract.js";

// Burndown
export { getBurndown } from "./lib/burndown.js";
export type { BurndownData } from "./lib/burndown.js";

// GitHub import
export { parseGitHubUrl, fetchGitHubIssue, issueToTask } from "./lib/github.js";
export type { GitHubIssue } from "./lib/github.js";

// Traces
export { logTrace, getTaskTraces, getTraceStats } from "./db/traces.js";
export type { TaskTrace, LogTraceInput, TraceType } from "./db/traces.js";

// Context Snapshots
export { saveSnapshot, getLatestSnapshot, listSnapshots } from "./db/snapshots.js";
export type { ContextSnapshot, SaveSnapshotInput, SnapshotType } from "./db/snapshots.js";

// Agent Budgets
export { setBudget, getBudget, checkBudget } from "./db/budgets.js";
export type { AgentBudget, BudgetCheck } from "./db/budgets.js";
export type { ExtractedComment, ExtractOptions, ExtractResult, ExtractTag } from "./lib/extract.js";

// Config
export { loadConfig, getCompletionGuardConfig } from "./lib/config.js";
export type { TodosConfig, AgentConfig, CompletionGuardConfig } from "./lib/config.js";

// Completion Guard
export { checkCompletionGuard } from "./lib/completion-guard.js";

// Recurrence
export { parseRecurrenceRule, isValidRecurrenceRule, nextOccurrence } from "./lib/recurrence.js";
export type { ParsedRule } from "./lib/recurrence.js";

// Types
export type {
  Task,
  TaskWithRelations,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
  TaskPriority,
  TaskDependency,
  TaskComment,
  CreateCommentInput,
  Project,
  CreateProjectInput,
  ProjectSource,
  ProjectSourceRow,
  CreateProjectSourceInput,
  ChecklistItem,
  ChecklistItemRow,
  CreateChecklistItemInput,
  Plan,
  CreatePlanInput,
  UpdatePlanInput,
  PlanStatus,
  Session,
  CreateSessionInput,
  Agent,
  AgentRow,
  RegisterAgentInput,
  TaskList,
  TaskListRow,
  CreateTaskListInput,
  UpdateTaskListInput,
  LockResult,
  TaskRow,
  SessionRow,
  TaskHistory,
  Webhook,
  CreateWebhookInput,
  TaskTemplate,
  CreateTemplateInput,
  TemplateTask,
  TemplateTaskInput,
  TemplateWithTasks,
  TemplateVariable,
  TemplateVersion,
  Org,
  CreateOrgInput,
} from "./types/index.js";

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  PLAN_STATUSES,
  DISPATCH_STATUSES,
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  PlanNotFoundError,
  LockError,
  DependencyCycleError,
  AgentNotFoundError,
  TaskListNotFoundError,
  CompletionGuardError,
  DispatchNotFoundError,
} from "./types/index.js";

// Dispatch types
export type {
  Dispatch,
  DispatchStatus,
  DispatchLog,
  TmuxTarget,
  CreateDispatchInput,
  ListDispatchesFilter,
} from "./types/index.js";

// Dispatch DB functions
export {
  createDispatch,
  getDispatch,
  listDispatches,
  cancelDispatch,
  updateDispatchStatus,
  createDispatchLog,
  listDispatchLogs,
  getDueDispatches,
} from "./db/dispatches.js";

// Dispatch engine
export { executeDispatch, runDueDispatches, dispatchToMultiple } from "./lib/dispatch.js";

// Dispatch formatter
export { formatDispatchMessage, formatSingleTask } from "./lib/dispatch-formatter.js";
export type { FormatOpts } from "./lib/dispatch-formatter.js";

// tmux primitives
export { parseTmuxTarget, formatTmuxTarget, validateTmuxTarget, sendToTmux, calculateDelay, DELAY_MIN, DELAY_MAX } from "./lib/tmux.js";
