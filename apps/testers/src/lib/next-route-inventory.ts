import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { upsertScenario } from "../db/scenarios.js";
import { createTestingWorkflow, listTestingWorkflows, updateTestingWorkflow } from "../db/workflows.js";
import type {
  Assertion,
  CreateScenarioInput,
  Scenario,
  ScenarioPriority,
  TestingWorkflow,
  WorkflowExecutionInput,
} from "../types/index.js";

export type NextRouteKind = "page" | "api";

export interface NextRouteInventoryItem {
  kind: NextRouteKind;
  routePath: string;
  file: string;
  category: string;
  groups: string[];
  methods: string[];
  dynamic: boolean;
  requiresAuth: boolean;
  tags: string[];
  priority: ScenarioPriority;
}

export interface NextRouteInventory {
  rootDir: string;
  appDir: string;
  total: number;
  pages: number;
  apiRoutes: number;
  dynamic: number;
  categories: Record<string, number>;
  items: NextRouteInventoryItem[];
}

export interface ImportNextRouteInventoryOptions {
  rootDir: string;
  appDir?: string;
  projectId?: string;
  includePages?: boolean;
  includeApi?: boolean;
  limit?: number;
  createScenarios?: boolean;
  createWorkflows?: boolean;
  workflowTarget?: "local" | "sandbox";
  workflowProvider?: string;
  workflowExecution?: Partial<WorkflowExecutionInput>;
}

export interface ImportNextRouteInventoryResult {
  inventory: NextRouteInventory;
  created: number;
  updated: number;
  deduped: number;
  scenarios: Scenario[];
  workflows: TestingWorkflow[];
}

const ROUTE_FILE_NAMES = new Set([
  "page.tsx",
  "page.ts",
  "page.jsx",
  "page.js",
  "page.mdx",
  "route.ts",
  "route.js",
]);

const WALK_EXCLUDES = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

const SAFE_PAGE_ASSERTIONS: Assertion[] = [{ type: "no_console_errors" }];

export function discoverNextRouteInventory(options: {
  rootDir: string;
  appDir?: string;
  includePages?: boolean;
  includeApi?: boolean;
  limit?: number;
}): NextRouteInventory {
  const rootDir = resolve(options.rootDir);
  const appDir = resolveAppDir(rootDir, options.appDir);
  const includePages = options.includePages !== false;
  const includeApi = options.includeApi !== false;
  const files = walkRouteFiles(appDir);
  const items = files
    .map((file) => routeItemFromFile(rootDir, appDir, file))
    .filter((item): item is NextRouteInventoryItem => Boolean(item))
    .filter((item) => (item.kind === "page" ? includePages : includeApi))
    .sort((a, b) => `${a.kind}:${a.routePath}:${a.file}`.localeCompare(`${b.kind}:${b.routePath}:${b.file}`))
    .slice(0, options.limit);

  const categories: Record<string, number> = {};
  for (const item of items) {
    categories[item.category] = (categories[item.category] ?? 0) + 1;
  }

  return {
    rootDir,
    appDir,
    total: items.length,
    pages: items.filter((item) => item.kind === "page").length,
    apiRoutes: items.filter((item) => item.kind === "api").length,
    dynamic: items.filter((item) => item.dynamic).length,
    categories,
    items,
  };
}

export function scenarioInputForNextRoute(
  item: NextRouteInventoryItem,
  projectId?: string,
): CreateScenarioInput {
  const label = item.kind === "page" ? "page" : "API route";
  const methodList = item.methods.length > 0 ? item.methods.join(", ") : "discovered methods";
  const dynamicStep = item.dynamic
    ? "Substitute dynamic path parameters with valid fixture values from the target org before opening or calling the route."
    : undefined;
  const pageSteps = [
    dynamicStep,
    `Open the Next.js ${label} ${item.routePath}.`,
    "Wait for the route to finish loading and verify it does not show a blank shell, framework error page, or unexpected auth loop.",
    "Exercise visible primary navigation, tabs, filters, dialogs, forms, and safe buttons on this route.",
    "Verify the route stays within the expected org/workspace context and does not emit console errors.",
  ].filter(Boolean) as string[];

  const apiSteps = [
    dynamicStep,
    `Call the ${methodList} handler(s) for ${item.routePath} using safe fixture data.`,
    "Verify expected authentication, authorization, validation, and tenant isolation behavior.",
    "For mutating methods, use harmless test payloads and confirm the response does not create cross-org side effects.",
    "Verify response status, JSON shape, and error messages are stable and regression-safe.",
  ].filter(Boolean) as string[];

  return {
    name: `Next ${label}: ${item.routePath}`,
    description: `Source-discovered ${label} from ${item.file}. Verify route behavior and regressions for ${item.category}.`,
    steps: item.kind === "page" ? pageSteps : apiSteps,
    tags: item.tags,
    priority: item.priority,
    targetPath: item.routePath,
    requiresAuth: item.requiresAuth,
    assertions: item.kind === "page" ? SAFE_PAGE_ASSERTIONS : [],
    metadata: {
      source: "next-route-inventory",
      routeFile: item.file,
      routeKind: item.kind,
      category: item.category,
      methods: item.methods,
      dynamic: item.dynamic,
      groups: item.groups,
    },
    projectId,
  };
}

export function importNextRouteInventory(
  options: ImportNextRouteInventoryOptions,
): ImportNextRouteInventoryResult {
  const inventory = discoverNextRouteInventory(options);
  let created = 0;
  let updated = 0;
  let deduped = 0;
  const scenarios: Scenario[] = [];
  const workflows: TestingWorkflow[] = [];

  if (options.createScenarios) {
    for (const item of inventory.items) {
      const result = upsertScenario(scenarioInputForNextRoute(item, options.projectId));
      scenarios.push(result.scenario);
      if (result.action === "created") created++;
      else if (result.action === "updated") updated++;
      else deduped++;
    }
  }

  if (options.createWorkflows) {
    workflows.push(...upsertRouteInventoryWorkflows(inventory, options));
  }

  return { inventory, created, updated, deduped, scenarios, workflows };
}

function upsertRouteInventoryWorkflows(
  inventory: NextRouteInventory,
  options: ImportNextRouteInventoryOptions,
): TestingWorkflow[] {
  const workflows: TestingWorkflow[] = [];
  const categories = Object.keys(inventory.categories).sort();
  for (const category of categories) {
    const kinds = new Set(inventory.items.filter((item) => item.category === category).map((item) => item.kind));
    for (const kind of kinds) {
      const name = `Next route inventory ${category} ${kind}`;
      const scenarioTags = ["next-route", `area:${category}`, `route:${kind}`];
      const execution: WorkflowExecutionInput = {
        target: options.workflowTarget ?? "sandbox",
        provider: options.workflowProvider,
        sandboxCleanup: "delete",
        sandboxSyncStrategy: "rsync",
        ...options.workflowExecution,
      };
      const existing = listTestingWorkflows({ projectId: options.projectId, enabled: undefined })
        .find((workflow) => workflow.name === name);
      const input = {
        name,
        description: `Source-discovered Next.js ${kind} coverage for ${category} routes.`,
        projectId: options.projectId,
        scenarioFilter: { tags: scenarioTags },
        execution,
      };
      workflows.push(existing ? updateTestingWorkflow(existing.id, input) : createTestingWorkflow(input));
    }
  }
  return workflows;
}

function resolveAppDir(rootDir: string, appDir?: string): string {
  const candidates = appDir
    ? [resolve(rootDir, appDir)]
    : [
        join(rootDir, "packages", "web", "app"),
        join(rootDir, "app"),
        rootDir,
      ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(`Next.js app directory not found under ${rootDir}`);
}

function walkRouteFiles(appDir: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (WALK_EXCLUDES.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (ROUTE_FILE_NAMES.has(entry)) {
        files.push(fullPath);
      }
    }
  }
  walk(appDir);
  return files;
}

function routeItemFromFile(rootDir: string, appDir: string, file: string): NextRouteInventoryItem | null {
  const fileName = basename(file);
  const kind: NextRouteKind = fileName.startsWith("page.") ? "page" : "api";
  const relativeFile = relative(rootDir, file);
  const appRelative = relative(appDir, file).split(/[\\/]/);
  const routeSegments = appRelative.slice(0, -1);
  const groups = routeSegments
    .filter((segment) => segment.startsWith("(") && segment.endsWith(")"))
    .map((segment) => segment.slice(1, -1));
  const pathSegments = routeSegments
    .filter((segment) => !segment.startsWith("("))
    .filter((segment) => !segment.startsWith("@"))
    .map(normalizeRouteSegment)
    .filter(Boolean);
  const routePath = `/${pathSegments.join("/")}`.replace(/\/+/g, "/");
  const normalizedRoutePath = routePath === "/" ? "/" : routePath.replace(/\/$/, "");
  const methods = kind === "api" ? extractRouteMethods(file) : [];
  const category = classifyRoute(normalizedRoutePath, groups, relativeFile);
  const dynamic = routeSegments.some((segment) => segment.includes("["));
  const requiresAuth = inferRequiresAuth(normalizedRoutePath, groups, kind);

  return {
    kind,
    routePath: normalizedRoutePath,
    file: relativeFile,
    category,
    groups,
    methods,
    dynamic,
    requiresAuth,
    tags: tagsForRoute({ kind, routePath: normalizedRoutePath, category, groups, dynamic, requiresAuth }),
    priority: priorityForRoute(normalizedRoutePath, category, kind),
  };
}

function normalizeRouteSegment(segment: string): string {
  if (segment.startsWith("[[...") && segment.endsWith("]]")) {
    return `:${segment.slice(5, -2)}*?`;
  }
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `:${segment.slice(4, -1)}*`;
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return `:${segment.slice(1, -1)}`;
  }
  return segment;
}

function extractRouteMethods(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const methods = new Set<string>();
  const pattern = /\b(?:export\s+)?(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  for (const match of source.matchAll(pattern)) {
    const method = match[1] ?? match[2];
    if (method) methods.add(method);
  }
  return [...methods].sort();
}

function classifyRoute(routePath: string, groups: string[], file: string): string {
  const haystack = `${routePath} ${groups.join(" ")} ${file}`.toLowerCase();
  if (haystack.includes("admin")) return "admin";
  if (haystack.includes("auth") || routePath.startsWith("/cli/device")) return "auth";
  if (haystack.includes("ai-runtime") || /\/(chat|sessions|memories|knowledge|learning|copilot|guardrails)\b/.test(routePath)) return "ai-runtime";
  if (haystack.includes("commerce") || /\/(billing|shop|agent-wallet|domains|whois-profiles)\b/.test(routePath)) return "commerce";
  if (haystack.includes("communications") || /\/(telephony|emails)\b/.test(routePath)) return "communications";
  if (haystack.includes("crm") || routePath.includes("/contacts")) return "crm";
  if (haystack.includes("integrations") || routePath.includes("/connectors")) return "integrations";
  if (haystack.includes("dashboard") || routePath.includes(":orgSlug")) return "dashboard";
  if (haystack.includes("public") || haystack.includes("pages")) return "public";
  if (routePath.startsWith("/api/")) return "api";
  return "app";
}

function inferRequiresAuth(routePath: string, groups: string[], kind: NextRouteKind): boolean {
  const haystack = `${routePath} ${groups.join(" ")}`.toLowerCase();
  if (haystack.includes("auth") || haystack.includes("public") || haystack.includes("webhook")) return false;
  if (routePath.startsWith("/api/v1/auth/")) return false;
  if (routePath.startsWith("/api/")) return true;
  return kind === "page" && (
    haystack.includes("admin") ||
    haystack.includes("dashboard") ||
    routePath.includes(":orgSlug") ||
    routePath.startsWith("/settings")
  );
}

function tagsForRoute(input: {
  kind: NextRouteKind;
  routePath: string;
  category: string;
  groups: string[];
  dynamic: boolean;
  requiresAuth: boolean;
}): string[] {
  const tags = new Set<string>([
    "next-route",
    `route:${input.kind}`,
    `area:${input.category}`,
    input.category,
  ]);
  for (const group of input.groups) tags.add(`group:${group}`);
  if (input.dynamic) tags.add("dynamic-route");
  if (input.requiresAuth) tags.add("auth-required");
  if (input.routePath.startsWith("/api/")) tags.add("api");
  return [...tags];
}

function priorityForRoute(routePath: string, category: string, kind: NextRouteKind): ScenarioPriority {
  if (category === "auth") return "critical";
  if (category === "commerce" || category === "ai-runtime") return "critical";
  if (category === "admin" || category === "dashboard") return "high";
  if (kind === "api") return "high";
  if (routePath === "/" || category === "public") return "medium";
  return "medium";
}
