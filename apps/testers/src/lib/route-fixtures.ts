import type { Scenario } from "../types/index.js";

export interface RouteFixtureResolution {
  originalPath: string | null;
  resolvedPath: string | null;
  params: string[];
  values: Record<string, string>;
  sources: Record<string, "scenario" | "env" | "default">;
  synthetic: string[];
}

export interface MaterializedRouteScenario {
  scenario: Scenario;
  resolution: RouteFixtureResolution;
}

const DEFAULT_UUID = "00000000-0000-4000-8000-000000000000";

const PARAM_ENV_CANDIDATES: Record<string, string[]> = {
  orgSlug: ["TESTERS_ORG_SLUG", "SMOKE_ORG_SLUG", "ORG_SLUG"],
  orgId: ["TESTERS_ORG_ID", "SMOKE_ORG_ID", "ORG_ID"],
  projectSlug: ["TESTERS_PROJECT_SLUG", "SMOKE_PROJECT_SLUG", "PROJECT_SLUG"],
  projectId: ["TESTERS_PROJECT_ID", "SMOKE_PROJECT_ID", "PROJECT_ID"],
  workspaceId: ["TESTERS_WORKSPACE_ID", "SMOKE_WORKSPACE_ID", "WORKSPACE_ID"],
  agentId: ["TESTERS_AGENT_ID", "SMOKE_AGENT_ID", "AGENT_ID"],
  sessionId: ["TESTERS_SESSION_ID", "SMOKE_SESSION_ID", "SESSION_ID"],
  userId: ["TESTERS_USER_ID", "SMOKE_USER_ID", "USER_ID"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envNameForParam(prefix: string, param: string): string {
  return `${prefix}_${param.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveReference(value: string, env: Record<string, string | undefined>): string | undefined {
  if (value.startsWith("$?")) return env[value.slice(2)]?.trim() || undefined;
  if (value.startsWith("$")) return env[value.slice(1)]?.trim() || undefined;
  return value;
}

function scenarioFixtureValue(
  params: Record<string, unknown> | null,
  name: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (!params) return undefined;
  const routeFixtures = isRecord(params["routeFixtures"]) ? params["routeFixtures"] : {};
  const raw = readString(routeFixtures[name]) ?? readString(params[name]);
  return raw ? resolveReference(raw, env) : undefined;
}

function envFixtureValue(name: string, env: Record<string, string | undefined>): string | undefined {
  const candidates = [
    envNameForParam("TESTERS_ROUTE", name),
    envNameForParam("TESTERS_FIXTURE", name),
    envNameForParam("ALUMIA_FIXTURE", name),
    ...(PARAM_ENV_CANDIDATES[name] ?? []),
  ];
  for (const candidate of candidates) {
    const value = env[candidate]?.trim();
    if (value) return value;
  }
  return undefined;
}

function defaultFixtureValue(name: string): string {
  if (name === "orgSlug") return "test-org";
  if (name.toLowerCase().endsWith("slug")) {
    return `test-${name.replace(/Slug$/i, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() || "slug"}`;
  }
  if (name === "id" || name.toLowerCase().endsWith("id")) return DEFAULT_UUID;
  if (name.toLowerCase().includes("token")) return "test-token";
  return `test-${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

export function routeParamsFromPath(path: string | null | undefined): string[] {
  if (!path) return [];
  const params = new Set<string>();
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)(?:\*\??)?/g)) {
    if (match[1]) params.add(match[1]);
  }
  return [...params];
}

export function defaultRouteFixturesForParams(params: string[]): Record<string, string> {
  return Object.fromEntries(params.map((param) => [param, defaultFixtureValue(param)]));
}

export function resolveRouteFixtures(
  scenario: Scenario,
  env: Record<string, string | undefined> = process.env,
): RouteFixtureResolution {
  const metadataParams = Array.isArray(scenario.metadata?.["fixtureParams"])
    ? scenario.metadata["fixtureParams"].filter((value): value is string => typeof value === "string")
    : [];
  const params = [...new Set([...metadataParams, ...routeParamsFromPath(scenario.targetPath)])];
  const values: Record<string, string> = {};
  const sources: RouteFixtureResolution["sources"] = {};
  const synthetic: string[] = [];

  for (const param of params) {
    const scenarioValue = scenarioFixtureValue(scenario.parameters, param, env);
    if (scenarioValue) {
      values[param] = scenarioValue;
      sources[param] = "scenario";
      continue;
    }
    const envValue = envFixtureValue(param, env);
    if (envValue) {
      values[param] = envValue;
      sources[param] = "env";
      continue;
    }
    values[param] = defaultFixtureValue(param);
    sources[param] = "default";
    synthetic.push(param);
  }

  const resolvedPath = scenario.targetPath ? resolveRoutePath(scenario.targetPath, values) : null;
  return {
    originalPath: scenario.targetPath,
    resolvedPath,
    params,
    values,
    sources,
    synthetic,
  };
}

export function resolveRoutePath(path: string, values: Record<string, string>): string {
  return path
    .replace(/\/:([A-Za-z0-9_]+)\*\?/g, (_match, name: string) => {
      const value = values[name];
      return value ? `/${encodeRouteFixture(value, true)}` : "";
    })
    .replace(/:([A-Za-z0-9_]+)\*/g, (_match, name: string) => encodeRouteFixture(values[name] ?? defaultFixtureValue(name), true))
    .replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => encodeRouteFixture(values[name] ?? defaultFixtureValue(name), false));
}

function encodeRouteFixture(value: string, allowSlash: boolean): string {
  if (allowSlash) return value.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return encodeURIComponent(value);
}

export function materializeScenarioRoute(
  scenario: Scenario,
  env: Record<string, string | undefined> = process.env,
): MaterializedRouteScenario {
  const resolution = resolveRouteFixtures(scenario, env);
  if (!resolution.resolvedPath || resolution.resolvedPath === scenario.targetPath) {
    return { scenario, resolution };
  }

  const steps = scenario.steps.map((step) => {
    let next = step;
    for (const [name, value] of Object.entries(resolution.values)) {
      next = next
        .replaceAll(`:${name}`, value)
        .replaceAll(`[${name}]`, value)
        .replaceAll(`{${name}}`, value);
    }
    return next.replaceAll(scenario.targetPath ?? "", resolution.resolvedPath ?? "");
  });

  return {
    scenario: {
      ...scenario,
      targetPath: resolution.resolvedPath,
      steps,
      metadata: {
        ...(scenario.metadata ?? {}),
        routeFixtureResolution: resolution,
      },
    },
    resolution,
  };
}

export function resolveStartUrl(baseUrl: string, targetPath: string): string {
  try {
    return new URL(targetPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${targetPath.replace(/^\/+/, "")}`;
  }
}
