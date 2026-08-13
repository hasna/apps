import type { Command } from "commander";
import { kebab } from "../services/cli-args.js";
import { executeOp } from "../services/execute.js";
import { OPS } from "../services/registry.js";
import type { OpDef } from "../services/op-types.js";
import { toStructuredError } from "../types/index.js";
import { buildCliPrincipal, camelToSnake } from "./context.js";

// Generate one CLI command per registry op (grouped into resource namespaces),
// all routing through executeOp — the same service path as MCP + /v1.

function shapeKeys(op: OpDef): string[] {
  return Object.keys((op.input as { shape?: Record<string, unknown> }).shape ?? {});
}

function isPositionalId(op: OpDef): boolean {
  const keys = shapeKeys(op);
  return keys.length === 1 && keys[0] === "id";
}

export function registerNamespaces(program: Command, emit: (value: unknown) => void): void {
  const groups = new Map<string, Command>();
  const getGroup = (name: string): Command => {
    let group = groups.get(name);
    if (!group) {
      group = program.command(name).description(`${name} operations`);
      groups.set(name, group);
    }
    return group;
  };

  for (const op of OPS) {
    const [namespace, commandName] = op.cli.path;
    const group = getGroup(namespace as string);
    const positional = isPositionalId(op);
    const cmd = group.command(`${commandName}${positional ? " <id>" : ""}`).description(op.summary);
    cmd.option("--token <token>", "Scoped API token (defaults to local SYSTEM)");
    if (!positional) {
      for (const key of shapeKeys(op)) {
        cmd.option(`--${kebab(key)} <value>`, key);
      }
    }
    cmd.action(async (...args: unknown[]) => {
      const command = args[args.length - 1] as Command;
      const opts = command.opts() as Record<string, unknown>;
      const input: Record<string, unknown> = {};
      if (positional) {
        input.id = args[0];
      } else {
        for (const [key, value] of Object.entries(opts)) {
          if (key === "token" || value === undefined) continue;
          input[camelToSnake(key)] = value;
        }
      }
      try {
        const principal = buildCliPrincipal(opts.token as string | undefined);
        emit(await executeOp(op, principal, input));
      } catch (error) {
        emit(toStructuredError(error));
        process.exitCode = 1;
      }
    });
  }
}
