import type {
  FinderResult,
  FleetHealthReport,
  FleetInstallReport,
  HasnaMcpCatalogEntry,
  MachineEntry,
  McpServerEntry,
  McpSource,
  ProviderProfile,
  RegistryServer,
} from "../types.js";

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_TEXT_LIMIT = 120;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  nextCursor: string | null;
  truncated: boolean;
}

export function truncateText(value: unknown, maxLength = DEFAULT_TEXT_LIMIT): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

export function parseLimit(value: unknown, defaultLimit = DEFAULT_LIST_LIMIT, maxLimit = MAX_LIST_LIMIT): number {
  if (value === undefined || value === null || value === "") return defaultLimit;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 1) return defaultLimit;
  return Math.min(Math.floor(parsed), maxLimit);
}

export function parseCursor(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function paginate<T>(
  items: T[],
  options: { limit?: unknown; cursor?: unknown; defaultLimit?: number; maxLimit?: number } = {},
): Page<T> {
  const limit = parseLimit(options.limit, options.defaultLimit ?? DEFAULT_LIST_LIMIT, options.maxLimit ?? MAX_LIST_LIMIT);
  const offset = Math.min(parseCursor(options.cursor), items.length);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    total: items.length,
    limit,
    offset,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    truncated: nextOffset < items.length,
  };
}

export function pageSummary<T>(page: Page<T>, noun: string): string {
  const rangeStart = page.total === 0 ? 0 : page.offset + 1;
  const rangeEnd = page.offset + page.items.length;
  return `Showing ${rangeStart}-${rangeEnd} of ${page.total} ${noun}.`;
}

export function compactServer(server: McpServerEntry, toolCount?: number) {
  return {
    id: server.id,
    name: truncateText(server.name, 80),
    enabled: server.enabled,
    transport: server.transport,
    source: server.source,
    toolCount: toolCount ?? 0,
    hasDescription: Boolean(server.description),
    hasLastError: Boolean(server.last_error),
  };
}

export function compactRegistryServer(server: RegistryServer) {
  const pkg = server.packages?.[0];
  return {
    id: server.id,
    name: truncateText(server.name, 80),
    description: truncateText(server.description),
    package: pkg ? `${pkg.registryType}:${pkg.identifier}` : null,
  };
}

export function compactFinderResult(result: FinderResult) {
  return {
    name: truncateText(result.name, 90),
    source: result.source,
    sourceId: result.sourceId ?? null,
    description: truncateText(result.description),
    installCmd: result.installCmd ?? null,
    url: result.url ?? null,
    stars: result.stars ?? null,
  };
}

export function compactTool(tool: {
  server_id?: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}) {
  const schema = tool.input_schema;
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const required = Array.isArray(schema.required) ? schema.required.length : 0;
  return {
    server_id: tool.server_id ?? null,
    name: tool.name,
    description: truncateText(tool.description),
    inputSchema: {
      propertyCount: properties.length,
      requiredCount: required,
      propertyPreview: properties.slice(0, 8),
    },
  };
}

export function compactProviderProfile(profile: ProviderProfile) {
  return {
    id: profile.id,
    displayName: truncateText(profile.displayName, 80),
    description: truncateText(profile.description),
    transport: profile.transport,
    authType: profile.authType,
    tokenMode: profile.tokenMode,
    enabled: profile.enabled,
  };
}

export function compactSource(source: McpSource) {
  return {
    id: source.id,
    name: truncateText(source.name, 80),
    type: source.type,
    enabled: source.enabled,
    hasDescription: Boolean(source.description),
  };
}

export function compactMachine(machine: MachineEntry) {
  return {
    id: machine.id,
    name: truncateText(machine.name, 80),
    enabled: machine.enabled,
    platform: machine.platform,
    arch: machine.arch,
    installer: machine.installer,
    hasLastError: Boolean(machine.last_error),
  };
}

export function compactCatalogEntry(entry: HasnaMcpCatalogEntry) {
  return {
    name: entry.name,
    version: entry.version,
    description: truncateText(entry.description),
    mcpBin: entry.mcpBin,
    binCount: Object.keys(entry.bins).length,
  };
}

export function compactFleetHealthReport(report: FleetHealthReport) {
  return {
    machine: {
      id: report.machine.id,
      name: report.machine.name,
    },
    checkedAt: report.checkedAt,
    runtime: `${report.runtime.platform}/${report.runtime.arch}`,
    summary: report.summary,
    error: report.error ? truncateText(report.error) : null,
  };
}

export function compactFleetInstallReport(report: FleetInstallReport) {
  const successes = report.results.filter((result) => result.success).length;
  return {
    machine: {
      id: report.machine.id,
      name: report.machine.name,
    },
    installer: report.installer,
    attempted: report.attempted,
    successes,
    failures: report.results.length - successes,
    error: report.error ? truncateText(report.error) : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
