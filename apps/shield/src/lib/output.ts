import type { Advisory, Finding, FindingInput, Policy, Project, Rule, Scan } from "../types/index.js";

export const DEFAULT_COMPACT_LIMIT = 20;
export const DEFAULT_ADVISORY_LIMIT = 10;
export const MAX_COMPACT_LIMIT = 200;

export function truncateText(value: unknown, maxLength = 120): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return "";
  return id.length <= length ? id : id.slice(0, length);
}

export function parseLimitOption(
  raw: unknown,
  flagName: string,
  defaultValue: number,
  maxValue = MAX_COMPACT_LIMIT,
): number {
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flagName} '${raw}'. Expected a non-negative integer.`);
  }
  return Math.min(parsed, maxValue);
}

export function compactLocation(item: Pick<Finding | FindingInput, "file" | "line"> & { column?: number | null }): string {
  const column = item.column ? `:${item.column}` : "";
  return `${item.file}:${item.line}${column}`;
}

export function compactFinding(finding: Finding | FindingInput): Record<string, unknown> {
  return {
    id: "id" in finding ? shortId(finding.id) : undefined,
    severity: finding.severity,
    scanner: finding.scanner_type,
    location: compactLocation(finding),
    message: truncateText(finding.message),
  };
}

export function compactScan(scan: Scan): Record<string, unknown> {
  return {
    id: shortId(scan.id),
    status: scan.status,
    findings: scan.findings_count,
    scanners: scan.scanner_types.join(","),
    started_at: scan.started_at,
  };
}

export function compactAdvisory(advisory: Advisory): Record<string, unknown> {
  return {
    id: shortId(advisory.id),
    severity: advisory.severity,
    package: `${advisory.package_name} (${advisory.ecosystem})`,
    affected: truncateText(advisory.affected_versions.join(", "), 48),
    safe: truncateText(advisory.safe_versions.join(", ") || "remove package", 48),
    title: truncateText(advisory.title, 96),
  };
}

export function compactRule(rule: Rule): Record<string, unknown> {
  return {
    id: shortId(rule.id),
    name: rule.name,
    scanner: rule.scanner_type,
    severity: rule.severity,
    enabled: rule.enabled,
    builtin: rule.builtin,
  };
}

export function compactProject(project: Project): Record<string, unknown> {
  return {
    id: shortId(project.id),
    name: project.name,
    path: truncateText(project.path, 96),
    updated_at: project.updated_at,
  };
}

export function compactPolicy(policy: Policy): Record<string, unknown> {
  return {
    id: shortId(policy.id),
    name: policy.name,
    block_on_severity: policy.block_on_severity,
    auto_fix: policy.auto_fix,
    notify: policy.notify,
    enabled: policy.enabled,
  };
}

export function compactListResult<T>(
  items: T[],
  options: {
    limit: number;
    offset?: number;
    map: (item: T) => unknown;
    detailHint: string;
    verboseHint?: string;
  },
): Record<string, unknown> {
  const offset = options.offset ?? 0;
  const visible = items.slice(0, options.limit);
  const hidden = Math.max(0, items.length - visible.length);
  return {
    items: visible.map(options.map),
    count: items.length,
    shown: visible.length,
    offset,
    limit: options.limit,
    truncated: hidden > 0,
    next_offset: hidden > 0 ? offset + visible.length : null,
    hint: hidden > 0
      ? `${hidden} more returned item(s) hidden. ${options.verboseHint ?? "Use --limit, --offset, or --verbose for more."}`
      : options.detailHint,
  };
}
