import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { upsertScenario } from "../db/scenarios.js";
import { createTestingWorkflow, listTestingWorkflows, updateTestingWorkflow } from "../db/workflows.js";
import { defaultRouteFixturesForParams } from "./route-fixtures.js";
import type {
  Assertion,
  CreateScenarioInput,
  Scenario,
  ScenarioPriority,
  TestingWorkflow,
  WorkflowExecutionInput,
} from "../types/index.js";

export type NextRouteKind = "page" | "api";
export type NextRouteActionKind = "link" | "button" | "form" | "input" | "api-method";

export interface NextRouteAction {
  kind: NextRouteActionKind;
  label: string;
  target?: string;
  sourceFile: string;
  destructive: boolean;
  requiresFixture: boolean;
}

export interface NextRouteInventoryItem {
  kind: NextRouteKind;
  routePath: string;
  file: string;
  category: string;
  groups: string[];
  methods: string[];
  dynamic: boolean;
  requiresAuth: boolean;
  fixtureParams: string[];
  actions: NextRouteAction[];
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
  actions: number;
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
  createActionScenarios?: boolean;
  createWorkflows?: boolean;
  createActionWorkflows?: boolean;
  actionWorkflowGrouping?: "route" | "area-kind" | "action";
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
  actionScenarios: Scenario[];
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
const IMPORT_SCAN_LIMIT = 40;
const IMPORT_SCAN_DEPTH = 3;

const SOURCE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mdx",
];

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
    actions: items.reduce((sum, item) => sum + item.actions.length, 0),
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
  const fixtureStep = item.fixtureParams.length > 0
    ? `Bind dynamic fixture values for ${item.fixtureParams.map((name) => `:${name}`).join(", ")} before running route actions.`
    : undefined;
  const dynamicStep = item.dynamic
    ? "Substitute dynamic path parameters with valid fixture values from the target org before opening or calling the route."
    : undefined;
  const actionSteps = item.actions.slice(0, 16).map(formatActionStep);
  const pageSteps = [
    fixtureStep,
    dynamicStep,
    `Open the Next.js ${label} ${item.routePath}.`,
    "Wait for the route to finish loading and verify it does not show a blank shell, framework error page, or unexpected auth loop.",
    ...(
      actionSteps.length > 0
        ? actionSteps
        : ["Exercise visible primary navigation, tabs, filters, dialogs, forms, and safe buttons on this route."]
    ),
    "Verify the route stays within the expected org/workspace context and does not emit console errors.",
  ].filter(Boolean) as string[];

  const apiSteps = [
    fixtureStep,
    dynamicStep,
    `Call the ${methodList} handler(s) for ${item.routePath} using safe fixture data.`,
    ...actionSteps,
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
      fixtureParams: item.fixtureParams,
      actions: item.actions,
      actionCount: item.actions.length,
      groups: item.groups,
    },
    parameters: item.fixtureParams.length > 0
      ? {
          routeFixtures: defaultRouteFixturesForParams(item.fixtureParams),
          routeFixtureParams: item.fixtureParams,
        }
      : undefined,
    projectId,
  };
}

export function scenarioInputsForNextRouteActions(
  item: NextRouteInventoryItem,
  projectId?: string,
): CreateScenarioInput[] {
  return item.actions.map((action, index) => scenarioInputForNextRouteAction(item, action, index, projectId));
}

function scenarioInputForNextRouteAction(
  item: NextRouteInventoryItem,
  action: NextRouteAction,
  index: number,
  projectId?: string,
): CreateScenarioInput {
  const label = item.kind === "page" ? "page action" : "API action";
  const fixtureStep = item.fixtureParams.length > 0
    ? `Bind dynamic fixture values for ${item.fixtureParams.map((name) => `:${name}`).join(", ")} before exercising this action.`
    : undefined;
  const dynamicStep = item.dynamic
    ? "Substitute dynamic path parameters with valid fixture values from the target org before opening or calling the route."
    : undefined;
  const destructiveGuard = action.destructive
    ? "If the action reaches a destructive confirmation or mutating final step, verify the warning/cancel path and stop before confirming."
    : undefined;

  const pageSteps = [
    fixtureStep,
    dynamicStep,
    `Open the Next.js page ${item.routePath}.`,
    "Wait for the route to finish loading and verify it does not show a blank shell, framework error page, or unexpected auth loop.",
    `Locate source-discovered ${action.kind} "${action.label}" from ${action.sourceFile}.`,
    formatActionStep(action),
    destructiveGuard,
    action.kind === "input"
      ? "Fill the input with safe test data and verify the UI accepts, validates, or rejects it predictably."
      : "Verify the action produces the expected navigation, modal, toast, table change, validation state, or disabled state.",
    "Verify the route stays within the expected org/workspace context and does not emit console errors.",
  ].filter(Boolean) as string[];

  const apiSteps = [
    fixtureStep,
    dynamicStep,
    `Call ${action.label} ${item.routePath} using safe fixture data.`,
    action.destructive
      ? "Use a harmless dry-run/no-op fixture when available; otherwise verify authentication, authorization, validation, or confirmation blocks without creating destructive side effects."
      : "Verify the method accepts valid safe input and rejects invalid input with a stable response shape.",
    "Verify expected authentication, authorization, validation, and tenant isolation behavior.",
    "Verify response status, JSON shape, and error messages are stable and regression-safe.",
  ].filter(Boolean) as string[];

  return {
    name: `Next ${label}: ${item.routePath} :: ${action.kind} ${action.label} #${index + 1}`,
    description: `Source-discovered ${label} ${index + 1} from ${action.sourceFile}. Verify ${action.kind} "${action.label}" on ${item.routePath}.`,
    steps: item.kind === "page" ? pageSteps : apiSteps,
    tags: actionTagsForRoute(item, action, index),
    priority: action.destructive ? "critical" : item.priority,
    targetPath: item.routePath,
    requiresAuth: item.requiresAuth,
    assertions: item.kind === "page" ? SAFE_PAGE_ASSERTIONS : [],
    metadata: {
      source: "next-route-action-inventory",
      routeFile: item.file,
      routeKind: item.kind,
      routePath: item.routePath,
      category: item.category,
      methods: item.methods,
      dynamic: item.dynamic,
      fixtureParams: item.fixtureParams,
      actionIndex: index,
      action,
      groups: item.groups,
    },
    parameters: item.fixtureParams.length > 0
      ? {
          routeFixtures: defaultRouteFixturesForParams(item.fixtureParams),
          routeFixtureParams: item.fixtureParams,
        }
      : undefined,
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
  const actionScenarios: Scenario[] = [];
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

  if (options.createActionScenarios) {
    for (const item of inventory.items) {
      for (const input of scenarioInputsForNextRouteActions(item, options.projectId)) {
        const result = upsertScenario(input);
        scenarios.push(result.scenario);
        actionScenarios.push(result.scenario);
        if (result.action === "created") created++;
        else if (result.action === "updated") updated++;
        else deduped++;
      }
    }
  }

  if (options.createWorkflows) {
    workflows.push(...upsertRouteInventoryWorkflows(inventory, options));
  }

  if (options.createActionWorkflows) {
    workflows.push(...upsertRouteInventoryActionWorkflows(inventory, options));
  }

  return { inventory, created, updated, deduped, scenarios, actionScenarios, workflows };
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

function upsertRouteInventoryActionWorkflows(
  inventory: NextRouteInventory,
  options: ImportNextRouteInventoryOptions,
): TestingWorkflow[] {
  const workflows: TestingWorkflow[] = [];
  const grouping = options.actionWorkflowGrouping ?? "route";
  const existingWorkflows = listTestingWorkflows({ projectId: options.projectId, enabled: undefined });

  if (grouping === "area-kind") {
    const keys = new Set<string>();
    for (const item of inventory.items) {
      for (const action of item.actions) {
        keys.add(`${item.category}|${action.kind}`);
      }
    }
    for (const key of [...keys].sort()) {
      const [category, actionKind] = key.split("|") as [string, NextRouteActionKind];
      const name = `Next action inventory ${category} ${actionKind}`;
      const scenarioTags = ["next-action", `area:${category}`, `action:${actionKind}`];
      workflows.push(upsertTestingWorkflow(existingWorkflows, name, {
        name,
        description: `Source-discovered ${actionKind} action coverage for ${category} routes.`,
        projectId: options.projectId,
        scenarioFilter: { tags: scenarioTags },
        execution: workflowExecutionFromOptions(options),
      }));
    }
    return workflows;
  }

  if (grouping === "action") {
    for (const item of inventory.items.filter((route) => route.actions.length > 0)) {
      item.actions.forEach((action, index) => {
        const name = `Next action inventory ${item.kind} ${item.routePath} #${index + 1} ${action.kind} ${action.label}`;
        const scenarioTags = [
          "next-action",
          "action-specific",
          `route:${item.kind}`,
          `route-path:${item.routePath}`,
          `action-ordinal:${index + 1}`,
        ];
        workflows.push(upsertTestingWorkflow(existingWorkflows, name, {
          name,
          description: `Source-discovered action #${index + 1} coverage for ${item.kind} route ${item.routePath}: ${action.kind} "${action.label}".`,
          projectId: options.projectId,
          scenarioFilter: { tags: scenarioTags },
          execution: workflowExecutionFromOptions(options),
        }));
      });
    }
    return workflows;
  }

  for (const item of inventory.items.filter((route) => route.actions.length > 0)) {
    const name = `Next action inventory ${item.kind} ${item.routePath}`;
    const scenarioTags = ["next-action", `route:${item.kind}`, `route-path:${item.routePath}`];
    workflows.push(upsertTestingWorkflow(existingWorkflows, name, {
      name,
      description: `Source-discovered action coverage for ${item.kind} route ${item.routePath}.`,
      projectId: options.projectId,
      scenarioFilter: { tags: scenarioTags },
      execution: workflowExecutionFromOptions(options),
    }));
  }

  return workflows;
}

function workflowExecutionFromOptions(options: ImportNextRouteInventoryOptions): WorkflowExecutionInput {
  return {
    target: options.workflowTarget ?? "sandbox",
    provider: options.workflowProvider,
    sandboxCleanup: "delete",
    sandboxSyncStrategy: "rsync",
    ...options.workflowExecution,
  };
}

function upsertTestingWorkflow(
  existingWorkflows: TestingWorkflow[],
  name: string,
  input: Parameters<typeof createTestingWorkflow>[0],
): TestingWorkflow {
  const existing = existingWorkflows.find((workflow) => workflow.name === name);
  return existing ? updateTestingWorkflow(existing.id, input) : createTestingWorkflow(input);
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
  const sources = collectRouteSources(rootDir, file);
  const primarySource = sources[0]?.source ?? readFileSync(file, "utf8");
  const methods = kind === "api" ? extractRouteMethods(primarySource) : [];
  const category = classifyRoute(normalizedRoutePath, groups, relativeFile);
  const dynamic = routeSegments.some((segment) => segment.includes("["));
  const fixtureParams = extractFixtureParams(normalizedRoutePath);
  const actions = kind === "api"
    ? methods.map((method): NextRouteAction => ({
        kind: "api-method",
        label: method,
        target: normalizedRoutePath,
        sourceFile: relativeFile,
        destructive: isDestructiveAction(method, normalizedRoutePath),
        requiresFixture: fixtureParams.length > 0,
      }))
    : extractPageActions(rootDir, sources, fixtureParams);
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
    fixtureParams,
    actions,
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

function extractRouteMethods(source: string): string[] {
  const methods = new Set<string>();
  const pattern = /\b(?:export\s+)?(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  for (const match of source.matchAll(pattern)) {
    const method = match[1] ?? match[2];
    if (method) methods.add(method);
  }
  return [...methods].sort();
}

function collectRouteSources(rootDir: string, entryFile: string): Array<{ file: string; source: string }> {
  const seen = new Set<string>();
  const sources: Array<{ file: string; source: string }> = [];

  function visit(file: string, depth: number): void {
    if (seen.has(file) || sources.length >= IMPORT_SCAN_LIMIT) return;
    if (!existsSync(file) || !statSync(file).isFile()) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    sources.push({ file: relative(rootDir, file), source });
    if (depth >= IMPORT_SCAN_DEPTH) return;

    for (const specifier of localImportSpecifiers(source)) {
      const resolved = resolveImportFile(file, specifier);
      if (resolved) visit(resolved, depth + 1);
    }
  }

  visit(entryFile, 0);
  return sources;
}

function localImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /\bimport\b(?:[\s\S]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']|\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveImportFile(fromFile: string, specifier: string): string | null {
  const base = resolve(join(fromFile, ".."), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function extractPageActions(
  rootDir: string,
  sources: Array<{ file: string; source: string }>,
  fixtureParams: string[],
): NextRouteAction[] {
  const actions: NextRouteAction[] = [];
  for (const source of sources) {
    actions.push(...extractLinkedActions(source, fixtureParams));
    actions.push(...extractButtonActions(source, fixtureParams));
    actions.push(...extractFormActions(source, fixtureParams));
    actions.push(...extractInputActions(source, fixtureParams));
  }

  const deduped = new Map<string, NextRouteAction>();
  for (const action of actions) {
    const key = [
      action.kind,
      normalizeLabel(action.label),
      action.target ?? "",
      action.sourceFile,
    ].join("|");
    if (!deduped.has(key)) deduped.set(key, action);
  }

  return [...deduped.values()]
    .sort((a, b) => `${a.kind}:${a.label}:${a.target ?? ""}`.localeCompare(`${b.kind}:${b.label}:${b.target ?? ""}`))
    .slice(0, 40)
    .map((action) => ({ ...action, sourceFile: relative(rootDir, resolve(rootDir, action.sourceFile)) }));
}

function extractLinkedActions(
  source: { file: string; source: string },
  fixtureParams: string[],
): NextRouteAction[] {
  const actions: NextRouteAction[] = [];
  const pattern = /<(Link|a)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (const match of source.source.matchAll(pattern)) {
    const attrs = match[2] ?? "";
    const body = match[3] ?? "";
    const href = attributeValue(attrs, "href");
    const label = firstNonEmpty(
      attributeValue(attrs, "aria-label"),
      attributeValue(attrs, "title"),
      textFromJsx(body),
      href,
    );
    if (!label) continue;
    actions.push({
      kind: "link",
      label: clamp(label),
      target: href ? clamp(href, 180) : undefined,
      sourceFile: source.file,
      destructive: isDestructiveAction(label, href ?? ""),
      requiresFixture: requiresFixture(href ?? "", fixtureParams),
    });
  }
  return actions;
}

function extractButtonActions(
  source: { file: string; source: string },
  fixtureParams: string[],
): NextRouteAction[] {
  const actions: NextRouteAction[] = [];
  const pattern = /<(button|Button|IconButton|DropdownMenuItem|CommandItem|SelectItem|TabsTrigger)\b([^>]*?)(?:>([\s\S]*?)<\/\1>|\/>)/g;
  for (const match of source.source.matchAll(pattern)) {
    const attrs = match[2] ?? "";
    const body = match[3] ?? "";
    const label = firstNonEmpty(
      attributeValue(attrs, "aria-label"),
      attributeValue(attrs, "title"),
      attributeValue(attrs, "data-testid"),
      textFromJsx(body),
      attributeValue(attrs, "value"),
    );
    if (!label) continue;
    const target = attributeValue(attrs, "href") ?? attributeValue(attrs, "data-testid");
    actions.push({
      kind: "button",
      label: clamp(label),
      target: target ? clamp(target, 180) : undefined,
      sourceFile: source.file,
      destructive: isDestructiveAction(label, attrs),
      requiresFixture: requiresFixture(`${label} ${target ?? ""}`, fixtureParams),
    });
  }
  return actions;
}

function extractFormActions(
  source: { file: string; source: string },
  fixtureParams: string[],
): NextRouteAction[] {
  const actions: NextRouteAction[] = [];
  const pattern = /<form\b([^>]*)>/g;
  for (const match of source.source.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const label = firstNonEmpty(
      attributeValue(attrs, "aria-label"),
      attributeValue(attrs, "name"),
      attributeValue(attrs, "data-testid"),
      attributeValue(attrs, "action"),
      `form in ${source.file}`,
    );
    const target = attributeValue(attrs, "action");
    actions.push({
      kind: "form",
      label: clamp(label),
      target: target ? clamp(target, 180) : undefined,
      sourceFile: source.file,
      destructive: isDestructiveAction(label, attrs),
      requiresFixture: requiresFixture(`${label} ${target ?? ""}`, fixtureParams),
    });
  }
  return actions;
}

function extractInputActions(
  source: { file: string; source: string },
  fixtureParams: string[],
): NextRouteAction[] {
  const actions: NextRouteAction[] = [];
  const pattern = /<(input|Input|Textarea|Select|Combobox)\b([^>]*?)(?:\/>|>)/g;
  for (const match of source.source.matchAll(pattern)) {
    const attrs = match[2] ?? "";
    const label = firstNonEmpty(
      attributeValue(attrs, "aria-label"),
      attributeValue(attrs, "placeholder"),
      attributeValue(attrs, "name"),
      attributeValue(attrs, "data-testid"),
    );
    if (!label) continue;
    actions.push({
      kind: "input",
      label: clamp(label),
      target: attributeValue(attrs, "name") ?? attributeValue(attrs, "data-testid") ?? undefined,
      sourceFile: source.file,
      destructive: false,
      requiresFixture: requiresFixture(label, fixtureParams),
    });
  }
  return actions;
}

function attributeValue(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["']([^"']+)["']\\s*\\})`, "i");
  const match = attrs.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value?.trim() || undefined;
}

function textFromJsx(value: string): string | undefined {
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() ?? "";
}

function clamp(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractFixtureParams(routePath: string): string[] {
  const params = new Set<string>();
  for (const match of routePath.matchAll(/:([A-Za-z0-9_]+)(?:\*\??)?/g)) {
    if (match[1]) params.add(match[1]);
  }
  return [...params];
}

function requiresFixture(value: string, fixtureParams: string[]): boolean {
  if (fixtureParams.length === 0) return false;
  const normalized = value.toLowerCase();
  return fixtureParams.some((param) => normalized.includes(param.toLowerCase()) || normalized.includes(`[${param}]`));
}

function isDestructiveAction(label: string, context = ""): boolean {
  return /\b(delete|destroy|remove|revoke|refund|void|archive|suspend|pause|disable|cancel|reset|purge|terminate)\b/i.test(`${label} ${context}`);
}

function formatActionStep(action: NextRouteAction): string {
  const target = action.target ? ` (${action.target})` : "";
  const fixture = action.requiresFixture ? " after binding fixture values" : "";
  const guard = action.destructive ? " without confirming the destructive final action" : "";
  if (action.kind === "api-method") {
    return `Exercise API method ${action.label}${target}${fixture}${guard}.`;
  }
  return `Exercise ${action.kind} "${action.label}"${target}${fixture}${guard}.`;
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

function actionTagsForRoute(item: NextRouteInventoryItem, action: NextRouteAction, index: number): string[] {
  const tags = new Set<string>([
    ...item.tags,
    "next-action",
    "action-specific",
    `action:${action.kind}`,
    `route-path:${item.routePath}`,
    `action-ordinal:${index + 1}`,
  ]);
  if (action.destructive) tags.add("destructive-action");
  if (action.requiresFixture) tags.add("fixture-required");
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
