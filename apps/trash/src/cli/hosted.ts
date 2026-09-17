import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { TrashApi, TrashApiError } from "../client.js";
import { HostedOperationError, HostedTrash } from "../hosted.js";
import { ApiError, compactEntry, listSchema, parseInput } from "../api/domain.js";
import { OperationJournal } from "../journal.js";
import { runGuardAsync } from "../guard/run.js";
import { inspectCapsule, restoreCapsule } from "../capsule.js";
import { checkProtectedPath, inspectAncestors } from "../lib/inspect.js";
import { getHomeDir } from "../paths.js";

export type HostedCliInput = {
  verb: string; rest: string[]; flags: { spool?: string; files?: string; info?: string; config?: string; agent?: string; json: boolean };
  guard: { argv: string[]; allowUncaptured: boolean; rmdir: boolean } | null;
};
export type HostedCliRuntime = { api?: TrashApi; hosted?: HostedTrash; env?: NodeJS.ProcessEnv; stdout?: (text: string) => void; stderr?: (text: string) => void };
export function hostedDiagnostic(error: unknown) {
  if (error instanceof HostedOperationError) return { code: error.code, message: error.message, operationId: error.operationId, entryId: error.entryId };
  if (error instanceof TrashApiError || error instanceof ApiError) return { code: error.code, message: error.message };
  return { code: "hosted_setup_or_operation_failed", message: "Hosted Trash could not complete this operation. Check credentials, station identity and filesystem paths; inspect trash pending before retrying an interrupted deletion." };
}

/** Compact JSON is the default hosted output. Payload bytes and transfer grants never reach stdout. */
export async function runHostedCli(input: HostedCliInput, runtime: HostedCliRuntime = {}): Promise<number> {
  const env = runtime.env ?? process.env; const out = runtime.stdout ?? ((text) => process.stdout.write(text)); const err = runtime.stderr ?? ((text) => process.stderr.write(text));
  const emit = (value: unknown) => out(`${JSON.stringify(value)}\n`);
  const operationRoot = input.flags.spool ? join(resolve(input.flags.spool), "operations") : join(env.HASNA_HOME ?? join(getHomeDir(env), ".hasna"), "trash", "operations");
  let api = runtime.api; let hosted = runtime.hosted;
  const client = () => api ??= new TrashApi({ env });
  const files = () => hosted ??= new HostedTrash({ api: client(), env, operationRoot });
  try {
    if (input.flags.files || input.flags.info || input.flags.config) throw new ApiError(400, "local_flags", "Legacy files, info and config paths require explicit local mode; --spool selects hosted transaction storage.");
    if (input.verb === "guard") {
      const guard = input.guard!;
      if (guard.allowUncaptured) throw new ApiError(400, "uncaptured_forbidden", "Hosted Trash does not allow uncaptured deletion.");
      const result = await runGuardAsync({ argv: guard.argv, cwd: process.cwd(), io: { stdout: out, stderr: err }, rmdir: guard.rmdir, agent: input.flags.agent,
        capture: async (path) => {
          try { await files().put(path, { agent: input.flags.agent }); return "captured"; }
          catch (error) { err(`${JSON.stringify({ error: hostedDiagnostic(error) })}\n`); return "refused"; }
        },
      });
      return result.code;
    }
    const choices: Record<string, Record<string, { type: "string" | "boolean"; short?: string }>> = {
      put: { force: { type: "boolean", short: "f" }, recursive: { type: "boolean", short: "r" }, retention: { type: "string" }, agent: { type: "string" } },
      list: Object.fromEntries(["limit", "cursor", "station", "agent", "path", "kind", "state", "backup", "held"].map((name) => [name, { type: "string" as const }])),
      "restore-capsule": { to: { type: "string" } }, restore: { to: { type: "string" } }, recover: { to: { type: "string" } }, pending: { limit: { type: "string" } },
      retention: { days: { type: "string" } }, status: {}, doctor: {}, setup: {}, info: {}, get: {}, hold: {}, unhold: {}, pin: {}, unpin: {}, backup: {},
    };
    if (!Object.hasOwn(choices, input.verb)) throw new ApiError(400, "unsupported_command", "Use put, list, info, restore, hold, unhold, retention, backup, pending, recover, status, doctor or setup. Hosted expiration runs on the server.");
    const parsed = parseArgs({ args: input.rest, allowPositionals: true, options: { ...choices[input.verb], json: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
    const values: Record<string, string | boolean | undefined> = parsed.values;
    const positionals = parsed.positionals;
    if (values.help) { emit({ verb: input.verb, options: Object.keys(choices[input.verb]!), mode: "hosted" }); return 0; }
    const oneId = () => { if (positionals.length !== 1) throw new ApiError(400, "invalid_arguments", "Supply exactly one entry or operation ID."); return positionals[0]!; };
    const noArguments = () => { if (positionals.length) throw new ApiError(400, "invalid_arguments", "This command accepts only named options."); };
    switch (input.verb) {
      case "restore-capsule": {
        const capsule = resolve(oneId());
        if (typeof values.to !== "string" || !values.to || values.to.includes("\0")) throw new ApiError(400, "destination_required", "Capsule recovery requires --to PATH.");
        const target = resolve(values.to);
        if (checkProtectedPath(target, { home: getHomeDir(env), extraRoots: [operationRoot] }) || inspectAncestors(target).length || target.split("/").some((part) => /^\.hasna-trash-[a-f0-9-]{36}$/.test(part))) throw new ApiError(400, "protected_destination", "Refusing an unsafe recovery destination.");
        const restored = inspectCapsule(capsule);
        restoreCapsule(capsule, target, restored);
        emit({ restoredTo: target, kind: restored.kind, bytes: restored.sizeBytes, sha256: restored.sha256 }); return 0;
      }
      case "pending": noArguments(); emit({ items: new OperationJournal(operationRoot).pending(values.limit === undefined ? 20 : Number(values.limit)) }); return 0;
      case "setup": noArguments(); emit({ station: await files().setup(), mode: "hosted" }); return 0;
      case "status": noArguments(); emit({ ...await client().status(), mode: "hosted" }); return 0;
      case "doctor": noArguments(); emit({ ...await client().status(), mode: "hosted", pending: new OperationJournal(operationRoot).pending() }); return 0;
      case "list": {
        noArguments(); const { json: _json, help: _help, ...query } = values;
        if (input.flags.agent && query.agent === undefined) query.agent = input.flags.agent;
        emit(await client().list(parseInput(listSchema, query))); return 0;
      }
      case "info": case "get": emit(await client().get(oneId())); return 0;
      case "put": {
        if (!positionals.length) throw new ApiError(400, "invalid_arguments", "Put needs at least one path.");
        const retentionDays = values.retention === undefined ? undefined : values.retention === "never" ? null : Number(values.retention);
        const results: unknown[] = []; let refused = false;
        for (const path of positionals) {
          try {
            const entry = await files().put(path, { retentionDays, agent: typeof values.agent === "string" ? values.agent : input.flags.agent });
            results.push(compactEntry(entry));
          } catch (error) { results.push({ path, error: hostedDiagnostic(error) }); refused = true; }
        }
        emit(results); return refused ? 2 : 0;
      }
      case "restore": {
        const result = await files().restore(oneId(), { to: typeof values.to === "string" ? values.to : undefined });
        emit({ ...compactEntry(result.entry), restoredTo: result.path }); return 0;
      }
      case "recover": {
        const result = await files().recover(oneId(), { to: typeof values.to === "string" ? values.to : undefined });
        emit("entry" in result ? { ...compactEntry(result.entry), restoredTo: result.path, preservedPaths: result.preservedPaths } : compactEntry(result)); return 0;
      }
      default: {
        const entry = await client().get(oneId()); let result;
        if (["hold", "pin", "unhold", "unpin"].includes(input.verb)) result = await client().hold(entry.id, entry.version, ["hold", "pin"].includes(input.verb));
        else if (input.verb === "backup") result = await client().backup(entry.id, entry.version);
        else {
          if (values.days === undefined) throw new ApiError(400, "invalid_arguments", "Retention requires --days <1–3650|never>.");
          result = await client().retention(entry.id, entry.version, values.days === "never" ? null : Number(values.days));
        }
        emit(compactEntry(result)); return 0;
      }
    }
  } catch (error) { err(`${JSON.stringify({ error: hostedDiagnostic(error) })}\n`); return input.verb === "guard" ? 2 : 1; }
}
