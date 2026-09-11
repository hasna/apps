/**
 * `trash` — the CLI surface.
 *
 * Verbs: put, list, restore, purge, empty, status, info, doctor, config.
 *
 * Grammar is rm's (§15 correction 9: "rm-grammar only" — the guard must be
 * able to rewrite `rm -rf ./build` into a trash call by substitution, not by
 * translation). `-r`/`-R`/`--recursive` and `-f`/`--force` are accepted,
 * combined (`-rf`) or separate; nothing else about `rm`'s grammar is
 * reinterpreted, and no new spelling is invented.
 *
 * Exit codes are part of the contract because the phase-2 guard rewrites `rm`
 * into a call to this binary and must propagate the result faithfully:
 *
 *   0  the requested work was done (a missing path under `put` is NOT an error
 *      — `rm -f` semantics)
 *   1  an error (bad usage, unreadable store, a restore that cannot proceed)
 *   2  REFUSED — capture failed on a non-excluded path, so the delete was
 *      refused too (§11.7). The path is untouched.
 */

import {
  DEFAULT_TRASH_CONFIG,
  CONFIG_KEYS,
  saveTrashConfig,
  setConfigValue,
  unsetConfigValue,
} from "../lib/config.js";
import { TrashStore, type DoctorCheck, type PutOutcome, type RemoteUploader, type RemoteVerifier } from "../lib/store.js";
import { listRefusals } from "../lib/refusals.js";
import type { TrashRootOverrides } from "../paths.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_REFUSED = 2;

const HELP = `trash — reversible deletion

usage: trash [global flags] <verb> [args]

verbs
  put <path...>            move paths into the trash store (rm grammar: -r, -f)
  list                     list staged entries
  restore <id> [--to P]    move an entry back to its original path
  purge <id...>            remove entries and their payloads (needs --apply)
  empty                    purge everything (needs --apply)
  status                   store usage, quota, mode
  info <id>                the entry's metadata document
  doctor                   environment and store checks
  config [list|get|set|unset|path]

global flags
  --spool <dir>            collapse every root under one directory (the guard
                           embeds this absolute path in the rewritten command)
  --files <dir>            payload directory only
  --info <dir>             metadata directory only
  --config <path>          config file
  --json                   machine-readable output
  --agent <name>           recorded on captures and refusals
  -h, --help               this text
  --version                print the version

exit codes
  0 done   1 error   2 refused (capture failed on a non-excluded path, so the
                       delete was refused too — §11.7)

The shell guard that rewrites \`rm\` into a trash call is phase 2
(\`hook-trash-guard\`, in @hasna/hooks); it will invoke
\`trash put --spool <abs> -rf <path>\`. The retention sweeper runs on an
independent timer in phase 3 — in phase 1 it is this verb: \`trash sweep\`.
`;

interface GlobalFlags {
  spool?: string;
  files?: string;
  info?: string;
  config?: string;
  json: boolean;
  agent?: string;
  help: boolean;
  version: boolean;
}

interface Parsed {
  flags: GlobalFlags;
  verb: string | null;
  rest: string[];
}

class UsageError extends Error {}

function parse(argv: string[]): Parsed {
  const flags: GlobalFlags = { json: false, help: false, version: false };
  let verb: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (verb === null && !arg.startsWith("-")) {
      verb = arg;
      continue;
    }
    if (verb === null) {
      switch (arg) {
        case "--spool":
        case "--files":
        case "--info":
        case "--config":
        case "--agent": {
          const value = argv[i + 1];
          if (value === undefined) throw new UsageError(`${arg} needs a value`);
          i += 1;
          if (arg === "--spool") flags.spool = value;
          else if (arg === "--files") flags.files = value;
          else if (arg === "--info") flags.info = value;
          else if (arg === "--config") flags.config = value;
          else flags.agent = value;
          continue;
        }
        case "--json":
          flags.json = true;
          continue;
        case "-h":
        case "--help":
          flags.help = true;
          continue;
        case "--version":
          flags.version = true;
          continue;
        default:
          throw new UsageError(`unknown global flag ${arg}`);
      }
    }
    rest.push(arg);
  }
  return { flags, verb, rest };
}

interface VerbFlags {
  json: boolean;
  force: boolean;
  recursive: boolean;
  apply: boolean;
  overwrite: boolean;
  all: boolean;
  to?: string;
  retentionDays?: number | null;
  positional: string[];
}

function parseVerbFlags(rest: string[], globals: GlobalFlags): VerbFlags {
  const out: VerbFlags = {
    json: globals.json,
    force: false,
    recursive: false,
    apply: false,
    overwrite: false,
    all: false,
    positional: [],
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === "--") {
      out.positional.push(...rest.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.includes("=") ? (arg.split("=", 2) as [string, string]) : [arg, undefined];
      const takeValue = (): string => {
        if (inline !== undefined) return inline;
        const value = rest[i + 1];
        if (value === undefined) throw new UsageError(`${name} needs a value`);
        i += 1;
        return value;
      };
      switch (name) {
        case "--force":
          out.force = true;
          break;
        case "--recursive":
          out.recursive = true;
          break;
        case "--apply":
          out.apply = true;
          break;
        case "--overwrite":
          out.overwrite = true;
          break;
        case "--all":
          out.all = true;
          break;
        case "--json":
          out.json = true;
          break;
        case "--to":
          out.to = takeValue();
          break;
        case "--retention": {
          const raw = takeValue();
          if (raw === "never") out.retentionDays = null;
          else {
            const days = Number(raw);
            if (!Number.isFinite(days) || days < 0) throw new UsageError(`--retention expects a non-negative number of days or "never"`);
            out.retentionDays = days;
          }
          break;
        }
        case "--help":
          out.all = false;
          out.positional.push("--help");
          break;
        default:
          throw new UsageError(`unknown flag ${name}`);
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      // rm's combined short flags: -rf, -fr, -r, -f
      for (const ch of arg.slice(1)) {
        if (ch === "r" || ch === "R") out.recursive = true;
        else if (ch === "f") out.force = true;
        else throw new UsageError(`unknown short flag -${ch}`);
      }
      continue;
    }
    out.positional.push(arg);
  }
  return out;
}

function makeStore(globals: GlobalFlags, runtime: CliRuntime = {}): TrashStore {
  const roots: TrashRootOverrides = {};
  if (globals.spool) roots.root = globals.spool;
  if (globals.files) roots.files = globals.files;
  if (globals.info) roots.info = globals.info;
  if (globals.config) roots.config = globals.config;
  return new TrashStore({
    roots,
    verifyRemote: runtime.verifyRemote,
    upload: runtime.upload,
  });
}

function human(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`;
}

function print(value: unknown, json: boolean, humanText: () => string): void {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${humanText()}\n`);
}

function outcomesExitCode(outcomes: PutOutcome[]): number {
  if (outcomes.some((outcome) => outcome.status === "refused")) return EXIT_REFUSED;
  return EXIT_OK;
}

function exit(code: number): never {
  process.exit(code);
}

async function main(argv: string[], runtime: CliRuntime = {}): Promise<number> {
  const { flags, verb, rest } = parse(argv);

  if (flags.version) {
    process.stdout.write("0.0.0\n");
    return EXIT_OK;
  }
  if (flags.help || verb === null) {
    process.stdout.write(HELP);
    return verb === null && !flags.help ? EXIT_ERROR : EXIT_OK;
  }

  const store = makeStore(flags, runtime);

  switch (verb) {
    case "put": {
      const verbFlags = parseVerbFlags(rest, flags);
      if (verbFlags.positional.includes("--help")) {
        process.stdout.write(HELP);
        return EXIT_OK;
      }
      if (verbFlags.positional.length === 0) throw new UsageError("put needs at least one path");

      const outcomes: PutOutcome[] = [];
      for (const target of verbFlags.positional) {
        const outcome = store.put(target, {
          force: verbFlags.force,
          agent: flags.agent,
          retentionDays: verbFlags.retentionDays,
        })[0]!;
        outcomes.push(outcome);
        if (!verbFlags.json) {
          const line =
            outcome.status === "captured"
              ? `trashed ${outcome.absolutePath} → ${outcome.entryId}`
              : outcome.status === "missing"
                ? `missing ${outcome.absolutePath} (rm -f semantics: not an error)`
                : outcome.status === "refused"
                  ? `REFUSED ${outcome.absolutePath}: ${outcome.detail}`
                  : `deleted-without-capture ${outcome.absolutePath}: ${outcome.detail}`;
          process.stderr.write(`${line}\n`);
        }
      }
      if (verbFlags.json) process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
      return outcomesExitCode(outcomes);
    }

    case "list": {
      const verbFlags = parseVerbFlags(rest, flags);
      const entries = store.list({ includeRestored: verbFlags.all });
      print(
        entries,
        verbFlags.json,
        () =>
          entries.length === 0
            ? "no entries"
            : entries
                .map(
                  (entry) =>
                    `${entry.id}  ${entry.status.padEnd(9)} ${entry.kind.padEnd(7)} ${human(entry.sizeBytes).padStart(9)}  ` +
                    `${entry.capturedAt}  ${entry.pinned ? "PINNED " : ""}${entry.remote ? "remote " : "local  "}${entry.originalPath}`,
                )
                .join("\n"),
      );
      return EXIT_OK;
    }

    case "restore": {
      const verbFlags = parseVerbFlags(rest, flags);
      const id = verbFlags.positional[0];
      if (!id) throw new UsageError("restore needs an entry id");
      const result = store.restore(id, { to: verbFlags.to, overwrite: verbFlags.overwrite });
      print(result, verbFlags.json, () => `restored ${result.id} → ${result.restoredTo} (${human(result.sizeBytes)}, sha256 ${result.sha256.slice(0, 12)}…)`);
      return EXIT_OK;
    }

    case "purge": {
      const verbFlags = parseVerbFlags(rest, flags);
      let ids = verbFlags.positional;
      if (verbFlags.all || ids.length === 0) {
        ids = store.list({ includeRestored: true }).map((entry) => entry.id);
      }
      const result = store.purge(ids, { apply: verbFlags.apply });
      print(
        result,
        verbFlags.json,
        () =>
          result.dryRun
            ? `dry run: would purge ${ids.length} entr${ids.length === 1 ? "y" : "ies"} — pass --apply to remove the payloads`
            : `purged ${result.purged.length} entr${result.purged.length === 1 ? "y" : "ies"} (${human(result.bytes)})`,
      );
      return EXIT_OK;
    }

    case "empty": {
      const verbFlags = parseVerbFlags(rest, flags);
      const result = store.empty({ apply: verbFlags.apply });
      print(
        result,
        verbFlags.json,
        () =>
          result.dryRun
            ? "dry run: would empty the store — pass --apply to remove the payloads"
            : `emptied the store: ${result.purged.length} entr${result.purged.length === 1 ? "y" : "ies"} (${human(result.bytes)})`,
      );
      return EXIT_OK;
    }

    case "status": {
      const verbFlags = parseVerbFlags(rest, flags);
      const status = store.status();
      print(
        status,
        verbFlags.json,
        () =>
          [
            `mode        ${status.mode}`,
            `roots       ${status.roots.files} (payloads), ${status.roots.info} (index)${status.legacyHome ? " [legacy home]" : ""}`,
            `entries     ${status.entries} (${status.pinned} pinned, ${status.unuploaded} un-uploaded, ${status.remoteConfirmed} remote-confirmed)`,
            `expired     ${status.expired}${status.restoring > 0 ? `, ${status.restoring} restoring` : ""}${status.restored > 0 ? `, ${status.restored} restored` : ""}`,
            `usage       ${human(status.bytes)} of ${human(status.quota.maxTotalBytes)}${status.quota.overQuota ? " — OVER QUOTA" : ""}`,
            `intents     ${status.pendingIntents} pending`,
            `refusals    ${status.refusals.total} recorded (${status.refusals.deleted} deleted without capture, ${status.refusals.refused} refused)`,
          ].join("\n"),
      );
      return EXIT_OK;
    }

    case "info": {
      const verbFlags = parseVerbFlags(rest, flags);
      const id = verbFlags.positional[0];
      if (!id) throw new UsageError("info needs an entry id");
      const entry = store.info(id);
      if (!entry) {
        process.stderr.write(`no such entry: ${id}\n`);
        return EXIT_ERROR;
      }
      process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return EXIT_OK;
    }

    case "doctor": {
      const verbFlags = parseVerbFlags(rest, flags);
      const checks = store.doctor();
      const failures = checks.filter((check: DoctorCheck) => check.status === "fail").length;
      print(
        checks,
        verbFlags.json,
        () =>
          [
            ...checks.map((check) => `${check.status === "ok" ? "ok  " : check.status === "warn" ? "warn" : "FAIL"}  ${check.id.padEnd(26)} ${check.detail}`),
            failures > 0 ? `\n${failures} check(s) failed` : "\nno failing checks (warnings above are phase-2/3 features that are not installed yet)",
          ].join("\n"),
      );
      return failures > 0 ? EXIT_ERROR : EXIT_OK;
    }

    case "config": {
      const verbFlags = parseVerbFlags(rest, flags);
      const [action = "list", key, value] = verbFlags.positional;
      const path = store.roots.config;

      if (action === "path") {
        process.stdout.write(`${path}\n`);
        return EXIT_OK;
      }
      if (action === "list") {
        process.stdout.write(`${JSON.stringify(store.config, null, 2)}\n`);
        return EXIT_OK;
      }
      if (action === "keys") {
        process.stdout.write(`${CONFIG_KEYS.join("\n")}\n`);
        return EXIT_OK;
      }
      if (action === "get") {
        if (!key) throw new UsageError("config get needs a key");
        const current = store.config as unknown as Record<string, unknown>;
        const found = key.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), current);
        if (found === undefined) throw new UsageError(`unknown config key ${key}`);
        process.stdout.write(`${typeof found === "object" ? JSON.stringify(found) : String(found)}\n`);
        return EXIT_OK;
      }
      if (action === "set") {
        if (!key || value === undefined) throw new UsageError("config set needs a key and a value");
        const next = setConfigValue(store.config, key, value);
        saveTrashConfig(path, next);
        process.stdout.write(`${key} = ${value} (written to ${path})\n`);
        return EXIT_OK;
      }
      if (action === "unset") {
        if (!key) throw new UsageError("config unset needs a key");
        const next = unsetConfigValue(store.config, key);
        saveTrashConfig(path, next);
        process.stdout.write(`${key} reset to its default\n`);
        return EXIT_OK;
      }
      if (action === "defaults") {
        process.stdout.write(`${JSON.stringify(DEFAULT_TRASH_CONFIG, null, 2)}\n`);
        return EXIT_OK;
      }
      if (action === "refusals") {
        const records = listRefusals(store.roots.refusals, { limit: 100 });
        print(records, verbFlags.json, () => (records.length === 0 ? "no recorded refusals" : records.map((r) => `${r.at}  ${r.reason.padEnd(18)} ${r.deleted ? "DELETED " : "refused "} ${r.absoluteTarget}  ${r.detail}`).join("\n")));
        return EXIT_OK;
      }
      throw new UsageError(`unknown config action ${action}`);
    }

    case "sweep": {
      // The sweeper is an independent operation (§6): never called from `put`.
      const verbFlags = parseVerbFlags(rest, flags);
      const report = await store.sweep({ apply: verbFlags.apply });
      print(
        report,
        verbFlags.json,
        () =>
          [
            `sweep ${report.applied ? "APPLIED" : "dry run"} at ${report.ranAt} (${report.mode})`,
            `  quota       ${human(report.plan.quota.totalBytes)}/${human(report.plan.quota.maxTotalBytes)} bytes, ${report.plan.quota.entries}/${report.plan.quota.maxEntries} entries`,
            `  deletable   ${report.plan.expiredRemoteConfirmed} remote-confirmed past retention, ${report.plan.expiredLocalOnly} local-only past retention`,
            `  un-uploaded ${report.plan.unuploaded} (floor ${store.config.retention.minUnuploadedKeep})`,
            `  deleted     ${report.deleted.length}`,
            ...report.deleted.map((d) => `    ${d.id}  ${human(d.bytes)}  ${d.basis}  ${d.originalPath}`),
            `  uploaded    ${report.uploads.filter((u) => u.confirmed).length}/${report.uploads.length}`,
            ...report.uploads.map((u) => `    ${u.id}  ${u.confirmed ? "confirmed" : "not confirmed"}: ${u.detail}`),
            ...(report.blocked ? [`  BLOCKED     ${report.blocked.detail}`] : []),
            ...report.plan.notes.map((note) => `  note        ${note}`),
            ...(report.applied ? [] : ["", "  dry run — pass --apply to act (retention.requireExplicitApply is true by default)"]),
          ].join("\n"),
      );
      return EXIT_OK;
    }

    default:
      throw new UsageError(`unknown verb ${verb}`);
  }
}

/**
 * Phase-3 wiring point: the daemon supplies a remote verifier and an uploader
 * (the transport lives behind `@hasna/contracts/client`, §5). Phase 1 has
 * neither, so `trash sweep --apply` in a hosted instance reports that nothing
 * is evictable and refuses to delete — which is the correct answer, not a
 * gap to paper over.
 */
export interface CliRuntime {
  verifyRemote?: RemoteVerifier;
  upload?: RemoteUploader;
}

export function runCli(runtime: CliRuntime = {}): void {
  main(process.argv.slice(2), runtime)
    .then((code) => exit(code))
    .catch((error: unknown) => {
      if (error instanceof UsageError) {
        process.stderr.write(`trash: ${error.message}\n\n`);
        process.stdout.write(HELP);
        exit(EXIT_ERROR);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === "TrashModeConflictError") {
        process.stderr.write(`trash: ${message}\n`);
        exit(EXIT_ERROR);
      }
      process.stderr.write(`trash: ${message}\n`);
      exit(EXIT_ERROR);
    });
}

if (import.meta.main) {
  runCli();
}
