import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { getLocalMachineId } from "../db.js";
import { parseSysctlKeys } from "./loader.js";
import type { EffectiveTemplate } from "./schema.js";

export type CheckStatus = "ok" | "drift" | "violation" | "skipped";

export interface TemplateCheckItem {
  id: string;
  kind: "file" | "ordering" | "sysctl" | "runtime-value" | "package" | "service" | "unit-convention";
  status: CheckStatus;
  detail: string;
}

export interface TemplateCheckResult {
  schemaId: string;
  /**
   * Which box this report describes. The check reads the local filesystem, so
   * a fleet sweep that forgets that would otherwise attribute the
   * coordinator's own state to every station.
   */
  machineId: string;
  template: string;
  version: string;
  layers: string[];
  /** "clean" only when no drift AND no violation. Read the JSON, never the rc. */
  verdict: "clean" | "drift";
  checkedAt: string;
  items: TemplateCheckItem[];
}

export type CommandProbe = (command: string, args: string[]) => { ok: boolean; stdout: string };

export interface CheckOptions {
  /** Filesystem root for all absolute targets (tests use a fixture dir). */
  rootDir?: string;
  /** Home directory for ~/ targets. */
  homeDir?: string;
  /**
   * Probe for command-backed checks (dpkg-query, systemctl, bun). Pass null to
   * skip those checks entirely (they report status=skipped). Defaults to real
   * execution when rootDir is "/" and to skipped otherwise, so a fixture check
   * never shells out by accident.
   */
  commandProbe?: CommandProbe | null;
  /** Additional systemd unit dirs to scan for unit conventions. */
  unitDirs?: string[];
  /** Identity stamped into the result. Defaults to the local machine id. */
  machineId?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** systemd time-span units, longest spelling first so prefixes do not shadow. */
const SYSTEMD_TIME_UNITS: Array<[string, number]> = [
  ["usec", 1e-6],
  ["us", 1e-6],
  ["msec", 0.001],
  ["ms", 0.001],
  ["seconds", 1],
  ["second", 1],
  ["sec", 1],
  ["s", 1],
  ["minutes", 60],
  ["minute", 60],
  ["min", 60],
  ["m", 60],
  ["hours", 3600],
  ["hour", 3600],
  ["hr", 3600],
  ["h", 3600],
  ["days", 86400],
  ["day", 86400],
  ["d", 86400],
  ["weeks", 604800],
  ["week", 604800],
  ["w", 604800],
];

/**
 * systemd time span → seconds. A bare number is seconds, compound spans
 * ("5min 30s") sum. Returns null for anything systemd would not read as a
 * finite span (e.g. "infinity"), so the caller reports the raw text instead of
 * silently comparing NaN.
 */
function parseSystemdSeconds(value: string): number | null {
  let rest = value.trim();
  if (rest.length === 0) return null;
  if (/^\d+(\.\d+)?$/.test(rest)) return Number(rest);
  let total = 0;
  while (rest.length > 0) {
    const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)/i.exec(rest);
    if (!match) return null;
    const unit = SYSTEMD_TIME_UNITS.find(([name]) => name === match[2]!.toLowerCase());
    if (!unit) return null;
    total += Number(match[1]) * unit[1];
    rest = rest.slice(match[0].length).trim();
  }
  return total;
}

/** Directive assignments from one section, in unit-file-then-drop-in order. */
function sectionDirectiveAssignments(contents: string[], section: string, name: string): string[] {
  const assignments: string[] = [];
  const directivePattern = new RegExp(`^\\s*${name}\\s*=[ \\t]*(.*)$`);
  for (const content of contents) {
    let currentSection: string | null = null;
    for (const line of content.split(/\r?\n/)) {
      const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sectionMatch) {
        currentSection = sectionMatch[1]!;
        continue;
      }
      if (currentSection !== section) continue;
      const directiveMatch = directivePattern.exec(line);
      if (directiveMatch) assignments.push(directiveMatch[1]!.trim());
    }
  }
  return assignments;
}

/**
 * Effective value of a scalar directive across unit file + drop-ins: systemd
 * takes the last assignment in the directive's section, and an empty
 * assignment resets it to the default — which, for a directive we require to
 * be declared, means unset.
 */
function effectiveScalarDirective(contents: string[], section: string, name: string): string | null {
  let value: string | null = null;
  for (const raw of sectionDirectiveAssignments(contents, section, name)) {
    value = raw.length === 0 ? null : raw;
  }
  return value;
}

/**
 * Effective value of a list directive: entries accumulate across the unit file
 * and its drop-ins, and an empty assignment resets the list — the same rule
 * already applied to ExecStart.
 */
function effectiveListDirective(contents: string[], section: string, name: string): string[] {
  let values: string[] = [];
  for (const raw of sectionDirectiveAssignments(contents, section, name)) {
    if (raw.length === 0) {
      values = [];
    } else {
      values.push(...raw.split(/\s+/));
    }
  }
  return values;
}

function defaultCommandProbe(): CommandProbe {
  return (command, args) => {
    try {
      const stdout = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, stdout };
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout ?? "";
      return { ok: false, stdout: typeof stdout === "string" ? stdout : "" };
    }
  };
}

/**
 * Read-only drift check of a box against the effective template. NEVER
 * mutates anything — every probe is a read. The verdict lives in the returned
 * JSON (exit codes from hasna CLIs are unreliable; station contract §2).
 */
export function checkStationTemplate(effective: EffectiveTemplate, options: CheckOptions = {}): TemplateCheckResult {
  const rootDir = options.rootDir ?? "/";
  const homeDir = options.homeDir ?? homedir();
  const probe =
    options.commandProbe === null
      ? null
      : options.commandProbe ?? (rootDir === "/" ? defaultCommandProbe() : null);
  const items: TemplateCheckItem[] = [];

  const resolveTarget = (target: string): string =>
    target.startsWith("~/") ? join(homeDir, target.slice(2)) : join(rootDir, target.replace(/^\//, ""));

  for (const file of effective.files) {
    const resolved = resolveTarget(file.target);
    if (!existsSync(resolved)) {
      items.push({ id: `file:${file.id}`, kind: "file", status: "drift", detail: `${file.target} missing` });
      continue;
    }
    const actual = readFileSync(resolved, "utf8");
    if (actual === file.content) {
      items.push({ id: `file:${file.id}`, kind: "file", status: "ok", detail: `${file.target} matches (sha256 ${sha256(actual).slice(0, 12)})` });
    } else {
      items.push({
        id: `file:${file.id}`,
        kind: "file",
        status: "drift",
        detail: `${file.target} content mismatch: expected sha256 ${sha256(file.content).slice(0, 12)}, found ${sha256(actual).slice(0, 12)}`,
      });
    }
  }

  // Ordering: a sysctl file we manage must sort LAST among all files in its
  // directory that define any of its keys — the 2026-07-28 bug shipped a fix
  // that lost to the vendor's 99-dgx-spark.conf.
  for (const file of effective.files.filter((candidate) => candidate.kind === "sysctl")) {
    const resolved = resolveTarget(file.target);
    const dir = dirname(resolved);
    const ourName = basename(file.target);
    if (!existsSync(dir)) continue;
    const conflicts: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".conf") || entry === ourName) continue;
      let otherKeys: string[] = [];
      try {
        otherKeys = parseSysctlKeys(readFileSync(join(dir, entry), "utf8"));
      } catch {
        continue;
      }
      const overlapping = otherKeys.filter((key) => file.sysctlKeys.includes(key));
      if (overlapping.length > 0 && entry > ourName) {
        conflicts.push(`${entry} redefines ${overlapping.join(", ")} and sorts after ${ourName}`);
      }
    }
    items.push(
      conflicts.length === 0
        ? { id: `ordering:${file.id}`, kind: "ordering", status: "ok", detail: `${ourName} wins ordering for ${file.sysctlKeys.join(", ")}` }
        : { id: `ordering:${file.id}`, kind: "ordering", status: "violation", detail: conflicts.join("; ") }
    );
  }

  for (const [key, expected] of Object.entries(effective.sysctls)) {
    const procPath = join(rootDir, "proc/sys", key.replace(/\./g, "/"));
    if (!existsSync(procPath)) {
      items.push({ id: `sysctl:${key}`, kind: "sysctl", status: "skipped", detail: `${procPath} not readable` });
      continue;
    }
    const actual = readFileSync(procPath, "utf8").trim().replace(/\s+/g, " ");
    items.push(
      actual === expected
        ? { id: `sysctl:${key}`, kind: "sysctl", status: "ok", detail: `${key}=${actual}` }
        : { id: `sysctl:${key}`, kind: "sysctl", status: "drift", detail: `${key} expected ${expected}, found ${actual}` }
    );
  }

  for (const runtime of effective.runtimeValues) {
    const resolved = join(rootDir, runtime.path.replace(/^\//, ""));
    if (!existsSync(resolved)) {
      items.push({ id: `runtime:${runtime.path}`, kind: "runtime-value", status: "skipped", detail: `${runtime.path} not readable` });
      continue;
    }
    const actual = readFileSync(resolved, "utf8").trim();
    items.push(
      actual === runtime.value
        ? { id: `runtime:${runtime.path}`, kind: "runtime-value", status: "ok", detail: `${runtime.path}=${actual}` }
        : { id: `runtime:${runtime.path}`, kind: "runtime-value", status: "drift", detail: `${runtime.path} expected ${runtime.value}, found ${actual}` }
    );
  }

  for (const pkg of effective.packages.apt) {
    if (!probe) {
      items.push({ id: `package:apt:${pkg}`, kind: "package", status: "skipped", detail: "no command probe" });
      continue;
    }
    const result = probe("dpkg-query", ["-W", "-f=${Status}", pkg]);
    items.push(
      result.ok && result.stdout.includes("install ok installed")
        ? { id: `package:apt:${pkg}`, kind: "package", status: "ok", detail: `${pkg} installed` }
        : { id: `package:apt:${pkg}`, kind: "package", status: "drift", detail: `${pkg} not installed` }
    );
  }

  for (const service of effective.services) {
    if (!probe) {
      items.push({ id: `service:${service.name}`, kind: "service", status: "skipped", detail: "no command probe" });
      continue;
    }
    const systemctlArgs = service.scope === "user" ? ["--user"] : [];
    const active = probe("systemctl", [...systemctlArgs, "is-active", service.name]);
    const enabled = probe("systemctl", [...systemctlArgs, "is-enabled", service.name]);
    const activeOk = !service.expectActive || (active.ok && active.stdout.trim() === "active");
    const enabledOk = !service.expectEnabled || (enabled.ok && enabled.stdout.trim() === "enabled");
    items.push(
      activeOk && enabledOk
        ? { id: `service:${service.name}`, kind: "service", status: "ok", detail: `${service.name} ${active.stdout.trim()}/${enabled.stdout.trim()}` }
        : {
            id: `service:${service.name}`,
            kind: "service",
            status: "drift",
            detail: `${service.name} expected active=${service.expectActive} enabled=${service.expectEnabled}, found ${active.stdout.trim() || "unknown"}/${enabled.stdout.trim() || "unknown"}`,
          }
    );
  }

  if (effective.unitConventions) {
    const conventions = effective.unitConventions;
    const pattern = new RegExp(`^${conventions.match.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const unitDirs = options.unitDirs ?? [join(homeDir, ".config/systemd/user"), join(rootDir, "etc/systemd/system")];
    for (const unitDir of unitDirs) {
      if (!existsSync(unitDir)) continue;
      for (const entry of readdirSync(unitDir)) {
        if (!entry.endsWith(".service") || !pattern.test(entry)) continue;
        let contents: string[];
        try {
          contents = [readFileSync(join(unitDir, entry), "utf8")];
        } catch {
          continue;
        }
        const dropinDir = join(unitDir, `${entry}.d`);
        if (existsSync(dropinDir)) {
          for (const dropin of readdirSync(dropinDir).filter((name) => name.endsWith(".conf"))) {
            try {
              contents.push(readFileSync(join(dropinDir, dropin), "utf8"));
            } catch {
              /* unreadable drop-in: judged on the unit file alone */
            }
          }
        }
        const problems: string[] = [];
        // Presence is not the convention — the DECLARED VALUES are. A unit that
        // carries the systemd default 10s/5 window is the exact shape that
        // looped ~290k restarts on 2026-07-28, and an OnFailure pointing at a
        // unit we do not ship means no failure notification ever fires.
        const intervalRaw = effectiveScalarDirective(contents, "Unit", "StartLimitIntervalSec");
        if (intervalRaw === null) {
          problems.push("missing StartLimitIntervalSec");
        } else if (parseSystemdSeconds(intervalRaw) !== conventions.startLimitIntervalSec) {
          problems.push(`StartLimitIntervalSec=${intervalRaw}, convention is ${conventions.startLimitIntervalSec}`);
        }
        const burstRaw = effectiveScalarDirective(contents, "Unit", "StartLimitBurst");
        if (burstRaw === null) {
          problems.push("missing StartLimitBurst");
        } else if (Number(burstRaw) !== conventions.startLimitBurst) {
          problems.push(`StartLimitBurst=${burstRaw}, convention is ${conventions.startLimitBurst}`);
        }
        // OnFailure is a list with systemd reset semantics, like ExecStart.
        const onFailure = effectiveListDirective(contents, "Unit", "OnFailure");
        if (onFailure.length === 0) {
          problems.push("missing OnFailure");
        } else if (!onFailure.includes(conventions.onFailureUnit)) {
          problems.push(`OnFailure=${onFailure.join(" ")}, convention is ${conventions.onFailureUnit}`);
        }
        if (conventions.requireAbsoluteExecStart) {
          // systemd semantics: an empty `ExecStart=` resets the list, so a
          // drop-in can replace a bare ExecStart with an absolute one. Judge
          // only the effective list, in unit-file-then-drop-ins order.
          let effectiveExecStarts: string[] = [];
          for (const value of sectionDirectiveAssignments(contents, "Service", "ExecStart")) {
            if (value.length === 0) {
              effectiveExecStarts = [];
            } else {
              effectiveExecStarts.push(value);
            }
          }
          if (effectiveExecStarts.length === 0) {
            problems.push("missing ExecStart");
          } else if (effectiveExecStarts.some((value) => !value.replace(/^[-@:+!]+/, "").startsWith("/"))) {
            problems.push("ExecStart is not an absolute path (203/EXEC class)");
          }
        }
        items.push(
          problems.length === 0
            ? { id: `unit:${entry}`, kind: "unit-convention", status: "ok", detail: `${entry} meets conventions` }
            : { id: `unit:${entry}`, kind: "unit-convention", status: "violation", detail: `${entry}: ${problems.join(", ")}` }
        );
      }
    }
  }

  const verdict = items.some((item) => item.status === "drift" || item.status === "violation") ? "drift" : "clean";
  return {
    schemaId: "hasna.station_template.v1",
    machineId: options.machineId ?? getLocalMachineId(),
    template: effective.name,
    version: effective.version,
    layers: effective.layers,
    verdict,
    checkedAt: new Date().toISOString(),
    items,
  };
}
