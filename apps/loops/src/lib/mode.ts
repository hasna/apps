import { packageVersion } from "./version.js";

export const LOOP_DEPLOYMENT_MODES = ["local", "self_hosted", "cloud"] as const;

export type LoopDeploymentMode = (typeof LOOP_DEPLOYMENT_MODES)[number];
export type LoopSourceOfTruth = "local_sqlite" | "self_hosted_control_plane" | "cloud_control_plane";

export interface LoopModeResolution {
  deploymentMode: LoopDeploymentMode;
  source: string;
}

export interface LoopControlPlaneConfig {
  apiUrl?: string;
  cloudApiUrl?: string;
  databaseUrlPresent: boolean;
  apiAuthTokenPresent: boolean;
  cloudAuthTokenPresent: boolean;
  authTokenPresent: boolean;
}

export interface LoopDeploymentStatus {
  packageVersion: string;
  deploymentMode: LoopDeploymentMode;
  activeDeploymentMode: LoopDeploymentMode;
  active: boolean;
  deploymentModeSource: string;
  sourceOfTruth: LoopSourceOfTruth;
  localStore: {
    role: "authoritative" | "cache_and_spool";
  };
  controlPlane: {
    kind: "none" | "self_hosted" | "cloud";
    configured: boolean;
    apiUrl?: string;
    databaseUrlPresent: boolean;
    authTokenPresent: boolean;
  };
  runner: {
    required: boolean;
    role: "daemon" | "control_plane_worker";
  };
  warnings: string[];
}

const MODE_ENV_KEYS = ["LOOPS_MODE", "HASNA_LOOPS_MODE"] as const;
const API_URL_ENV_KEYS = ["LOOPS_API_URL", "HASNA_LOOPS_API_URL"] as const;
const CLOUD_API_URL_ENV_KEYS = ["LOOPS_CLOUD_API_URL", "HASNA_LOOPS_CLOUD_API_URL"] as const;
const DATABASE_URL_ENV_KEYS = ["LOOPS_DATABASE_URL", "HASNA_LOOPS_DATABASE_URL"] as const;
const API_TOKEN_ENV_KEYS = ["LOOPS_API_TOKEN", "HASNA_LOOPS_API_TOKEN"] as const;
const CLOUD_TOKEN_ENV_KEYS = ["LOOPS_CLOUD_TOKEN", "HASNA_LOOPS_CLOUD_TOKEN"] as const;
const TOKEN_ENV_KEYS = [...API_TOKEN_ENV_KEYS, ...CLOUD_TOKEN_ENV_KEYS] as const;

type Env = Record<string, string | undefined>;

function envValue(env: Env, keys: readonly string[]): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return undefined;
}

export function normalizeLoopDeploymentMode(value: string): LoopDeploymentMode {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return "local";
  if (normalized === "self_hosted" || normalized === "selfhosted") return "self_hosted";
  if (normalized === "cloud" || normalized === "saas") return "cloud";
  throw new Error(`unsupported OpenLoops deployment mode "${value}"; expected local, self_hosted, or cloud`);
}

export function resolveLoopDeploymentMode(env: Env = process.env): LoopModeResolution {
  const explicitMode = envValue(env, MODE_ENV_KEYS);
  if (explicitMode) {
    return {
      deploymentMode: normalizeLoopDeploymentMode(explicitMode.value),
      source: explicitMode.key,
    };
  }

  const cloudApiUrl = envValue(env, CLOUD_API_URL_ENV_KEYS);
  if (cloudApiUrl) return { deploymentMode: "cloud", source: cloudApiUrl.key };

  const apiUrl = envValue(env, API_URL_ENV_KEYS);
  if (apiUrl) return { deploymentMode: "self_hosted", source: apiUrl.key };

  const databaseUrl = envValue(env, DATABASE_URL_ENV_KEYS);
  if (databaseUrl) return { deploymentMode: "self_hosted", source: databaseUrl.key };

  return { deploymentMode: "local", source: "default" };
}

export function loopControlPlaneConfig(env: Env = process.env): LoopControlPlaneConfig {
  return {
    apiUrl: envValue(env, API_URL_ENV_KEYS)?.value,
    cloudApiUrl: envValue(env, CLOUD_API_URL_ENV_KEYS)?.value,
    databaseUrlPresent: Boolean(envValue(env, DATABASE_URL_ENV_KEYS)),
    apiAuthTokenPresent: Boolean(envValue(env, API_TOKEN_ENV_KEYS)),
    cloudAuthTokenPresent: Boolean(envValue(env, CLOUD_TOKEN_ENV_KEYS)),
    authTokenPresent: Boolean(envValue(env, TOKEN_ENV_KEYS)),
  };
}

function sourceOfTruthForMode(mode: LoopDeploymentMode): LoopSourceOfTruth {
  if (mode === "local") return "local_sqlite";
  if (mode === "self_hosted") return "self_hosted_control_plane";
  return "cloud_control_plane";
}

function displayControlPlaneUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/g, "");
    return `${url.origin}${path}`;
  } catch {
    return "[invalid-url]";
  }
}

export function buildDeploymentStatus(
  opts: { env?: Env; perspective?: LoopDeploymentMode } = {},
): LoopDeploymentStatus {
  const env = opts.env ?? process.env;
  const active = resolveLoopDeploymentMode(env);
  const deploymentMode = opts.perspective ?? active.deploymentMode;
  const config = loopControlPlaneConfig(env);
  const rawApiUrl = deploymentMode === "cloud" ? config.cloudApiUrl : config.apiUrl;
  const apiUrl = displayControlPlaneUrl(rawApiUrl);
  const controlPlaneKind = deploymentMode === "local" ? "none" : deploymentMode;
  const deploymentAuthTokenPresent =
    deploymentMode === "cloud"
      ? config.cloudAuthTokenPresent
      : deploymentMode === "self_hosted"
        ? config.apiAuthTokenPresent
        : false;
  const controlPlaneConfigured =
    deploymentMode === "local"
      ? false
      : deploymentMode === "self_hosted"
        ? Boolean(config.apiUrl || config.databaseUrlPresent)
        : Boolean(config.cloudApiUrl && deploymentAuthTokenPresent);
  const warnings: string[] = [];

  if (deploymentMode === "self_hosted" && !controlPlaneConfigured) {
    warnings.push("self_hosted mode needs LOOPS_API_URL or LOOPS_DATABASE_URL before it can become authoritative");
  }
  if (deploymentMode === "cloud" && config.apiUrl && !config.cloudApiUrl) {
    warnings.push("LOOPS_API_URL selects self_hosted; cloud mode uses LOOPS_CLOUD_API_URL");
  }
  if (deploymentMode === "cloud" && !config.cloudApiUrl) {
    warnings.push("cloud mode is a public contract until LOOPS_CLOUD_API_URL is configured");
  }
  if (deploymentMode === "cloud" && config.cloudApiUrl && !deploymentAuthTokenPresent) {
    warnings.push("cloud mode needs LOOPS_CLOUD_TOKEN or HASNA_LOOPS_CLOUD_TOKEN before it can become ready");
  }
  if (opts.perspective && opts.perspective !== active.deploymentMode) {
    warnings.push(`active deployment mode is ${active.deploymentMode}; this is the ${opts.perspective} perspective`);
  }

  return {
    packageVersion: packageVersion(),
    deploymentMode,
    activeDeploymentMode: active.deploymentMode,
    active: deploymentMode === active.deploymentMode,
    deploymentModeSource: active.source,
    sourceOfTruth: sourceOfTruthForMode(deploymentMode),
    localStore: {
      role: deploymentMode === "local" ? "authoritative" : "cache_and_spool",
    },
    controlPlane: {
      kind: controlPlaneKind,
      configured: controlPlaneConfigured,
      apiUrl,
      databaseUrlPresent: config.databaseUrlPresent,
      authTokenPresent: deploymentAuthTokenPresent,
    },
    runner: {
      required: deploymentMode !== "local",
      role: deploymentMode === "local" ? "daemon" : "control_plane_worker",
    },
    warnings,
  };
}

export function deploymentStatusLine(status: LoopDeploymentStatus): string {
  const configured = status.controlPlane.kind === "none" ? "none" : String(status.controlPlane.configured);
  const active = status.active ? "active" : `active=${status.activeDeploymentMode}`;
  return [
    `deploymentMode=${status.deploymentMode}`,
    active,
    `source=${status.deploymentModeSource}`,
    `truth=${status.sourceOfTruth}`,
    `local=${status.localStore.role}`,
    `control_plane=${configured}`,
  ].join(" ");
}
