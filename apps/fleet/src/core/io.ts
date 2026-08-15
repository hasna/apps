import type { FleetSource, HostObservation, PositiveControl, ProbeObservation } from "./types";

export async function loadSourceFile(path: string, name: string): Promise<FleetSource> {
  const parsed = JSON.parse(await Bun.file(path).text()) as unknown;
  return normalizeSourcePayload(parsed, name, path);
}

export async function loadProbeFile(path: string): Promise<ProbeObservation[]> {
  const parsed = JSON.parse(await Bun.file(path).text()) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.probes)
      ? parsed.probes
      : [];
  return rows.map((row) => normalizeProbe(row));
}

export function parsePositiveControl(value: string): PositiveControl {
  const separator = value.indexOf(":");
  if (separator <= 0) {
    throw new Error("positive controls use source:evidence");
  }
  return {
    source: value.slice(0, separator),
    observed: true,
    evidence: value.slice(separator + 1),
  };
}

function normalizeSourcePayload(value: unknown, fallbackName: string, path: string): FleetSource {
  if (Array.isArray(value)) {
    return {
      name: fallbackName,
      observedAt: new Date().toISOString(),
      uri: path,
      hosts: value.map((entry) => normalizeHost(entry, fallbackName)),
    };
  }
  if (!isRecord(value)) {
    throw new Error(`source file ${path} must contain an object or array`);
  }

  const name = typeof value.name === "string" ? value.name : fallbackName;
  const rawHosts = Array.isArray(value.hosts) ? value.hosts : [];
  return {
    name,
    observedAt: typeof value.observedAt === "string" ? value.observedAt : new Date().toISOString(),
    command: typeof value.command === "string" ? value.command : undefined,
    uri: typeof value.uri === "string" ? value.uri : path,
    hosts: rawHosts.map((entry) => normalizeHost(entry, name)),
  };
}

function normalizeHost(value: unknown, source: string): HostObservation {
  if (typeof value === "string") return { id: value, source };
  if (!isRecord(value)) throw new Error("host entries must be strings or objects");
  const id = pickString(value, ["id", "name", "hostname", "instanceId", "node"]);
  if (!id) throw new Error("host entry is missing id/name/hostname/instanceId/node");
  return {
    id,
    source,
    reachable: typeof value.reachable === "boolean" ? value.reachable : undefined,
    evidence: { ...value },
  };
}

function normalizeProbe(value: unknown): ProbeObservation {
  if (!isRecord(value)) throw new Error("probe entries must be objects");
  const host = pickString(value, ["host", "id", "name", "hostname"]);
  if (!host) throw new Error("probe entry is missing host/id/name/hostname");
  return {
    host,
    ok: value.ok === true || value.reachable === true || value.status === "ok",
    observedAt: typeof value.observedAt === "string" ? value.observedAt : undefined,
    source: typeof value.source === "string" ? value.source : undefined,
    evidence: { ...value },
  };
}

function pickString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
