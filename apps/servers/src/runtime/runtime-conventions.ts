export const SERVER_RUNTIME_MODES = ["local", "production-cloud"] as const;
export type ServerRuntimeMode = (typeof SERVER_RUNTIME_MODES)[number];

export const SERVER_RUNTIME_ENV = {
  mode: "SERVERS_RUNTIME_MODE",
  port: "PORT",
  bindHost: "HOST",
  healthPath: "SERVERS_HEALTH_PATH",
  readinessPath: "SERVERS_READINESS_PATH",
  healthUrl: "SERVERS_HEALTH_URL",
  readinessUrl: "SERVERS_READINESS_URL",
  publicUrl: "SERVERS_PUBLIC_URL",
  probeHost: "SERVERS_PROBE_HOST",
} as const;

export type ServerRuntimeProcessOwner = "hasna-servers" | "external-platform";

export interface ServerRuntimeConventionInput {
  mode?: string | null;
  port?: number | string | null;
  bindHost?: string | null;
  probeHost?: string | null;
  healthPath?: string | null;
  readinessPath?: string | null;
  healthUrl?: string | null;
  readinessUrl?: string | null;
  publicUrl?: string | null;
  env?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ServerRuntimeConvention {
  mode: ServerRuntimeMode;
  processOwner: ServerRuntimeProcessOwner;
  canManageProcess: boolean;
  bindHost: string;
  probeHost: string;
  port: number | null;
  healthPath: string;
  readinessPath: string;
  healthUrl: string | null;
  readinessUrl: string | null;
  publicUrl: string | null;
  env: typeof SERVER_RUNTIME_ENV;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function integerValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function portValue(value: unknown): number | undefined {
  const parsed = integerValue(value);
  return parsed !== undefined && parsed >= 1 && parsed <= 65535 ? parsed : undefined;
}

function normalizePath(value: unknown, fallback: string): string {
  const path = stringValue(value) ?? fallback;
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeMode(value: unknown): ServerRuntimeMode {
  const mode = stringValue(value)?.toLowerCase();
  if (!mode || mode === "dev" || mode === "development") return "local";
  if (mode === "local") return "local";
  if (mode === "production" || mode === "prod" || mode === "production-cloud") return "production-cloud";
  throw new Error(`Unsupported server runtime mode: ${String(value)}`);
}

function endpointUrl(host: string, port: number | null, path: string): string | null {
  if (!port) return null;
  return `http://${host}:${port}${path}`;
}

function metadataValue(
  input: ServerRuntimeConventionInput,
  key: string,
): unknown {
  return input.metadata?.[key];
}

function envValue(
  input: ServerRuntimeConventionInput,
  key: keyof typeof SERVER_RUNTIME_ENV,
): unknown {
  if (input.env) return input.env[SERVER_RUNTIME_ENV[key]];
  return process.env[SERVER_RUNTIME_ENV[key]];
}

export function resolveServerRuntimeConvention(
  input: ServerRuntimeConventionInput = {},
): ServerRuntimeConvention {
  const mode = normalizeMode(
    input.mode
      ?? metadataValue(input, "runtime_mode")
      ?? envValue(input, "mode"),
  );
  const port = portValue(
    input.port
      ?? metadataValue(input, "port")
      ?? metadataValue(input, "tailscale_port")
      ?? envValue(input, "port"),
  ) ?? null;
  const bindHost = stringValue(
    input.bindHost
      ?? metadataValue(input, "bind_host")
      ?? envValue(input, "bindHost"),
  ) ?? (mode === "local" ? "127.0.0.1" : "0.0.0.0");
  const probeHost = stringValue(
    input.probeHost
      ?? metadataValue(input, "probe_host")
      ?? envValue(input, "probeHost"),
  ) ?? "127.0.0.1";
  const healthPath = normalizePath(
    input.healthPath
      ?? metadataValue(input, "health_path")
      ?? envValue(input, "healthPath"),
    "/health",
  );
  const readinessPath = normalizePath(
    input.readinessPath
      ?? metadataValue(input, "readiness_path")
      ?? envValue(input, "readinessPath"),
    "/ready",
  );
  const healthUrl = stringValue(
    input.healthUrl
      ?? metadataValue(input, "health_url")
      ?? envValue(input, "healthUrl"),
  ) ?? endpointUrl(probeHost, port, healthPath);
  const readinessUrl = stringValue(
    input.readinessUrl
      ?? metadataValue(input, "readiness_url")
      ?? envValue(input, "readinessUrl"),
  ) ?? endpointUrl(probeHost, port, readinessPath);
  const publicUrl = stringValue(
    input.publicUrl
      ?? metadataValue(input, "public_url")
      ?? envValue(input, "publicUrl"),
  ) ?? null;

  const canManageProcess = mode === "local";
  return {
    mode,
    processOwner: canManageProcess ? "hasna-servers" : "external-platform",
    canManageProcess,
    bindHost,
    probeHost,
    port,
    healthPath,
    readinessPath,
    healthUrl,
    readinessUrl,
    publicUrl,
    env: SERVER_RUNTIME_ENV,
  };
}

export function runtimeMetadataFromConvention(
  convention: ServerRuntimeConvention,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    runtime_mode: convention.mode,
    process_owner: convention.processOwner,
    bind_host: convention.bindHost,
    probe_host: convention.probeHost,
    health_path: convention.healthPath,
    readiness_path: convention.readinessPath,
  };

  if (convention.port !== null) metadata.port = convention.port;
  if (convention.healthUrl !== null) metadata.health_url = convention.healthUrl;
  if (convention.readinessUrl !== null) metadata.readiness_url = convention.readinessUrl;
  if (convention.publicUrl !== null) metadata.public_url = convention.publicUrl;
  return metadata;
}

export function assertLocalLifecycleManageable(
  convention: ServerRuntimeConvention,
  serverSlug: string,
): void {
  if (convention.canManageProcess) return;
  throw new Error(
    `Server ${serverSlug} uses production-cloud runtime. @hasna/servers records health/readiness metadata for this mode but does not start, stop, restart, deploy, expose, or mutate production infrastructure.`,
  );
}
