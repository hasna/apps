import { Command } from "commander";
import { OPS, coerceField, type OpDef } from "../services/registry.js";
import { buildCliContext } from "./context.js";
import { normalizeError } from "../core/errors.js";

export interface EmitOptions {
  json: () => boolean;
}

function assembleInput(op: OpDef, opts: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const f of op.fields) {
    const v = coerceField(f, opts[f.name]);
    if (v !== undefined) input[f.name] = v;
  }
  return input;
}

function emit(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value));
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

/** Build one command namespace per domain resource, generated from the registry. */
export function registerOpCommands(program: Command, emitOpts: EmitOptions): void {
  const groups = new Map<string, Command>();
  for (const op of OPS) {
    const [group, sub] = op.cli;
    if (!group || !sub) continue;
    let groupCmd = groups.get(group);
    if (!groupCmd) {
      groupCmd = program.command(group).description(`${group} operations`);
      groups.set(group, groupCmd);
    }
    const cmd = groupCmd.command(sub).description(op.description);
    for (const f of op.fields) {
      const flag = `--${f.name} <value>`;
      if (f.required) cmd.requiredOption(flag, f.description ?? f.name);
      else cmd.option(flag, f.description ?? f.name);
    }
    cmd.option("--token <token>", "Act as a scoped API credential");
    cmd.action(async (opts: Record<string, unknown>) => {
      try {
        const rc = await buildCliContext(opts["token"] as string | undefined);
        const result = await op.run(rc, assembleInput(op, opts));
        emit(result, emitOpts.json());
      } catch (error) {
        emit(normalizeError(error), emitOpts.json());
        process.exitCode = 1;
      }
    });
  }
}
