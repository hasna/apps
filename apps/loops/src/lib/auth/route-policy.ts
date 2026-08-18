export type TenantRole = "admin" | "operator" | "member" | "readonly" | "service" | "worker";
export type TokenKind = "api_key" | "service" | "machine";

export interface RoutePolicy {
  operationId: string;
  method: string;
  pathTemplate: string;
  path: RegExp;
  scopes: readonly string[];
  roles: readonly TenantRole[];
  tokenKinds: readonly TokenKind[];
  risk: "read" | "write" | "destructive" | "runner";
}

const READ_ROLES = ["admin", "operator", "member", "readonly", "service"] as const;
const WRITE_ROLES = ["admin", "operator", "member", "service"] as const;
const ADMIN_ROLES = ["admin", "operator", "service"] as const;

function policy(
  operationId: string,
  method: string,
  pathTemplate: string,
  path: RegExp,
  scopes: readonly string[],
  roles: readonly TenantRole[],
  tokenKinds: readonly TokenKind[],
  risk: RoutePolicy["risk"],
): RoutePolicy {
  return { operationId, method, pathTemplate, path, scopes, roles, tokenKinds, risk };
}

export const ROUTE_POLICIES: readonly RoutePolicy[] = Object.freeze([
  policy("status.read", "GET", "/status", /^\/status$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("api.read", "GET", "/v1", /^\/v1$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("api.status", "GET", "/v1/status", /^\/v1\/status$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("tenant.import", "POST", "/v1/import", /^\/v1\/import$/, ["loops:import"], ADMIN_ROLES, ["api_key", "service"], "destructive"),
  policy("loops.list", "GET", "/v1/loops", /^\/v1\/loops$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("loops.create", "POST", "/v1/loops", /^\/v1\/loops$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("loops.count", "GET", "/v1/loops/count", /^\/v1\/loops\/count$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("loops.get", "GET", "/v1/loops/{id}", /^\/v1\/loops\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("loops.update", "PATCH", "/v1/loops/{id}", /^\/v1\/loops\/[^/]+$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("loops.mutate", "POST", "/v1/loops/{id}/mutations", /^\/v1\/loops\/[^/]+\/mutations$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("loopMutations.get", "GET", "/v1/loop-mutations/{operationId}/{stepId}", /^\/v1\/loop-mutations\/[^/]+\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("loops.delete", "DELETE", "/v1/loops/{id}", /^\/v1\/loops\/[^/]+$/, ["loops:delete"], ADMIN_ROLES, ["api_key", "service"], "destructive"),
  policy("loops.archive", "POST", "/v1/loops/{id}/archive", /^\/v1\/loops\/[^/]+\/archive$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("loops.unarchive", "POST", "/v1/loops/{id}/unarchive", /^\/v1\/loops\/[^/]+\/unarchive$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("loops.rename", "POST", "/v1/loops/{id}/rename", /^\/v1\/loops\/[^/]+\/rename$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("loops.runNow", "POST", "/v1/loops/{id}/run-now", /^\/v1\/loops\/[^/]+\/run-now$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("runs.list", "GET", "/v1/runs", /^\/v1\/runs$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("runs.count", "GET", "/v1/runs/count", /^\/v1\/runs\/count$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("runs.get", "GET", "/v1/runs/{id}", /^\/v1\/runs\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("runs.heartbeat", "POST", "/v1/runs/{id}/heartbeat", /^\/v1\/runs\/[^/]+\/heartbeat$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.finalize", "POST", "/v1/runs/{id}/finalize", /^\/v1\/runs\/[^/]+\/finalize$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.evidence", "POST", "/v1/runs/{id}/evidence", /^\/v1\/runs\/[^/]+\/evidence$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.workflowRuns.create", "POST", "/v1/runs/{id}/workflow-runs", /^\/v1\/runs\/[^/]+\/workflow-runs$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.workflowRuns.get", "POST", "/v1/runs/{id}/workflow-runs/{workflowRunId}/get", /^\/v1\/runs\/[^/]+\/workflow-runs\/[^/]+\/get$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.workflowRuns.steps", "POST", "/v1/runs/{id}/workflow-runs/{workflowRunId}/steps", /^\/v1\/runs\/[^/]+\/workflow-runs\/[^/]+\/steps$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.workflowRuns.events", "POST", "/v1/runs/{id}/workflow-runs/{workflowRunId}/events", /^\/v1\/runs\/[^/]+\/workflow-runs\/[^/]+\/events$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.workflowRuns.recover", "POST", "/v1/runs/{id}/workflow-runs/{workflowRunId}/recover", /^\/v1\/runs\/[^/]+\/workflow-runs\/[^/]+\/recover$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.workflowRuns.finalize", "POST", "/v1/runs/{id}/workflow-runs/{workflowRunId}/finalize", /^\/v1\/runs\/[^/]+\/workflow-runs\/[^/]+\/finalize$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.workflowRuns.stepAction", "POST", "/v1/runs/{id}/workflow-runs/{workflowRunId}/steps/{stepId}/{action}", /^\/v1\/runs\/[^/]+\/workflow-runs\/[^/]+\/steps\/[^/]+\/(get|start|pid|progress|skip|finalize)$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.find", "POST", "/v1/runs/{id}/goals/find", /^\/v1\/runs\/[^/]+\/goals\/find$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.create", "POST", "/v1/runs/{id}/goals", /^\/v1\/runs\/[^/]+\/goals$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.get", "POST", "/v1/runs/{id}/goals/{goalId}/get", /^\/v1\/runs\/[^/]+\/goals\/[^/]+\/get$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.status", "POST", "/v1/runs/{id}/goals/{goalId}/status", /^\/v1\/runs\/[^/]+\/goals\/[^/]+\/status$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.events", "POST", "/v1/runs/{id}/goals/{goalId}/events", /^\/v1\/runs\/[^/]+\/goals\/[^/]+\/events$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.planNodes.create", "POST", "/v1/runs/{id}/goals/{goalId}/plan-nodes", /^\/v1\/runs\/[^/]+\/goals\/[^/]+\/plan-nodes$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.planNodes.list", "POST", "/v1/runs/{id}/goals/{goalId}/plan-nodes/list", /^\/v1\/runs\/[^/]+\/goals\/[^/]+\/plan-nodes\/list$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.goals.planNodes.update", "POST", "/v1/runs/{id}/goals/{goalId}/plan-nodes/{key}", /^\/v1\/runs\/[^/]+\/goals\/[^/]+\/plan-nodes\/[^/]+$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runs.recover", "POST", "/v1/runs/{id}/recover", /^\/v1\/runs\/[^/]+\/recover$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("receipts.list", "GET", "/v1/receipts", /^\/v1\/receipts$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("receipts.write", "POST", "/v1/receipts", /^\/v1\/receipts$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("receipts.get", "GET", "/v1/receipts/{runId}", /^\/v1\/receipts\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workflows.list", "GET", "/v1/workflows", /^\/v1\/workflows$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workflows.create", "POST", "/v1/workflows", /^\/v1\/workflows$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("workflows.count", "GET", "/v1/workflows/count", /^\/v1\/workflows\/count$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workflows.get", "GET", "/v1/workflows/{id}", /^\/v1\/workflows\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workflows.archive", "POST", "/v1/workflows/{id}/archive", /^\/v1\/workflows\/[^/]+\/archive$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("workflowRuns.list", "GET", "/v1/workflow-runs", /^\/v1\/workflow-runs$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workflowRuns.get", "GET", "/v1/workflow-runs/{id}", /^\/v1\/workflow-runs\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workflowRuns.recover", "POST", "/v1/workflow-runs/{id}/recover", /^\/v1\/workflow-runs\/[^/]+\/recover$/, ["loops:write"], ADMIN_ROLES, ["api_key", "service"], "write"),
  policy("workflowRuns.steps", "GET", "/v1/workflow-runs/{id}/steps", /^\/v1\/workflow-runs\/[^/]+\/steps$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workflowRuns.events", "GET", "/v1/workflow-runs/{id}/events", /^\/v1\/workflow-runs\/[^/]+\/events$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workItems.list", "GET", "/v1/work-items", /^\/v1\/work-items$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("workItems.upsert", "POST", "/v1/work-items", /^\/v1\/work-items$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("workItems.get", "GET", "/v1/work-items/{id}", /^\/v1\/work-items\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("invocations.list", "GET", "/v1/invocations", /^\/v1\/invocations$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("invocations.create", "POST", "/v1/invocations", /^\/v1\/invocations$/, ["loops:write"], WRITE_ROLES, ["api_key", "service"], "write"),
  policy("invocations.get", "GET", "/v1/invocations/{id}", /^\/v1\/invocations\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("goals.list", "GET", "/v1/goals", /^\/v1\/goals$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("goals.get", "GET", "/v1/goals/{id}", /^\/v1\/goals\/[^/]+$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("goals.planNodes", "GET", "/v1/goals/{id}/plan-nodes", /^\/v1\/goals\/[^/]+\/plan-nodes$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("goalRuns.list", "GET", "/v1/goal-runs", /^\/v1\/goal-runs$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("history.prune", "POST", "/v1/history/prune", /^\/v1\/history\/prune$/, ["loops:delete"], ADMIN_ROLES, ["api_key", "service"], "destructive"),
  policy("runners.poll", "POST", "/v1/runners/poll", /^\/v1\/runners\/poll$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("runners.claim", "POST", "/v1/runners/claim", /^\/v1\/runners\/claim$/, ["loops:runner"], ["worker", "service"], ["machine", "service"], "runner"),
  policy("leases.stuck", "GET", "/v1/leases/stuck", /^\/v1\/leases\/stuck$/, ["loops:read"], READ_ROLES, ["api_key", "service"], "read"),
  policy("leases.reconcile", "POST", "/v1/leases/reconcile", /^\/v1\/leases\/reconcile$/, ["loops:delete"], ["admin", "service"], ["api_key", "service"], "destructive"),
  policy("leases.recover", "POST", "/v1/leases/recover", /^\/v1\/leases\/recover$/, ["loops:delete"], ["admin", "service"], ["api_key", "service"], "destructive"),
]);

export function routePolicy(method: string, path: string): RoutePolicy | undefined {
  return ROUTE_POLICIES.find((policy) => policy.method === method.toUpperCase() && policy.path.test(path));
}
