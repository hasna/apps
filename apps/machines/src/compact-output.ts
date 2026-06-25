import { renderKeyValueTable, renderList } from "./cli-utils.js";
import type { FleetManifest, MachineDiff, MachineManifest, SetupResult, SyncResult } from "./types.js";
import type { DomainMapping } from "./commands/dns.js";
import type { PortsResult } from "./commands/ports.js";

export const DEFAULT_COMPACT_LIMIT = 10;
export const DEFAULT_HISTORY_LIMIT = 20;
export const DEFAULT_TEXT_PREVIEW = 96;

export interface CompactPageOptions {
  limit?: number | null;
  offset?: number;
  all?: boolean;
}

export interface CompactRenderOptions extends CompactPageOptions {
  verbose?: boolean;
}

function displayName(machine: MachineManifest): string {
  return machine.friendlyName?.trim() || machine.id;
}

export function truncateText(value: unknown, max = DEFAULT_TEXT_PREVIEW): string {
  if (value === null || value === undefined) return "none";
  const text = typeof value === "string" ? value : String(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function metadataSummary(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return "none";
  return Object.keys(value).sort().join(", ");
}

export function pageItems<T>(items: T[], options: CompactPageOptions = {}, defaultLimit = DEFAULT_COMPACT_LIMIT): {
  items: T[];
  total: number;
  offset: number;
  limit: number | null;
  hasMore: boolean;
  nextOffset: number | null;
} {
  const total = items.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.all ? null : options.limit ?? defaultLimit;
  const visible = limit === null ? items.slice(offset) : items.slice(offset, offset + limit);
  const nextOffset = offset + visible.length;
  const hasMore = nextOffset < total;
  return {
    items: visible,
    total,
    offset,
    limit,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
}

export function renderMachineSummary(machine: MachineManifest, options: CompactRenderOptions = {}): string {
  const lines = [
    renderKeyValueTable([
      ["machine", machine.id],
      ["display", displayName(machine)],
      ["platform", machine.platform],
      ["connection", machine.connection ?? "unspecified"],
      ["workspace", machine.workspacePath ? "set" : "missing"],
      ["packages", String(machine.packages?.length ?? 0)],
      ["apps", String(machine.apps?.length ?? 0)],
      ["files", String(machine.files?.length ?? 0)],
      ["tags", machine.tags?.join(", ") || "none"],
      ["metadata keys", metadataSummary(machine.metadata)],
      ["updated", machine.updatedAt ?? "unknown"],
    ]),
  ];

  if (options.verbose) {
    lines.push(renderKeyValueTable([
      ["hostname", machine.hostname ?? "none"],
      ["ssh address", machine.sshAddress ?? "none"],
      ["tailscale", machine.tailscaleName ?? "none"],
      ["workspace path", machine.workspacePath],
      ["bun path", machine.bunPath ?? "none"],
      ["metadata", machine.metadata ? truncateText(JSON.stringify(machine.metadata), 240) : "none"],
    ]));
  }

  lines.push(options.verbose
    ? "hint: use --json for the complete manifest object."
    : "hint: use --verbose for host/path previews or --json for the complete manifest object.");
  return lines.join("\n");
}

export function renderManifestSummary(manifest: FleetManifest, options: CompactRenderOptions = {}): string {
  const page = pageItems(manifest.machines, options);
  const lines = [
    renderKeyValueTable([
      ["manifest version", String(manifest.version)],
      ["generated", manifest.generatedAt ?? "unknown"],
      ["machines", `${page.items.length}/${page.total}`],
      ["limit", page.limit === null ? "all" : String(page.limit)],
      ["cursor", String(page.offset)],
      ["has more", String(page.hasMore)],
    ]),
  ];

  if (page.items.length === 0) {
    lines.push("machines: none");
  } else {
    lines.push("machines:");
    for (const machine of page.items) {
      const tags = machine.tags?.length ? ` tags:${truncateText(machine.tags.join(","), 32)}` : "";
      const fields = `packages:${machine.packages?.length ?? 0} apps:${machine.apps?.length ?? 0} files:${machine.files?.length ?? 0}`;
      lines.push(`${displayName(machine).padEnd(18)} ${machine.id.padEnd(18)} ${machine.platform.padEnd(8)} ${fields}${tags} updated:${machine.updatedAt ?? "unknown"}`);
      if (options.verbose) {
        lines.push(`  host:${machine.hostname ?? "none"} tailscale:${machine.tailscaleName ?? "none"} workspace:${truncateText(machine.workspacePath, 72)} metadata:${metadataSummary(machine.metadata)}`);
      }
    }
  }

  if (page.hasMore) {
    lines.push(`hint: use --cursor ${page.nextOffset} --limit ${page.limit ?? DEFAULT_COMPACT_LIMIT} for the next page, --all for all compact rows, or --json for full objects.`);
  } else {
    lines.push("hint: use manifest get <id> --verbose for one machine, or --json for full objects.");
  }
  return lines.join("\n");
}

export function renderManifestMutationSummary(action: string, manifest: FleetManifest, machineId?: string): string {
  return renderKeyValueTable([
    ["action", action],
    ["machine", machineId ?? "n/a"],
    ["manifest machines", String(manifest.machines.length)],
    ["hint", "use manifest list --json for the complete manifest"],
  ]);
}

function renderPlanItems(result: SetupResult | SyncResult, verbose = false): string[] {
  if ("steps" in result) {
    return result.steps.map((step) => {
      const base = `${step.id.padEnd(24)} ${step.manager.padEnd(7)} ${step.privileged ? "sudo " : "     "}${truncateText(step.title, 88)}`;
      return verbose ? `${base}\n  command: ${truncateText(step.command, 160)}` : base;
    });
  }

  return result.actions.map((action) => {
    const base = `${action.id.padEnd(24)} ${action.status.padEnd(8)} ${action.kind.padEnd(8)} ${truncateText(action.title, 88)}`;
    return verbose ? `${base}\n  command: ${truncateText(action.command, 160)}` : base;
  });
}

export function renderPlanSummary(result: SetupResult | SyncResult, label: "steps" | "actions", options: CompactRenderOptions = {}): string {
  const items = renderPlanItems(result, Boolean(options.verbose));
  const page = pageItems(items, options);
  const lines = [
    renderKeyValueTable([
      ["machine", result.machineId],
      ["mode", result.mode],
      [label, `${page.items.length}/${page.total}`],
      ["executed", String(result.executed)],
      ["plan digest", result.planDigest ?? "none"],
    ]),
    renderList(label, page.items),
  ];
  if (page.hasMore) {
    lines.push(`hint: use --cursor ${page.nextOffset} --limit ${page.limit ?? DEFAULT_COMPACT_LIMIT} for more rows, --verbose for commands, or --json for full output.`);
  } else {
    lines.push("hint: use --verbose for command previews or --json for full output.");
  }
  return lines.join("\n");
}

export function renderDiffSummary(result: MachineDiff): string {
  return [
    renderKeyValueTable([
      ["left", result.leftMachineId],
      ["right", result.rightMachineId],
      ["changed fields", result.changedFields.join(", ") || "none"],
      ["left-only packages", String(result.missingPackages.leftOnly.length)],
      ["right-only packages", String(result.missingPackages.rightOnly.length)],
      ["left-only files", String(result.missingFiles.leftOnly.length)],
      ["right-only files", String(result.missingFiles.rightOnly.length)],
    ]),
    renderList("left-only packages", result.missingPackages.leftOnly),
    renderList("right-only packages", result.missingPackages.rightOnly),
    "hint: use --json for full diff arrays.",
  ].join("\n");
}

export function renderDomainMappingsSummary(mappings: DomainMapping[], options: CompactPageOptions = {}): string {
  const page = pageItems(mappings, options, DEFAULT_HISTORY_LIMIT);
  const lines = [
    renderKeyValueTable([
      ["mappings", `${page.items.length}/${page.total}`],
      ["limit", page.limit === null ? "all" : String(page.limit)],
      ["cursor", String(page.offset)],
    ]),
  ];
  lines.push(renderList("domains", page.items.map((entry) => `${entry.domain.padEnd(28)} ${entry.targetHost}:${entry.port}`)));
  lines.push(page.hasMore
    ? `hint: use --cursor ${page.nextOffset} --limit ${page.limit ?? DEFAULT_HISTORY_LIMIT} for more rows, or --json for full output.`
    : "hint: use dns render <domain> for config snippets, or --json for full output.");
  return lines.join("\n");
}

export function renderDomainRenderSummary(result: { hostsEntry: string; caddySnippet: string; certPath: string; keyPath: string }, verbose = false): string {
  const lines = [
    renderKeyValueTable([
      ["hosts", result.hostsEntry],
      ["cert", result.certPath],
      ["key", result.keyPath],
      ["caddy", verbose ? result.caddySnippet : truncateText(result.caddySnippet, 120)],
    ]),
  ];
  lines.push(verbose ? "hint: use --json for structured fields." : "hint: use --verbose for the full snippet or --json for structured fields.");
  return lines.join("\n");
}

export function renderPortsSummary(result: PortsResult, options: CompactPageOptions = {}): string {
  const page = pageItems(result.listeners, options, DEFAULT_HISTORY_LIMIT);
  const lines = [
    renderKeyValueTable([
      ["machine", result.machineId],
      ["listeners", `${page.items.length}/${page.total}`],
      ["limit", page.limit === null ? "all" : String(page.limit)],
      ["cursor", String(page.offset)],
    ]),
  ];
  lines.push(renderList("ports", page.items.map((entry) => `${String(entry.port).padEnd(6)} ${entry.protocol.padEnd(6)} ${truncateText(entry.host, 36).padEnd(36)} ${truncateText(entry.process ?? "unknown", 72)}`)));
  lines.push(page.hasMore
    ? `hint: use --cursor ${page.nextOffset} --limit ${page.limit ?? DEFAULT_HISTORY_LIMIT} for more rows, or --json for full output.`
    : "hint: use --json for full listener details.");
  return lines.join("\n");
}

function summarizeArray(label: string, values: unknown[], limit = DEFAULT_COMPACT_LIMIT): string[] {
  const page = pageItems(values, { limit });
  const rows = page.items.map((value, index) => {
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const id = record.id ?? record.machine_id ?? record.machineId ?? record.channelId ?? record.channel_id ?? `#${index + 1}`;
      const status = record.status ?? record.state ?? record.type ?? record.transport ?? "";
      const name = record.display_name ?? record.displayName ?? record.name ?? record.title ?? record.message ?? "";
      return `${String(id).padEnd(24)} ${truncateText(status, 16).padEnd(16)} ${truncateText(name, 80)}`.trimEnd();
    }
    return truncateText(value, 120);
  });
  if (rows.length === 0) return [`${label}: none`];
  const suffix = page.hasMore ? [`hint: showing ${rows.length}/${page.total} ${label}; pass verbose: true for full JSON.`] : [];
  return [`${label}:`, ...rows.map((row) => `- ${row}`), ...suffix];
}

function summarizeObjectFields(value: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(value).slice(0, DEFAULT_COMPACT_LIMIT).map(([key, entry]) => {
    if (Array.isArray(entry)) return [key, countLabel(entry.length, "item")];
    if (entry && typeof entry === "object") return [key, `object(${Object.keys(entry).length} keys)`];
    return [key, truncateText(entry, 100)];
  });
}

export function renderMcpCompactResult(label: string, data: unknown): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(data)) {
      return [`${label}: ${countLabel(data.length, "item")}`, ...summarizeArray("items", data), "hint: pass verbose: true for full JSON."].join("\n");
    }
    if (Array.isArray(record["machines"]) && typeof record["version"] === "number") {
      return `${renderManifestSummary(data as FleetManifest)}\nhint: pass verbose: true for full JSON.`;
    }
    if (Array.isArray(record["machines"])) {
      return [`${label}:`, ...summarizeArray("machines", record["machines"]), "hint: pass verbose: true for full JSON details."].join("\n");
    }
    if (Array.isArray(record["steps"])) {
      return renderPlanSummary(data as SetupResult, "steps");
    }
    if (Array.isArray(record["actions"])) {
      return renderPlanSummary(data as SyncResult, "actions");
    }
    if (Array.isArray(record["listeners"])) {
      return renderPortsSummary(data as PortsResult);
    }
    if (Array.isArray(record["checks"])) {
      return [
        `${label}:`,
        renderKeyValueTable(summarizeObjectFields(record).filter(([key]) => key !== "checks")),
        ...summarizeArray("checks", record["checks"]),
        "hint: pass verbose: true for full JSON.",
      ].join("\n");
    }
    if (Array.isArray(record["channels"])) {
      return [`${label}:`, ...summarizeArray("channels", record["channels"]), "hint: pass verbose: true for full JSON."].join("\n");
    }
    if (Array.isArray(record["agents"])) {
      return [`${label}:`, ...summarizeArray("agents", record["agents"]), "hint: pass verbose: true for full JSON."].join("\n");
    }
    if (Array.isArray(record["events"])) {
      return [`${label}:`, ...summarizeArray("events", record["events"]), "hint: pass verbose: true for full JSON."].join("\n");
    }
    return [
      `${label}:`,
      renderKeyValueTable(summarizeObjectFields(record)),
      "hint: pass verbose: true for full JSON.",
    ].join("\n");
  }

  return [`${label}: ${truncateText(data, 160)}`, "hint: pass verbose: true for full JSON."].join("\n");
}
