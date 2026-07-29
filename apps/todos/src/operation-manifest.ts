/**
 * Canonical cross-surface operation inventory.
 *
 * This file is deliberately data-only so Stage A can load it before any module
 * that can open SQLite. CLI routing, public HTTP/OpenAPI inventory, generated
 * SDK coverage, MCP conformance, documentation counts, and drift tests all
 * consume this manifest.
 */

export const TODOS_OPERATION_MANIFEST_SCHEMA = "todos.operation_manifest.v1";

export type OperationTopology =
  | "shared-customer-domain"
  | "local-topology-only"
  | "removed";

export type PublicHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type OperationAuth = "none" | "api-key:read" | "api-key:write";
export type OperationPagination = "none" | "offset" | "cursor";

export interface PublicHttpOperation {
  operationId: string;
  method: PublicHttpMethod;
  path: string;
  summary: string;
  auth: OperationAuth;
  pagination: OperationPagination;
  requestSchema: string | null;
  responseSchema: string;
  errors: readonly number[];
}

export interface CliOperation {
  path: string;
  topology: OperationTopology;
  httpOperationIds: readonly string[];
  mcpTools: readonly string[];
  requestSchema: string | null;
  responseSchema: string;
  errors: readonly string[];
  pagination: OperationPagination;
}

export interface TodosOperationManifest {
  schemaVersion: typeof TODOS_OPERATION_MANIFEST_SCHEMA;
  aliases: readonly [];
  cli: readonly CliOperation[];
  http: readonly PublicHttpOperation[];
}

export const REMOTE_DIAGNOSTIC_COMMANDS = ["help", "manual", "completions", "config", "storage"] as const;

export interface CliRemoteInvocationRule {
  deniedOptions?: readonly string[];
  deniedGlobalOptions?: readonly string[];
  allowedActions?: readonly string[];
  unrestrictedActions?: readonly string[];
}

/** Option-level exceptions for otherwise shared command leaves. */
export const CLI_REMOTE_INVOCATION_RULES: Readonly<Record<string, CliRemoteInvocationRule>> = {
  doctor: { deniedOptions: ["--apply", "--fix"] },
  projects: { deniedOptions: ["--deregister", "--path-prefix", "--dry-run"] },
  plans: { deniedOptions: ["--artifact", "--write-artifacts"] },
  list: { deniedOptions: ["--tags", "--tag", "--recurring"] },
  claim: {
    deniedOptions: ["--project", "--stale-minutes", "--steal-stale"],
    deniedGlobalOptions: ["--project"],
  },
  status: { deniedOptions: ["--agent"], deniedGlobalOptions: ["--agent"] },
  bulk: {
    allowedActions: ["done", "complete", "start", "delete", "plan", "move-plan"],
    unrestrictedActions: ["plan", "move-plan"],
    deniedOptions: ["--plan", "--clear-plan"],
  },
};

const CLI_INVOCATIONS = `
active
add
agent
agent-runs adapter-remove
agent-runs adapter-set
agent-runs adapters
agent-runs cancel
agent-runs list
agent-runs queue
agent-runs retry
agent-runs run-next
agent-update
agents
agents-normalize
api-keys create
api-keys list
api-keys revoke
api-keys verify
approvals approve
approvals check
approvals expire
approvals list
approvals reject
approvals require
approve
assign
audit-ledger list
audit-ledger seal
audit-ledger show
audit-ledger verify
backup create
backup integrity
backup restore
backup verify
blame
blocked
board create
board delete
board export
board import
board list
board move
board show
board tui
branch-plan
bridge-import
bulk
burndown
calendar add
calendar export
calendar import
calendar list
capacity forecast
capacity list
capacity remove
capacity set
claim
comment
completions
config
context
context-pack
contracts check
contracts request-review
contracts review
contracts set
contracts show
count
dashboard
dedupe merge
dedupe scan
delete
deps
dispatch
dispatch run
dispatches
doctor
doctor routing
done
encryption list
encryption remove
encryption set
encryption status
encryption test
env-snapshot capture
env-snapshot compare
event-hooks list
event-hooks remove
event-hooks set
event-hooks test
events emit
events list
events replay
export
extensions compat
extensions discover
extensions inspect
extensions install
extensions list
extensions remove
extensions verify
extract
extract-watch
fail
fields query
fields set
fields show
find-commit
find-ref
findings list
findings resolve-missing
findings upsert
focus
handoff
health
heartbeat
history
hook install
hook uninstall
hooks install
import
inbox add
inbox git
inbox list
inbox parse
inbox show
init
inspect
interactive
issues import
issues report
knowledge add
knowledge export
knowledge list
knowledge search
knowledge show
knowledge snapshot
link-commit
link-ref
list
lists
lock
log
machines
machines archive
machines delete
machines heartbeat
machines register
machines set-primary
machines status
machines sync
machines tasks
machines topology
machines unarchive
manual
mcp
mine
move
next
notifications check
onboarding
org
overdue
pin
plans
plans pr-group events
plans pr-group show
policies explain
policies list
policies remove
policies set
policies validate
priorities
project-bootstrap
project-panel
project-rename
projects
projects-path list
projects-path remove
projects-path set
ready
recap
record-verification
redaction add
redaction evidence
redaction scan
redaction status
redistribute
references resolve
release
release-compat check
release-notes
reliability export
reliability list
reliability show
remove
report
report-failure
reports local
retention cleanup
retrospectives create
retrospectives export
retrospectives list
retrospectives show
reviews approve
reviews claim
reviews list
reviews reopen
reviews request
reviews return
reviews rules list
reviews rules remove
reviews rules set
risks add
risks close
risks export
risks list
risks score
risks show
risks update
roadmaps create
roadmaps delete
roadmaps export
roadmaps import
roadmaps list
roadmaps milestones add
roadmaps milestones update
roadmaps releases set
roadmaps show
roadmaps update
runs artifact
runs artifact-verify
runs begin
runs command
runs event
runs file
runs finish
runs list
runs show
runs simulate
runs start
sandbox check
sandbox explain
sandbox list
sandbox remove
sandbox set
scale compact
scale report
sdk-fixtures
search
serve
show
sla
snapshots
sprint
stale
standup
start
status
steal
storage artifacts download
storage artifacts upload
storage shadow-drain
storage shadow-status
storage status
storage sync-plan
stream
summary
sync
tag
task route-state
task upsert
task workflow-pointers
template-export
template-history
template-import
template-init
template-library
template-preview
templates
terminal-notifications list
terminal-notifications remove
terminal-notifications set
terminal-notifications test
time idle
time list
time log
time pause
time report
time resume
time start
time stop
timeline
today
todos-md-import
trace
trust add
trust check
trust list
trust remove
trust status
unassign
unlock
untag
update
upgrade
usage report
verify-providers capabilities
verify-providers list
verify-providers remove
verify-providers run
verify-providers set
views delete
views list
views run
views save
watch
webhooks add
webhooks list
webhooks match
webhooks remove
webhooks status
webhooks test
week
workflow migrate
workflow set
workflow states
workflow tasks
workflows export
workflows list
workflows show
yesterday
`.trim().split("\n");

type SharedCliDefinition = Omit<CliOperation, "topology" | "errors">;

const SHARED_CLI_DEFINITIONS: readonly SharedCliDefinition[] = [
  { path: "active", httpOperationIds: ["listTasks"], mcpTools: ["list_tasks"], requestSchema: "TaskFilter", responseSchema: "TaskListResponse", pagination: "offset" },
  { path: "add", httpOperationIds: ["createTask"], mcpTools: ["create_task"], requestSchema: "CreateTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "agent", httpOperationIds: ["getAgent"], mcpTools: ["get_agent"], requestSchema: "AgentRef", responseSchema: "AgentResponse", pagination: "none" },
  { path: "agents", httpOperationIds: ["listAgents"], mcpTools: ["list_agents"], requestSchema: null, responseSchema: "AgentListResponse", pagination: "none" },
  { path: "approve", httpOperationIds: ["updateTask"], mcpTools: ["approve_task"], requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "assign", httpOperationIds: ["updateTask"], mcpTools: ["reassign_task"], requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "bulk", httpOperationIds: ["updateTask", "deleteTask"], mcpTools: ["bulk_update_tasks", "bulk_delete_tasks"], requestSchema: "BulkTaskInput", responseSchema: "BulkTaskResponse", pagination: "none" },
  { path: "claim", httpOperationIds: ["claimNextTask"], mcpTools: ["claim_next_task"], requestSchema: "ClaimTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "comment", httpOperationIds: ["createTaskComment"], mcpTools: ["add_comment"], requestSchema: "CreateTaskCommentInput", responseSchema: "TaskCommentResponse", pagination: "none" },
  { path: "count", httpOperationIds: ["listTasks"], mcpTools: ["list_tasks"], requestSchema: "TaskFilter", responseSchema: "TaskListResponse", pagination: "offset" },
  { path: "delete", httpOperationIds: ["deleteTask"], mcpTools: ["delete_task"], requestSchema: "TaskRef", responseSchema: "DeleteResponse", pagination: "none" },
  { path: "deps", httpOperationIds: ["listTaskDependencies", "addTaskDependency", "removeTaskDependency"], mcpTools: ["get_task_dependencies", "add_task_dependency", "remove_task_dependency"], requestSchema: "TaskDependencyInput", responseSchema: "TaskDependenciesResponse", pagination: "none" },
  { path: "doctor", httpOperationIds: ["getIntegrity"], mcpTools: ["run_doctor"], requestSchema: null, responseSchema: "IntegrityResponse", pagination: "none" },
  { path: "done", httpOperationIds: ["completeTask"], mcpTools: ["complete_task"], requestSchema: "CompleteTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "fail", httpOperationIds: ["failTask"], mcpTools: ["fail_task"], requestSchema: "FailTaskInput", responseSchema: "FailTaskResponse", pagination: "none" },
  { path: "find-commit", httpOperationIds: ["findTaskByCommit"], mcpTools: ["find_task_by_commit"], requestSchema: "CommitRef", responseSchema: "TaskCommitResponse", pagination: "none" },
  { path: "find-ref", httpOperationIds: ["findTasksByRef"], mcpTools: ["find_tasks_by_git_ref"], requestSchema: "GitRef", responseSchema: "TaskRefsResponse", pagination: "none" },
  { path: "health", httpOperationIds: ["getHealth"], mcpTools: ["get_health"], requestSchema: null, responseSchema: "HealthResponse", pagination: "none" },
  { path: "heartbeat", httpOperationIds: ["heartbeatAgent"], mcpTools: ["heartbeat"], requestSchema: "AgentHeartbeatInput", responseSchema: "AgentResponse", pagination: "none" },
  { path: "history", httpOperationIds: ["getTaskHistory"], mcpTools: ["get_task"], requestSchema: "TaskRef", responseSchema: "TaskHistoryResponse", pagination: "none" },
  { path: "init", httpOperationIds: ["registerAgent"], mcpTools: ["register_agent"], requestSchema: "RegisterAgentInput", responseSchema: "AgentResponse", pagination: "none" },
  { path: "inspect", httpOperationIds: ["getTask"], mcpTools: ["task_context"], requestSchema: "TaskRef", responseSchema: "TaskResponse", pagination: "none" },
  { path: "link-commit", httpOperationIds: ["createTaskCommit"], mcpTools: ["link_task_to_commit"], requestSchema: "CreateTaskCommitInput", responseSchema: "TaskCommitResponse", pagination: "none" },
  { path: "link-ref", httpOperationIds: ["createTaskRef"], mcpTools: ["link_task_git_ref"], requestSchema: "CreateTaskRefInput", responseSchema: "TaskRefResponse", pagination: "none" },
  { path: "list", httpOperationIds: ["listTasks"], mcpTools: ["list_tasks"], requestSchema: "TaskFilter", responseSchema: "TaskListResponse", pagination: "offset" },
  { path: "lists", httpOperationIds: ["listTaskLists", "createTaskList", "updateTaskList", "deleteTaskList"], mcpTools: ["list_task_lists", "create_task_list", "update_task_list", "delete_task_list"], requestSchema: "TaskListInput", responseSchema: "TaskListResponse", pagination: "none" },
  { path: "lock", httpOperationIds: ["lockTask"], mcpTools: ["lock_task"], requestSchema: "TaskLockInput", responseSchema: "TaskLockResponse", pagination: "none" },
  { path: "move", httpOperationIds: ["updateTask"], mcpTools: ["move_task"], requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "next", httpOperationIds: ["getNextTask"], mcpTools: ["get_next_task"], requestSchema: "TaskFilter", responseSchema: "TaskResponse", pagination: "none" },
  { path: "plans", httpOperationIds: ["listPlans", "createPlan", "getPlan", "updatePlan", "deletePlan"], mcpTools: ["list_plans", "create_plan", "get_plan", "update_plan", "delete_plan"], requestSchema: "PlanInput", responseSchema: "PlanResponse", pagination: "none" },
  { path: "plans pr-group events", httpOperationIds: ["getPrGroupEvents"], mcpTools: ["get_pr_group_events"], requestSchema: "PrGroupEventQuery", responseSchema: "PrGroupEventHistoryResponse", pagination: "cursor" },
  { path: "plans pr-group show", httpOperationIds: ["getPrGroupState"], mcpTools: ["get_pr_group_state"], requestSchema: "PrGroupRef", responseSchema: "PrGroupStateResponse", pagination: "none" },
  { path: "project-rename", httpOperationIds: ["renameProject"], mcpTools: ["rename_project"], requestSchema: "RenameProjectInput", responseSchema: "ProjectResponse", pagination: "none" },
  { path: "projects", httpOperationIds: ["listProjects", "createProject", "getProject", "updateProject", "deleteProject"], mcpTools: ["list_projects", "create_project", "get_project", "update_project", "delete_project"], requestSchema: "ProjectInput", responseSchema: "ProjectResponse", pagination: "none" },
  { path: "recap", httpOperationIds: ["listTasks", "listAgents", "listAllDependencies"], mcpTools: ["standup"], requestSchema: "RecapQuery", responseSchema: "RecapResponse", pagination: "none" },
  { path: "record-verification", httpOperationIds: ["createTaskVerification"], mcpTools: ["add_task_verification"], requestSchema: "CreateTaskVerificationInput", responseSchema: "TaskVerificationResponse", pagination: "none" },
  { path: "release", httpOperationIds: ["releaseAgent"], mcpTools: ["release_agent"], requestSchema: "ReleaseAgentInput", responseSchema: "AgentReleaseResponse", pagination: "none" },
  { path: "remove", httpOperationIds: ["deleteTask"], mcpTools: ["delete_task"], requestSchema: "TaskRef", responseSchema: "DeleteResponse", pagination: "none" },
  { path: "show", httpOperationIds: ["getTask"], mcpTools: ["get_task"], requestSchema: "TaskRef", responseSchema: "TaskResponse", pagination: "none" },
  { path: "standup", httpOperationIds: ["listTasks", "listAgents", "listAllDependencies"], mcpTools: ["standup"], requestSchema: "RecapQuery", responseSchema: "RecapResponse", pagination: "none" },
  { path: "start", httpOperationIds: ["startTask"], mcpTools: ["start_task"], requestSchema: "StartTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "status", httpOperationIds: ["getStats", "listTasks"], mcpTools: ["get_status"], requestSchema: "StatusQuery", responseSchema: "StatusResponse", pagination: "none" },
  { path: "tag", httpOperationIds: ["updateTask"], mcpTools: ["update_task"], requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "task upsert", httpOperationIds: ["upsertTask"], mcpTools: ["upsert_task"], requestSchema: "UpsertTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "template-export", httpOperationIds: ["getTemplate"], mcpTools: ["export_template"], requestSchema: "TemplateRef", responseSchema: "TemplateResponse", pagination: "none" },
  { path: "template-import", httpOperationIds: ["createTemplate", "updateTemplate"], mcpTools: ["import_template"], requestSchema: "CreateTemplateInput", responseSchema: "TemplateResponse", pagination: "none" },
  { path: "template-preview", httpOperationIds: ["getTemplate"], mcpTools: ["get_template"], requestSchema: "TemplateRef", responseSchema: "TemplateResponse", pagination: "none" },
  { path: "templates", httpOperationIds: ["listTemplates", "createTemplate", "getTemplate", "updateTemplate", "deleteTemplate"], mcpTools: ["list_templates", "create_template", "get_template", "update_template", "delete_template"], requestSchema: "TemplateInput", responseSchema: "TemplateResponse", pagination: "none" },
  { path: "timeline", httpOperationIds: ["listActivity"], mcpTools: ["get_activity_timeline"], requestSchema: "ActivityQuery", responseSchema: "ActivityResponse", pagination: "offset" },
  { path: "unlock", httpOperationIds: ["unlockTask"], mcpTools: ["unlock_task"], requestSchema: "TaskUnlockInput", responseSchema: "TaskLockResponse", pagination: "none" },
  { path: "untag", httpOperationIds: ["updateTask"], mcpTools: ["update_task"], requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse", pagination: "none" },
  { path: "update", httpOperationIds: ["updateTask"], mcpTools: ["update_task"], requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse", pagination: "none" },
] as const;

const HTTP_READ_ERRORS = [400, 401, 403, 404, 409, 429, 500, 503] as const;
const HTTP_WRITE_ERRORS = [400, 401, 403, 404, 409, 429, 500, 503] as const;

function http(
  operationId: string,
  method: PublicHttpMethod,
  path: string,
  summary: string,
  options: Partial<Pick<PublicHttpOperation, "auth" | "pagination" | "requestSchema" | "responseSchema" | "errors">> = {},
): PublicHttpOperation {
  const write = method !== "GET";
  return {
    operationId,
    method,
    path,
    summary,
    auth: options.auth ?? (write ? "api-key:write" : "api-key:read"),
    pagination: options.pagination ?? "none",
    requestSchema: options.requestSchema ?? null,
    responseSchema: options.responseSchema ?? "ObjectResponse",
    errors: options.errors ?? (write ? HTTP_WRITE_ERRORS : HTTP_READ_ERRORS),
  };
}

export const PUBLIC_HTTP_OPERATIONS: readonly PublicHttpOperation[] = [
  http("getHealth", "GET", "/health", "Service health", { auth: "none", responseSchema: "HealthResponse", errors: [] }),
  http("getReady", "GET", "/ready", "Service readiness", { auth: "none", responseSchema: "HealthResponse", errors: [503] }),
  http("getVersion", "GET", "/version", "Service version", { auth: "none", responseSchema: "VersionResponse", errors: [] }),
  http("getOpenApi", "GET", "/openapi.json", "OpenAPI document", { auth: "none", responseSchema: "OpenApiDocument", errors: [] }),
  http("getV1OpenApi", "GET", "/v1/openapi.json", "OpenAPI document", { auth: "none", responseSchema: "OpenApiDocument", errors: [] }),

  http("checkTasksExist", "POST", "/v1/tasks/exists", "Check task IDs in bulk", { requestSchema: "TaskExistsInput", responseSchema: "TaskExistsResponse" }),
  http("upsertTask", "POST", "/v1/tasks/upsert", "Upsert a task by fingerprint", { requestSchema: "UpsertTaskInput", responseSchema: "TaskResponse" }),
  http("listTasks", "GET", "/v1/tasks", "List tasks", { pagination: "offset", responseSchema: "TaskListResponse" }),
  http("createTask", "POST", "/v1/tasks", "Create a task", { requestSchema: "CreateTaskInput", responseSchema: "TaskResponse" }),
  http("getTask", "GET", "/v1/tasks/{id}", "Get a task", { responseSchema: "TaskResponse" }),
  http("updateTask", "PATCH", "/v1/tasks/{id}", "Update a task", { requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse" }),
  http("replaceTask", "PUT", "/v1/tasks/{id}", "Update a task", { requestSchema: "UpdateTaskInput", responseSchema: "TaskResponse" }),
  http("deleteTask", "DELETE", "/v1/tasks/{id}", "Delete a task", { responseSchema: "DeleteResponse" }),
  http("listTaskComments", "GET", "/v1/tasks/{id}/comments", "List task comments", { pagination: "cursor", responseSchema: "TaskCommentListResponse", errors: [...HTTP_READ_ERRORS, 426] }),
  http("createTaskComment", "POST", "/v1/tasks/{id}/comments", "Create a task comment", { requestSchema: "CreateTaskCommentInput", responseSchema: "TaskCommentResponse" }),
  http("getTaskHistory", "GET", "/v1/tasks/{id}/history", "Get task history", { responseSchema: "TaskHistoryResponse" }),
  http("lockTask", "POST", "/v1/tasks/{id}/lock", "Lock a task", { requestSchema: "TaskLockInput", responseSchema: "TaskLockResponse" }),
  http("unlockTask", "POST", "/v1/tasks/{id}/unlock", "Unlock a task", { requestSchema: "TaskUnlockInput", responseSchema: "TaskLockResponse" }),
  http("listTaskDependencies", "GET", "/v1/tasks/{id}/dependencies", "List task dependencies", { responseSchema: "TaskDependenciesResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("addTaskDependency", "POST", "/v1/tasks/{id}/dependencies", "Add a task dependency", { requestSchema: "TaskDependencyInput", responseSchema: "TaskDependencyResponse", errors: [...HTTP_WRITE_ERRORS, 501] }),
  http("removeTaskDependency", "DELETE", "/v1/tasks/{id}/dependencies/{dependencyId}", "Remove a task dependency", { responseSchema: "DeleteResponse", errors: [...HTTP_WRITE_ERRORS, 501] }),
  http("listTaskVerifications", "GET", "/v1/tasks/{id}/verifications", "List task verifications", { responseSchema: "TaskVerificationListResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("createTaskVerification", "POST", "/v1/tasks/{id}/verifications", "Create a task verification", { requestSchema: "CreateTaskVerificationInput", responseSchema: "TaskVerificationResponse", errors: [...HTTP_WRITE_ERRORS, 501] }),
  http("listTaskCommits", "GET", "/v1/tasks/{id}/commits", "List task commits", { responseSchema: "TaskCommitListResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("createTaskCommit", "POST", "/v1/tasks/{id}/commits", "Create a task commit link", { requestSchema: "CreateTaskCommitInput", responseSchema: "TaskCommitResponse", errors: [...HTTP_WRITE_ERRORS, 501] }),
  http("listTaskRefs", "GET", "/v1/tasks/{id}/refs", "List task git refs", { responseSchema: "TaskRefListResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("createTaskRef", "POST", "/v1/tasks/{id}/refs", "Create a task git ref", { requestSchema: "CreateTaskRefInput", responseSchema: "TaskRefResponse", errors: [...HTTP_WRITE_ERRORS, 501] }),
  http("startTask", "POST", "/v1/tasks/{id}/start", "Start a task", { requestSchema: "StartTaskInput", responseSchema: "TaskResponse" }),
  http("completeTask", "POST", "/v1/tasks/{id}/complete", "Complete a task", { requestSchema: "CompleteTaskInput", responseSchema: "TaskResponse" }),
  http("failTask", "POST", "/v1/tasks/{id}/fail", "Fail a task", { requestSchema: "FailTaskInput", responseSchema: "FailTaskResponse" }),
  http("claimNextTask", "POST", "/v1/tasks/next/claim", "Claim the next task", { requestSchema: "ClaimTaskInput", responseSchema: "TaskResponse" }),

  http("listProjects", "GET", "/v1/projects", "List projects", { responseSchema: "ProjectListResponse" }),
  http("createProject", "POST", "/v1/projects", "Create a project", { requestSchema: "CreateProjectInput", responseSchema: "ProjectResponse" }),
  http("getProject", "GET", "/v1/projects/{id}", "Get a project", { responseSchema: "ProjectResponse" }),
  http("updateProject", "PATCH", "/v1/projects/{id}", "Update a project", { requestSchema: "UpdateProjectInput", responseSchema: "ProjectResponse" }),
  http("replaceProject", "PUT", "/v1/projects/{id}", "Update a project", { requestSchema: "UpdateProjectInput", responseSchema: "ProjectResponse" }),
  http("deleteProject", "DELETE", "/v1/projects/{id}", "Delete a project", { responseSchema: "DeleteResponse" }),
  http("renameProject", "POST", "/v1/projects/{id}/rename", "Rename a project atomically", { requestSchema: "RenameProjectInput", responseSchema: "ProjectResponse" }),

  http("listPlans", "GET", "/v1/plans", "List plans", { responseSchema: "PlanListResponse" }),
  http("createPlan", "POST", "/v1/plans", "Create a plan", { requestSchema: "CreatePlanInput", responseSchema: "PlanResponse" }),
  http("getPlan", "GET", "/v1/plans/{id}", "Get a plan", { responseSchema: "PlanResponse" }),
  http("updatePlan", "PATCH", "/v1/plans/{id}", "Update a plan", { requestSchema: "UpdatePlanInput", responseSchema: "PlanResponse" }),
  http("replacePlan", "PUT", "/v1/plans/{id}", "Update a plan", { requestSchema: "UpdatePlanInput", responseSchema: "PlanResponse" }),
  http("deletePlan", "DELETE", "/v1/plans/{id}", "Delete a plan", { responseSchema: "DeleteResponse" }),

  http("listTemplates", "GET", "/v1/templates", "List templates", { responseSchema: "TemplateListResponse" }),
  http("createTemplate", "POST", "/v1/templates", "Create a template", { requestSchema: "CreateTemplateInput", responseSchema: "TemplateResponse" }),
  http("getTemplate", "GET", "/v1/templates/{id}", "Get a template", { responseSchema: "TemplateResponse" }),
  http("updateTemplate", "PATCH", "/v1/templates/{id}", "Update a template", { requestSchema: "UpdateTemplateInput", responseSchema: "TemplateResponse" }),
  http("replaceTemplate", "PUT", "/v1/templates/{id}", "Update a template", { requestSchema: "UpdateTemplateInput", responseSchema: "TemplateResponse" }),
  http("deleteTemplate", "DELETE", "/v1/templates/{id}", "Delete a template", { responseSchema: "DeleteResponse" }),

  http("listAgents", "GET", "/v1/agents", "List agents", { responseSchema: "AgentListResponse" }),
  http("registerAgent", "POST", "/v1/agents", "Register an agent", { requestSchema: "RegisterAgentInput", responseSchema: "AgentResponse" }),
  http("getAgent", "GET", "/v1/agents/{id}", "Get an agent", { responseSchema: "AgentResponse" }),
  http("heartbeatAgent", "POST", "/v1/agents/{id}/heartbeat", "Heartbeat an agent", { requestSchema: "AgentHeartbeatInput", responseSchema: "AgentResponse" }),
  http("releaseAgent", "POST", "/v1/agents/{id}/release", "Release an agent", { requestSchema: "ReleaseAgentInput", responseSchema: "AgentReleaseResponse" }),
  http("listActivity", "GET", "/v1/activity", "List recent activity", { pagination: "offset", responseSchema: "ActivityResponse" }),

  http("listTaskLists", "GET", "/v1/task-lists", "List task lists", { responseSchema: "TaskListListResponse" }),
  http("createTaskList", "POST", "/v1/task-lists", "Create a task list", { requestSchema: "CreateTaskListInput", responseSchema: "TaskListResponse" }),
  http("getTaskList", "GET", "/v1/task-lists/{id}", "Get a task list", { responseSchema: "TaskListResponse" }),
  http("updateTaskList", "PATCH", "/v1/task-lists/{id}", "Update a task list", { requestSchema: "UpdateTaskListInput", responseSchema: "TaskListResponse" }),
  http("replaceTaskList", "PUT", "/v1/task-lists/{id}", "Update a task list", { requestSchema: "UpdateTaskListInput", responseSchema: "TaskListResponse" }),
  http("deleteTaskList", "DELETE", "/v1/task-lists/{id}", "Delete a task list", { responseSchema: "DeleteResponse" }),

  http("listAllDependencies", "GET", "/v1/dependencies", "List all dependency edges", { responseSchema: "TaskDependencyListResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("findTaskByCommit", "GET", "/v1/commits/{sha}", "Find a task by commit", { responseSchema: "TaskCommitResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("findTasksByRef", "GET", "/v1/refs/{ref}", "Find tasks by git ref", { responseSchema: "TaskRefListResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("getNextTask", "GET", "/v1/next", "Get the next task", { responseSchema: "TaskResponse" }),
  http("getStats", "GET", "/v1/stats", "Get aggregate statistics", { responseSchema: "StatsResponse" }),
  http("getIntegrity", "GET", "/v1/integrity", "Get integrity diagnostics", { responseSchema: "IntegrityResponse", errors: [...HTTP_READ_ERRORS, 501] }),
  http("importSnapshot", "POST", "/v1/import", "Import a storage snapshot", { requestSchema: "StorageSnapshot", responseSchema: "ImportResponse", errors: [...HTTP_WRITE_ERRORS, 501] }),

  http("admitPrGroup", "POST", "/v1/pr-groups/admit", "Admit a PR group", { requestSchema: "AdmitPrGroupInput", responseSchema: "PrGroupMutationResult" }),
  http("getPrGroupState", "GET", "/v1/pr-groups/{id}", "Get PR-group state", { responseSchema: "PrGroupStateResponse" }),
  http("getPrGroupEvents", "GET", "/v1/pr-groups/{id}/events", "Get PR-group events", { pagination: "cursor", responseSchema: "PrGroupEventHistoryResponse" }),
  http("appendPrGroupEvent", "POST", "/v1/pr-groups/{id}/events", "Append a PR-group event", { requestSchema: "AppendPrGroupEventInput", responseSchema: "PrGroupMutationResult" }),
  http("recoverPrGroup", "POST", "/v1/pr-groups/{id}/recover", "Recover a PR group", { requestSchema: "RecoverPrGroupInput", responseSchema: "PrGroupMutationResult" }),
] as const;

const SHARED_BY_PATH = new Map(SHARED_CLI_DEFINITIONS.map((entry) => [entry.path, entry] as const));

export const CLI_OPERATIONS: readonly CliOperation[] = CLI_INVOCATIONS.map((path) => {
  const shared = SHARED_BY_PATH.get(path);
  if (shared) {
    return {
      ...shared,
      topology: "shared-customer-domain" as const,
      errors: ["INVALID_INPUT", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "REMOTE_API_UNAVAILABLE"],
    };
  }
  return {
    path,
    topology: "local-topology-only" as const,
    httpOperationIds: [],
    mcpTools: [],
    requestSchema: null,
    responseSchema: "LocalOperationResponse",
    errors: ["INVALID_INPUT", "NOT_FOUND", "LOCAL_OPERATION_FAILED"],
    pagination: "none" as const,
  };
});

export const TODOS_OPERATION_MANIFEST: TodosOperationManifest = {
  schemaVersion: TODOS_OPERATION_MANIFEST_SCHEMA,
  aliases: [],
  cli: CLI_OPERATIONS,
  http: PUBLIC_HTTP_OPERATIONS,
};

export function getCliOperation(path: string): CliOperation | undefined {
  return CLI_OPERATIONS.find((operation) => operation.path === path);
}

export function listCliCommandPaths(): string[] {
  return CLI_OPERATIONS.map((operation) => operation.path);
}

export function listCliTopLevelCommands(): string[] {
  return [...new Set(CLI_OPERATIONS.map((operation) => operation.path.split(" ")[0]!))].sort();
}

export function listCliNestedSubcommands(): Record<string, string[]> {
  const nested: Record<string, Set<string>> = {};
  for (const operation of CLI_OPERATIONS) {
    const segments = operation.path.split(" ");
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join(" ");
      (nested[parent] ??= new Set()).add(segments[index]!);
    }
  }
  return Object.fromEntries(
    Object.entries(nested).map(([parent, children]) => [parent, [...children].sort()]),
  );
}

function routePattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\\\{[^/]+\\\}/g, "[^/]+")}$`);
}

export function findPublicHttpOperation(method: string, path: string): PublicHttpOperation | undefined {
  const upper = method.toUpperCase();
  return PUBLIC_HTTP_OPERATIONS.find((operation) =>
    operation.method === upper && routePattern(operation.path).test(path)
  );
}

export function validateOperationManifest(): string[] {
  const issues: string[] = [];
  const cliPaths = new Set<string>();
  const operationIds = new Set<string>();
  const httpKeys = new Set<string>();

  for (const operation of CLI_OPERATIONS) {
    if (cliPaths.has(operation.path)) issues.push(`duplicate CLI operation: ${operation.path}`);
    cliPaths.add(operation.path);
    if (operation.topology === "shared-customer-domain") {
      if (operation.httpOperationIds.length === 0) issues.push(`shared CLI operation has no HTTP route: ${operation.path}`);
      if (operation.mcpTools.length === 0) issues.push(`shared CLI operation has no MCP tool: ${operation.path}`);
      if (!operation.responseSchema) issues.push(`shared CLI operation has no response schema: ${operation.path}`);
    }
  }
  for (const operation of PUBLIC_HTTP_OPERATIONS) {
    const key = `${operation.method} ${operation.path}`;
    if (httpKeys.has(key)) issues.push(`duplicate HTTP operation: ${key}`);
    if (operationIds.has(operation.operationId)) issues.push(`duplicate HTTP operationId: ${operation.operationId}`);
    httpKeys.add(key);
    operationIds.add(operation.operationId);
    if (!operation.responseSchema) issues.push(`HTTP operation has no response schema: ${key}`);
    if (!operation.auth) issues.push(`HTTP operation has no auth contract: ${key}`);
    if (!operation.pagination) issues.push(`HTTP operation has no pagination contract: ${key}`);
  }
  for (const operation of CLI_OPERATIONS) {
    for (const operationId of operation.httpOperationIds) {
      if (!operationIds.has(operationId)) issues.push(`CLI operation ${operation.path} references unknown HTTP operationId ${operationId}`);
    }
  }
  return issues;
}
