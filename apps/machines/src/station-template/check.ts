import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { getLocalMachineId } from "../db.js";
import { parseSysctlKeys } from "./loader.js";
import { BASHRC_BLOCK_BEGIN, BASHRC_GUARD_REGEX } from "./bashrc-block.js";
import type { EffectiveTemplate } from "./schema.js";

export type CheckStatus = "ok" | "drift" | "violation" | "skipped";

export interface TemplateCheckItem {
  id: string;
  kind:
    | "file"
    | "ordering"
    | "sysctl"
    | "runtime-value"
    | "package"
    | "command"
    | "service"
    | "access-floor"
    | "unit-convention"
    | "tailscale"
    | "absence"
    | "swap"
    | "disk"
    | "journald";
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
  /**
   * "clean" only when no drift AND no violation.
   *
   * The rc is now load-bearing too — see `checkExitCode`. Until 0.3.0 it was
   * always 0 and every caller in the fleet had to parse this field and
   * explicitly distrust the exit code ("check_rc=0 (NOT trusted)" in every
   * driver measurement). Both are now truthful; the JSON stays the richer
   * answer because it names WHICH item failed.
   */
  verdict: "clean" | "drift";
  checkedAt: string;
  items: TemplateCheckItem[];
}

export type CommandProbe = (command: string, args: string[]) => { ok: boolean; stdout: string };

/**
 * Process exit code for a drift check.
 *
 * `0 clean / 1 findings / 2 incomplete`, matching the exit-code contract on the
 * table for `todos doctor` (task 71f7faba). That contract is scoped to the
 * todos CLI and has not landed, so it does not bind this one — but the estate
 * gets ONE numeric language for "did the check pass", not two, so this
 * conforms rather than inventing a second convention.
 *
 * Findings outrank incompleteness: if something was found, that is the answer,
 * regardless of what else could not be probed.
 *
 * 2 matters as much as 1. A check with `skipped` items has not proven the box
 * clean, it has proven it could not look — and "could not look" reported as
 * success is how the previous version of this gate passed a station running a
 * live tailscale it was supposed to assert was absent.
 */
export function checkExitCode(result: TemplateCheckResult): 0 | 1 | 2 {
  if (result.items.some((item) => item.status === "drift" || item.status === "violation")) return 1;
  if (result.items.some((item) => item.status === "skipped")) return 2;
  return 0;
}

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
  /**
   * Root of bun's global install tree. Defaults to $BUN_INSTALL or ~/.bun,
   * matching bun's own resolution, so `bun install -g` results are checkable.
   */
  bunInstallDir?: string;
  /** Identity stamped into the result. Defaults to the local machine id. */
  machineId?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Compare two semver core versions. Returns <0, 0, >0, or null when either
 * side is not readable as x.y.z — an unreadable version is never silently
 * treated as satisfying a floor.
 *
 * Prerelease handling follows semver: 1.2.3-rc.1 sorts BELOW 1.2.3, so a
 * release candidate does not satisfy a floor of the release it precedes.
 * Build metadata (+sha) is ignored, as semver requires.
 */
export function compareVersions(left: string, right: string): number | null {
  const parse = (value: string): { core: number[]; prerelease: boolean } | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
    if (!match) return null;
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] !== undefined };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index]! !== b.core[index]!) return a.core[index]! - b.core[index]!;
  }
  if (a.prerelease === b.prerelease) return 0;
  return a.prerelease ? -1 : 1;
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

/**
 * Directive assignments from the requested systemd section, in declaration
 * order. Directives in another section are ignored by systemd even when their
 * names and values are otherwise valid.
 */
function directiveAssignments(contents: readonly string[], section: string, name: string): string[] {
  const assignments: string[] = [];
  const directivePattern = new RegExp(`^\\s*${name}\\s*=[ \\t]*(.*)$`);
  for (const content of contents) {
    // systemd parses each unit/drop-in as a separate file. In particular, a
    // drop-in without a section header must not inherit the unit's last one.
    let currentSection: string | null = null;
    for (const line of content.split(/\r?\n/)) {
      const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sectionMatch) {
        // Whitespace inside the brackets is part of the section name: systemd
        // reports `[ Unit ]` as unknown rather than treating it as `[Unit]`.
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
 * takes the last assignment, and an empty assignment resets it to the default
 * — which, for a directive we require to be declared, means unset.
 */
function effectiveScalarDirective(contents: readonly string[], section: string, name: string): string | null {
  let value: string | null = null;
  for (const raw of directiveAssignments(contents, section, name)) {
    value = raw.length === 0 ? null : raw;
  }
  return value;
}

/**
 * Effective value of a list directive: entries accumulate across the unit file
 * and its drop-ins, and an empty assignment resets the list — the same rule
 * already applied to ExecStart.
 */
function effectiveListDirective(contents: readonly string[], section: string, name: string): string[] {
  let values: string[] = [];
  for (const raw of directiveAssignments(contents, section, name)) {
    if (raw.length === 0) {
      values = [];
    } else {
      values.push(...raw.split(/\s+/));
    }
  }
  return values;
}

/** Systemd applies drop-ins by filename, independent of directory enumeration order. */
export function sortSystemdDropinNames(names: readonly string[]): string[] {
  return names.filter((name) => name.endsWith(".conf")).sort();
}

/** Directive names declared in the given section of one config file, in declaration order, deduped. */
function declaredDirectiveNames(content: string, section: string): string[] {
  const names: string[] = [];
  let currentSection: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      continue;
    }
    if (currentSection !== section) continue;
    const directiveMatch = /^\s*([A-Za-z][A-Za-z0-9]*)\s*=/.exec(line);
    if (directiveMatch && !names.includes(directiveMatch[1]!)) names.push(directiveMatch[1]!);
  }
  return names;
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
 * JSON, and since 0.3.0 the CLI's exit code carries it too (`checkExitCode`):
 * station contract §2 said exit codes from hasna CLIs are unreliable, and the
 * answer to that was to fix the exit code, not to keep writing gates that
 * distrust it.
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
    if (file.kind === "bashrc-block") {
      // The block must be present VERBATIM and must sort BEFORE the stock
      // interactive guard — a block after the guard is dead code for exactly
      // the shells it exists to serve (ssh/mosh remote commands, which are
      // non-login non-interactive and read only ~/.bashrc; station17
      // 2026-07-30). Present-but-late is therefore a violation, not drift.
      const blockIndex = actual.indexOf(file.content);
      if (blockIndex < 0) {
        const beginIndex = actual.indexOf(BASHRC_BLOCK_BEGIN);
        items.push({
          id: `file:${file.id}`,
          kind: "file",
          status: "drift",
          detail:
            beginIndex < 0
              ? `${file.target} managed block missing (marker "${BASHRC_BLOCK_BEGIN}" not found)`
              : `${file.target} managed block content mismatch: expected sha256 ${sha256(file.content).slice(0, 12)}`,
        });
        continue;
      }
      const guardMatch = BASHRC_GUARD_REGEX.exec(actual);
      if (guardMatch && guardMatch.index < blockIndex) {
        items.push({
          id: `file:${file.id}`,
          kind: "file",
          status: "violation",
          detail:
            `${file.target} managed block sits AFTER the interactive guard — non-login non-interactive ` +
            `shells (ssh/mosh remote commands) return before reaching it`,
        });
        continue;
      }
      items.push({
        id: `file:${file.id}`,
        kind: "file",
        status: "ok",
        detail: `${file.target} managed block present above the interactive guard (sha256 ${sha256(file.content).slice(0, 12)})`,
      });
      continue;
    }
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

  // Effective journald directives. The byte check above only proves OUR
  // drop-in is intact; systemd merges <conf>.conf with every *.conf in
  // <conf>.conf.d sorted by filename, later files winning — so a
  // later-sorting override defeats the cap while file:journald-cap still
  // reads ok. This names the directive with expected-vs-found. Scope: the
  // /etc-level merge only (vendor /usr/lib and runtime /run drop-ins are not
  // read); and config ON DISK, not config in force — a journald never
  // restarted after an edit is invisible here, which is why both renders
  // restart it at apply time.
  for (const file of effective.files.filter((candidate) => candidate.kind === "journald-dropin")) {
    const dropinDir = dirname(resolveTarget(file.target));
    if (!dropinDir.endsWith(".conf.d")) continue;
    const contents: string[] = [];
    const stockConf = dropinDir.slice(0, -2);
    if (existsSync(stockConf)) {
      try {
        contents.push(readFileSync(stockConf, "utf8"));
      } catch {
        /* unreadable stock conf: judged on the drop-ins alone */
      }
    }
    if (existsSync(dropinDir)) {
      for (const entry of sortSystemdDropinNames(readdirSync(dropinDir))) {
        try {
          contents.push(readFileSync(join(dropinDir, entry), "utf8"));
        } catch {
          /* unreadable drop-in: judged on the readable set */
        }
      }
    }
    for (const name of declaredDirectiveNames(file.content, "Journal")) {
      const expected = effectiveScalarDirective([file.content], "Journal", name);
      if (expected === null) continue;
      const actual = effectiveScalarDirective(contents, "Journal", name);
      items.push(
        actual === expected
          ? { id: `journald:${name}`, kind: "journald", status: "ok", detail: `${name}=${actual} effective across ${basename(stockConf)} + drop-ins` }
          : {
              id: `journald:${name}`,
              kind: "journald",
              status: "drift",
              detail: `${name} expected ${expected}, effective value across ${basename(stockConf)} + sorted drop-ins is ${actual ?? "unset (journald's built-in default applies)"}`,
            }
      );
    }
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

  // Binaries the template requires on PATH. An apt name cannot express this:
  // the ec2 overlay's `awscli` had no installation candidate on noble, so the
  // requirement was permanently unsatisfiable AND the box that DID have AWS
  // CLI v2 at /usr/local/bin/aws still reported drift.
  for (const command of effective.commands) {
    if (!probe) {
      items.push({ id: `command:${command.id}`, kind: "command", status: "skipped", detail: "no command probe" });
      continue;
    }
    const result = probe("sh", ["-c", `command -v -- ${command.command}`]);
    const resolved = result.stdout.trim();
    items.push(
      result.ok && resolved.length > 0
        ? { id: `command:${command.id}`, kind: "command", status: "ok", detail: `${command.command} -> ${resolved}` }
        : { id: `command:${command.id}`, kind: "command", status: "drift", detail: `${command.command} not on PATH` }
    );
  }

  // Bun globals were declared by the template from day one and checked by
  // nothing: the shipped station lists 12 hasna CLIs, and a station missing
  // every one of them still reported clean on this axis.
  // $BUN_INSTALL is honoured only for a real check. Letting the ambient env win
  // during a fixture check would point the probe at the coordinator's own bun
  // tree — the same mis-attribution the machineId field exists to prevent.
  const bunRoot =
    options.bunInstallDir ??
    (rootDir === "/" ? process.env["BUN_INSTALL"] ?? join(homeDir, ".bun") : join(homeDir, ".bun"));
  for (const pkg of effective.packages.bun) {
    const manifest = join(bunRoot, "install/global/node_modules", pkg.name, "package.json");
    if (!existsSync(manifest)) {
      items.push({ id: `package:bun:${pkg.name}`, kind: "package", status: "drift", detail: `${pkg.name} not installed globally (${manifest} missing)` });
      continue;
    }
    let version: string | null = null;
    try {
      version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version ?? null;
    } catch {
      version = null;
    }
    // PRESENCE WAS THE WHOLE CONTRACT until 2026-07-30, and it made these 12
    // items version-blind: any version at all read ok, including a fixture
    // planted at 9.9.9 that a test asserted was ok. A station running a CLI
    // from before a fix is not converged just because the directory exists.
    if (!pkg.minVersion) {
      items.push({
        id: `package:bun:${pkg.name}`,
        kind: "package",
        status: "ok",
        detail: `${pkg.name}@${version ?? "unknown"} installed globally (no minVersion declared — presence only, version NOT asserted)`,
      });
      continue;
    }
    if (version === null) {
      items.push({
        id: `package:bun:${pkg.name}`,
        kind: "package",
        status: "drift",
        detail: `${pkg.name} installed but its package.json declares no readable version — cannot prove it meets the ${pkg.minVersion} floor`,
      });
      continue;
    }
    const comparison = compareVersions(version, pkg.minVersion);
    if (comparison === null) {
      items.push({
        id: `package:bun:${pkg.name}`,
        kind: "package",
        status: "drift",
        detail: `${pkg.name}@${version} is not readable as semver — cannot prove it meets the ${pkg.minVersion} floor`,
      });
      continue;
    }
    items.push(
      comparison >= 0
        ? { id: `package:bun:${pkg.name}`, kind: "package", status: "ok", detail: `${pkg.name}@${version} installed globally (floor ${pkg.minVersion})` }
        : {
            id: `package:bun:${pkg.name}`,
            kind: "package",
            status: "drift",
            detail: `${pkg.name}@${version} is BELOW the declared floor ${pkg.minVersion} — present but stale; run bun install -g ${pkg.name}`,
          }
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

  // The access floor is the guaranteed way into the box (EC2: the SSM agent,
  // authorized purely by the instance profile — no boot-time secret). A down
  // floor is not mere drift: it means the next tailscale failure reproduces
  // exactly the stranded-station17 state, so it reports as a violation.
  if (effective.accessFloor) {
    const floor = effective.accessFloor;
    if (!probe) {
      items.push({ id: `access-floor:${floor.service}`, kind: "access-floor", status: "skipped", detail: "no command probe" });
    } else {
      const active = probe("systemctl", ["is-active", floor.service]);
      const enabled = probe("systemctl", ["is-enabled", floor.service]);
      const floorUp = active.ok && active.stdout.trim() === "active" && enabled.ok && enabled.stdout.trim() === "enabled";
      items.push(
        floorUp
          ? { id: `access-floor:${floor.service}`, kind: "access-floor", status: "ok", detail: `${floor.service} active/enabled — floor access path present` }
          : {
              id: `access-floor:${floor.service}`,
              kind: "access-floor",
              status: "violation",
              detail: `access floor ${floor.service} not active+enabled (found ${active.stdout.trim() || "unknown"}/${enabled.stdout.trim() || "unknown"}) — one tailscale failure away from an unreachable station`,
            }
      );
    }
  }

  // DECLARED ABSENCES. Owner ruling 2026-07-30 took tailscale out of the EC2
  // path; the first implementation deleted the check along with it and left the
  // ruling UNASSERTED. Measured 2026-07-30 22:02Z: an EC2 render emitted
  // `tailscale_items=[]`, and station18 — with a LIVE tailscale reporting
  // BackendState=Running — read clean 42/42. The absence was claimed by a
  // directive and checked by nothing.
  //
  // So the question this item asks is not "is the tailnet healthy" (noise on a
  // box that must not have a tailnet) but "is it here at all", and any yes is a
  // violation: `setup --apply` does not uninstall things, so this cannot be
  // converged by re-running setup — it needs a human or a rebuild, which is
  // what `violation` means everywhere else in this file. Either way the
  // top-level verdict is `drift` and the CLI exits 1.
  for (const absence of effective.absences) {
    const found: string[] = [];
    const unprobed: string[] = [];
    for (const path of absence.paths) {
      if (existsSync(resolveTarget(path))) found.push(`${path} exists`);
    }
    if (absence.command) {
      if (!probe) {
        unprobed.push(`command ${absence.command}`);
      } else {
        const result = probe("sh", ["-c", `command -v -- ${absence.command}`]);
        const resolved = result.stdout.trim();
        if (result.ok && resolved.length > 0) found.push(`${absence.command} resolves on PATH -> ${resolved}`);
      }
    }
    if (absence.service) {
      if (!probe) {
        unprobed.push(`service ${absence.service}`);
      } else {
        // LoadState, not is-active: a unit that exists but is stopped is still
        // installed, and "inactive" would read as absent. systemd answers
        // "not-found" only when it has no such unit at all.
        const load = probe("systemctl", ["show", "-p", "LoadState", "--value", absence.service]);
        const state = load.stdout.trim();
        if (load.ok && state.length > 0 && state !== "not-found") {
          found.push(`unit ${absence.service} is known to systemd (LoadState=${state})`);
        }
      }
    }
    if (found.length > 0) {
      items.push({
        id: `absence:${absence.id}`,
        kind: "absence",
        status: "violation",
        detail: `${absence.id} must NOT be present on this station class but was found: ${found.join("; ")}`,
      });
    } else if (unprobed.length > 0) {
      // Never `ok` on the strength of the probes we could not run — that is the
      // vacuous-absence shape this item exists to end.
      items.push({
        id: `absence:${absence.id}`,
        kind: "absence",
        status: "skipped",
        detail: `${absence.id} absent from ${absence.paths.length} checked path(s), but ${unprobed.join(" and ")} could not be probed (no command probe)`,
      });
    } else {
      items.push({
        id: `absence:${absence.id}`,
        kind: "absence",
        status: "ok",
        detail: `${absence.id} absent as declared (${[
          ...absence.paths.map((path) => `${path} missing`),
          ...(absence.command ? [`${absence.command} not on PATH`] : []),
          ...(absence.service ? [`${absence.service} unknown to systemd`] : []),
        ].join("; ")})`,
      });
    }
  }

  // Owner ruling 2026-07-30: this block never fires for a station,ec2 render —
  // no shipped cloud layer declares tailscale (asserted with a positive
  // control in station-template.test.ts), so an EC2 drift report carries no
  // tailscale:join item. A check for a thing we deliberately do not run is
  // noise, and noise is how real drift gets ignored. Physical classes keep it.
  //
  // `tailscaled active/enabled` is NOT tailnet membership. station17 reported
  // service:tailscaled ok on 2026-07-29 while `tailscale status` said "Logged
  // out" — the daemon runs fine with no node key, so the service check alone
  // says clean about a station nothing can reach. Note also that
  // `tailscale status --json` EXITS 0 when logged out: only BackendState is
  // the verdict.
  if (effective.tailscale?.join) {
    if (!probe) {
      items.push({ id: "tailscale:join", kind: "tailscale", status: "skipped", detail: "no command probe" });
    } else {
      const result = probe("tailscale", ["status", "--json"]);
      let backendState: string | null = null;
      let selfName: string | null = null;
      try {
        const parsed = JSON.parse(result.stdout) as { BackendState?: string; Self?: { HostName?: string } };
        backendState = parsed.BackendState ?? null;
        selfName = parsed.Self?.HostName ?? null;
      } catch {
        backendState = null;
      }
      if (backendState === null) {
        items.push({ id: "tailscale:join", kind: "tailscale", status: "drift", detail: "tailscale status --json unreadable (is tailscale installed?)" });
      } else if (backendState === "Running") {
        items.push({ id: "tailscale:join", kind: "tailscale", status: "ok", detail: `joined tailnet as ${selfName ?? "unknown"} (BackendState=Running)` });
      } else {
        items.push({
          id: "tailscale:join",
          kind: "tailscale",
          status: "drift",
          detail: `not on the tailnet: BackendState=${backendState} (tailscaled can be active+enabled and still hold no node key)`,
        });
      }
    }
  }

  // The ec2 overlay asks for an 8G swapfile because earlyoom's SIGTERM
  // condition is MemAvailable AND free-swap; with no swap the backstop the
  // template exists to provide never trips on the axis that killed station01.
  if (effective.swap.sizeGb > 0) {
    const swapsPath = join(rootDir, "proc/swaps");
    if (!existsSync(swapsPath)) {
      items.push({ id: "swap:size", kind: "swap", status: "skipped", detail: `${swapsPath} not readable` });
    } else {
      let totalKb = 0;
      for (const line of readFileSync(swapsPath, "utf8").split("\n").slice(1)) {
        const size = line.trim().split(/\s+/)[2];
        if (size && /^\d+$/.test(size)) totalKb += Number(size);
      }
      const totalGb = totalKb / 1024 / 1024;
      // fallocate -l 8G yields slightly under 8 GiB of usable swap once the
      // header is taken out, so require 95% rather than an exact match.
      items.push(
        totalGb >= effective.swap.sizeGb * 0.95
          ? { id: "swap:size", kind: "swap", status: "ok", detail: `${totalGb.toFixed(2)}G swap active (expected ${effective.swap.sizeGb}G)` }
          : { id: "swap:size", kind: "swap", status: "drift", detail: `expected ${effective.swap.sizeGb}G swap, found ${totalGb.toFixed(2)}G` }
      );
    }
  }

  // Root-volume floor. station17 build 2 (2026-07-29) launched on the 8G
  // AMI-default volume, and the ec2 overlay's 8G swapfile filled it to 364K
  // free: journald down, cloud-final FAILED. Setup cannot converge an
  // undersized volume — the fix is a relaunch with explicit
  // BlockDeviceMappings — so an undersized root is a violation, not drift.
  if (effective.disk) {
    const disk = effective.disk;
    if (!probe) {
      items.push({ id: "disk:root", kind: "disk", status: "skipped", detail: "no command probe" });
    } else {
      const result = probe("df", ["-kP", rootDir]);
      const row = result.stdout.split("\n")[1]?.trim().split(/\s+/) ?? [];
      const totalKb = row[1] && /^\d+$/.test(row[1]) ? Number(row[1]) : null;
      const availKb = row[3] && /^\d+$/.test(row[3]) ? Number(row[3]) : null;
      if (!result.ok || totalKb === null) {
        items.push({ id: "disk:root", kind: "disk", status: "skipped", detail: `df -kP ${rootDir} unreadable` });
      } else {
        const totalGb = totalKb / 1024 / 1024;
        // A 64G EBS volume presents a slightly smaller filesystem once
        // partitioning and reserved blocks are taken out — require 90%.
        items.push(
          totalGb >= disk.rootMinGb * 0.9
            ? { id: "disk:root", kind: "disk", status: "ok", detail: `root filesystem ${totalGb.toFixed(1)}G meets the ${disk.rootMinGb}G-volume floor (90% tolerance covers partitioning/reserved-block overhead)` }
            : {
                id: "disk:root",
                kind: "disk",
                status: "violation",
                detail: `root filesystem ${totalGb.toFixed(1)}G is under the ${disk.rootMinGb}G floor — undersized at launch; setup cannot converge this, relaunch with explicit BlockDeviceMappings (station17 build 2 filled an 8G AMI-default root and lost cloud-final)`,
              }
        );
        // Free-space floor: at hard-0 free, SSM commands return EMPTY output
        // instead of errors (measured on station17 build 2 mid-capture) — a
        // full disk silently degrades the only access path, so report it
        // while there is still room to act. Drift, not violation: cleanup
        // converges it.
        if (disk.minFreeGb !== undefined && availKb !== null) {
          const availGb = availKb / 1024 / 1024;
          items.push(
            availGb >= disk.minFreeGb
              ? { id: "disk:free", kind: "disk", status: "ok", detail: `${availGb.toFixed(1)}G free (floor ${disk.minFreeGb}G)` }
              : {
                  id: "disk:free",
                  kind: "disk",
                  status: "drift",
                  detail: `${availGb.toFixed(1)}G free is under the ${disk.minFreeGb}G floor — at 0 free the SSM agent returns empty output instead of errors, silently degrading the only access path (station17 build 2)`,
                }
          );
        }
      }
    }
  }

  if (effective.unitConventions) {
    const conventions = effective.unitConventions;
    const pattern = new RegExp(`^${conventions.match.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const unitDirs = options.unitDirs ?? [join(homeDir, ".config/systemd/user"), join(rootDir, "etc/systemd/system")];
    for (const unitDir of unitDirs) {
      if (!existsSync(unitDir)) continue;
      for (const entry of readdirSync(unitDir)) {
        if (!entry.endsWith(".service") || !pattern.test(entry)) continue;
        let contents: string[] = [];
        try {
          contents = [readFileSync(join(unitDir, entry), "utf8")];
        } catch {
          continue;
        }
        const dropinDir = join(unitDir, `${entry}.d`);
        if (existsSync(dropinDir)) {
          for (const dropin of sortSystemdDropinNames(readdirSync(dropinDir))) {
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
          for (const value of directiveAssignments(contents, "Service", "ExecStart")) {
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
