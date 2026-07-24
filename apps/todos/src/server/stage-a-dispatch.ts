export type TodosServerDispatchFamily =
  | "generic-options"
  | "service-probe"
  | "openapi-probe"
  | "v1-dispatch"
  | "mcp-runtime"
  | "local-runtime"
  | "sensitive-not-found"
  | "sensitive-method-not-allowed";

export interface TodosStageARoute {
  readonly method: string;
  readonly path: string;
  readonly family: Exclude<
    TodosServerDispatchFamily,
    "sensitive-not-found" | "sensitive-method-not-allowed"
  >;
  readonly statuses: readonly string[];
}

export const TODOS_STAGE_A_DISPATCH_ORDER = [
  "hosted-containment",
  "finite-route-classification",
  "finite-options",
  "sensitive-route-miss",
  "rate-limit",
  "service-probes",
  "openapi-probes",
  "v1-dispatch",
  "mcp-runtime",
  "local-runtime",
] as const;

const LOCAL_READ_STATUSES = ["200", "400", "401", "404", "429", "500", "503"] as const;
const LOCAL_MUTATION_STATUSES = ["200", "201", "400", "401", "404", "409", "429", "500", "503"] as const;
const MCP_STATUSES = ["200", "400", "401", "404", "405", "429", "500", "503"] as const;
const V1_CONTAINMENT_STATUSES = ["400", "503"] as const;

type Operation = readonly [method: string, path: string];

/** Every mounted local REST operation in serve.ts. */
const LOCAL_API_OPERATIONS: readonly Operation[] = [
  ["GET", "/api/events"],
  ["GET", "/api/tasks/stream"],
  ["GET", "/api/health"],
  ["GET", "/api/headless"],
  ["GET", "/api/stats"],
  ["GET", "/api/tasks"],
  ["POST", "/api/tasks"],
  ["POST", "/api/tasks/upsert"],
  ["GET", "/api/tasks/export"],
  ["POST", "/api/tasks/bulk"],
  ["GET", "/api/tasks/status"],
  ["GET", "/api/tasks/next"],
  ["GET", "/api/tasks/active"],
  ["GET", "/api/tasks/stale"],
  ["GET", "/api/tasks/changed"],
  ["GET", "/api/tasks/context"],
  ["GET", "/api/tasks/{id}/attachments"],
  ["GET", "/api/tasks/{id}/progress"],
  ["POST", "/api/tasks/{id}/progress"],
  ["GET", "/api/tasks/{id}"],
  ["PATCH", "/api/tasks/{id}"],
  ["DELETE", "/api/tasks/{id}"],
  ["POST", "/api/tasks/{id}/start"],
  ["POST", "/api/tasks/{id}/fail"],
  ["POST", "/api/tasks/{id}/complete"],
  ["GET", "/api/tasks/{id}/history"],
  ["POST", "/api/tasks/claim"],
  ["GET", "/api/projects"],
  ["POST", "/api/projects"],
  ["DELETE", "/api/projects/{id}"],
  ["POST", "/api/projects/bulk"],
  ["GET", "/api/agents/me"],
  ["GET", "/api/agents/{id}/queue"],
  ["GET", "/api/agents/{id}/team"],
  ["GET", "/api/agents"],
  ["POST", "/api/agents"],
  ["PATCH", "/api/agents/{id}"],
  ["DELETE", "/api/agents/{id}"],
  ["POST", "/api/agents/bulk"],
  ["GET", "/api/orgs"],
  ["POST", "/api/orgs"],
  ["PATCH", "/api/orgs/{id}"],
  ["DELETE", "/api/orgs/{id}"],
  ["GET", "/api/org"],
  ["GET", "/api/doctor"],
  ["GET", "/api/report"],
  ["GET", "/api/activity"],
  ["GET", "/api/webhooks"],
  ["POST", "/api/webhooks"],
  ["DELETE", "/api/webhooks/{id}"],
  ["GET", "/api/templates"],
  ["POST", "/api/templates"],
  ["DELETE", "/api/templates/{id}"],
  ["GET", "/api/plans"],
  ["POST", "/api/plans"],
  ["POST", "/api/plans/bulk"],
  ["GET", "/api/plans/{id}"],
  ["PATCH", "/api/plans/{id}"],
  ["DELETE", "/api/plans/{id}"],
] as const;

/** Every retained future V1 operation. All are contained before dependencies in Stage A. */
const V1_OPERATIONS: readonly Operation[] = [
  ["GET", "/v1/tasks"],
  ["POST", "/v1/tasks"],
  ["POST", "/v1/tasks/exists"],
  ["POST", "/v1/tasks/upsert"],
  ["GET", "/v1/tasks/{id}"],
  ["PATCH", "/v1/tasks/{id}"],
  ["PUT", "/v1/tasks/{id}"],
  ["DELETE", "/v1/tasks/{id}"],
  ["GET", "/v1/tasks/{id}/comments"],
  ["POST", "/v1/tasks/{id}/comments"],
  ["GET", "/v1/tasks/{id}/history"],
  ["POST", "/v1/tasks/{id}/lock"],
  ["POST", "/v1/tasks/{id}/unlock"],
  ["GET", "/v1/tasks/{id}/dependencies"],
  ["POST", "/v1/tasks/{id}/dependencies"],
  ["DELETE", "/v1/tasks/{id}/dependencies"],
  ["DELETE", "/v1/tasks/{id}/dependencies/{dependencyId}"],
  ["GET", "/v1/tasks/{id}/verifications"],
  ["POST", "/v1/tasks/{id}/verifications"],
  ["GET", "/v1/tasks/{id}/commits"],
  ["POST", "/v1/tasks/{id}/commits"],
  ["GET", "/v1/tasks/{id}/refs"],
  ["POST", "/v1/tasks/{id}/refs"],
  ["POST", "/v1/tasks/{id}/start"],
  ["POST", "/v1/tasks/{id}/complete"],
  ["POST", "/v1/tasks/{id}/fail"],
  ["POST", "/v1/tasks/{id}/claim"],
  ["GET", "/v1/projects"],
  ["POST", "/v1/projects"],
  ["GET", "/v1/projects/{id}"],
  ["PATCH", "/v1/projects/{id}"],
  ["PUT", "/v1/projects/{id}"],
  ["DELETE", "/v1/projects/{id}"],
  ["POST", "/v1/projects/{id}/rename"],
  ["GET", "/v1/plans"],
  ["POST", "/v1/plans"],
  ["GET", "/v1/plans/{id}"],
  ["PATCH", "/v1/plans/{id}"],
  ["PUT", "/v1/plans/{id}"],
  ["DELETE", "/v1/plans/{id}"],
  ["GET", "/v1/agents"],
  ["POST", "/v1/agents"],
  ["GET", "/v1/agents/{id}"],
  ["POST", "/v1/agents/{id}/heartbeat"],
  ["POST", "/v1/agents/{id}/release"],
  ["GET", "/v1/activity"],
  ["GET", "/v1/task-lists"],
  ["POST", "/v1/task-lists"],
  ["GET", "/v1/task-lists/{id}"],
  ["PATCH", "/v1/task-lists/{id}"],
  ["PUT", "/v1/task-lists/{id}"],
  ["DELETE", "/v1/task-lists/{id}"],
  ["GET", "/v1/dependencies"],
  ["GET", "/v1/commits/{sha}"],
  ["GET", "/v1/refs/{ref}"],
  ["GET", "/v1/next"],
  ["GET", "/v1/stats"],
  ["POST", "/v1/import"],
] as const;

const METADATA_ROUTES: readonly TodosStageARoute[] = [
  { method: "GET", path: "/health", family: "service-probe", statuses: ["200", "429"] },
  { method: "GET", path: "/ready", family: "service-probe", statuses: ["200", "429", "503"] },
  { method: "GET", path: "/version", family: "service-probe", statuses: ["200", "429"] },
  { method: "GET", path: "/openapi.json", family: "openapi-probe", statuses: ["200", "429"] },
  { method: "GET", path: "/v1/openapi.json", family: "openapi-probe", statuses: ["200", "429"] },
] as const;

const apiRoutes: TodosStageARoute[] = LOCAL_API_OPERATIONS.map(([method, path]) => ({
  method,
  path,
  family: "local-runtime",
  statuses: method === "GET" ? LOCAL_READ_STATUSES : LOCAL_MUTATION_STATUSES,
}));
const v1Routes: TodosStageARoute[] = V1_OPERATIONS.map(([method, path]) => ({
  method,
  path,
  family: "v1-dispatch",
  statuses: V1_CONTAINMENT_STATUSES,
}));
const mcpRoutes: TodosStageARoute[] = ["GET", "POST", "DELETE"].map((method) => ({
  method,
  path: "/mcp",
  family: "mcp-runtime",
  statuses: method === "POST" ? [...MCP_STATUSES, "202"] : MCP_STATUSES,
}));

const optionPaths = [...new Set([
  ...METADATA_ROUTES.map((route) => route.path),
  ...apiRoutes.map((route) => route.path),
  ...mcpRoutes.map((route) => route.path),
])];
const optionRoutes: TodosStageARoute[] = optionPaths.map((path) => ({
  method: "OPTIONS",
  path,
  family: "generic-options",
  statuses: path.startsWith("/api/") || path === "/mcp"
    ? ["200", "400", "503"]
    : ["200"],
}));

/** The single finite source of truth for dispatch and the served OpenAPI document. */
export const TODOS_STAGE_A_ROUTES: readonly TodosStageARoute[] = [
  ...METADATA_ROUTES,
  ...apiRoutes,
  ...v1Routes,
  ...mcpRoutes,
  ...optionRoutes,
];

/** Backward-compatible metadata subset; unlike the old value it has no wildcard. */
export const TODOS_STAGE_A_METADATA_ROUTES = TODOS_STAGE_A_ROUTES.filter((route) =>
  route.family === "service-probe" || route.family === "openapi-probe" || route.family === "generic-options"
);

function templateMatches(template: string, path: string): boolean {
  const templateSegments = template.split("/");
  const pathSegments = path.split("/");
  if (templateSegments.length !== pathSegments.length) return false;
  return templateSegments.every((segment, index) => (
    /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment)
      ? Boolean(pathSegments[index])
      : segment === pathSegments[index]
  ));
}

export function matchTodosServerRoute(method: string, path: string): TodosStageARoute | null {
  const canonicalMethod = method.toUpperCase();
  const exact = TODOS_STAGE_A_ROUTES.find((route) => route.method === canonicalMethod && route.path === path);
  if (exact) return exact;
  return TODOS_STAGE_A_ROUTES.find((route) => (
    route.method === canonicalMethod && route.path.includes("{") && templateMatches(route.path, path)
  )) ?? null;
}

function hasKnownPath(path: string): boolean {
  return TODOS_STAGE_A_ROUTES.some((route) => route.path === path || (
    route.path.includes("{") && templateMatches(route.path, path)
  ));
}

function isSensitivePath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/")
    || path === "/v1" || path.startsWith("/v1/")
    || path === "/mcp" || path.startsWith("/mcp/");
}

/** Classify only after the hosted containment floor has returned no response. */
export function classifyTodosServerPostContainmentDispatch(
  method: string,
  path: string,
): TodosServerDispatchFamily {
  const matched = matchTodosServerRoute(method, path);
  if (matched) return matched.family;
  if (isSensitivePath(path)) {
    return hasKnownPath(path) ? "sensitive-method-not-allowed" : "sensitive-not-found";
  }
  return "local-runtime";
}
