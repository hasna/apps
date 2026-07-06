import { Command } from "commander";
import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import { OP_REGISTRY, invokeOp, type OpDef } from "../services/registry.js";
import { SCHEMAS } from "../mcp/tools/domain.js";
import { toErrorEnvelope, errorStatus } from "../types/index.js";
import { buildCliContext } from "./context.js";

// One command namespace per domain resource, generated from the op registry so
// the CLI stays at parity with MCP + /v1. Each command dispatches through the
// shared service layer (invokeOp).

interface FieldSpec {
  key: string;
  flag: string;
  isNumber: boolean;
  required: boolean;
  choices?: string[];
}

function camelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function unwrap(zt: ZodTypeAny): { base: ZodTypeAny; optional: boolean } {
  const optional = zt.isOptional();
  let current = zt;
  // Peel ZodOptional / ZodNullable / ZodDefault layers to reach the base type.
  for (let i = 0; i < 5; i += 1) {
    const typeName = (current._def as { typeName?: string }).typeName;
    if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault") {
      const inner = (current._def as { innerType?: ZodTypeAny }).innerType;
      if (!inner) break;
      current = inner;
    } else {
      break;
    }
  }
  return { base: current, optional };
}

function fieldsFor(shape: ZodRawShape): FieldSpec[] {
  const fields: FieldSpec[] = [];
  for (const [key, zt] of Object.entries(shape)) {
    const { base, optional } = unwrap(zt as ZodTypeAny);
    const typeName = (base._def as { typeName?: string }).typeName;
    const isNumber = typeName === "ZodNumber";
    const choices = typeName === "ZodEnum" ? ((base._def as { values?: string[] }).values ?? undefined) : undefined;
    const flagName = key.replace(/_/g, "-");
    fields.push({
      key,
      flag: `--${flagName} <value>`,
      isNumber,
      required: !optional,
      ...(choices ? { choices } : {}),
    });
  }
  return fields;
}

function buildInput(def: OpDef, opts: Record<string, unknown>): Record<string, unknown> {
  const shape = SCHEMAS[def.mcpTool] ?? {};
  const input: Record<string, unknown> = {};
  for (const field of fieldsFor(shape)) {
    const value = opts[camelCase(field.key)];
    if (value === undefined) continue;
    input[field.key] = field.isNumber ? Number(value) : value;
  }
  return input;
}

function emit(json: boolean, value: unknown): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function emitError(json: boolean, error: unknown): never {
  const envelope = toErrorEnvelope(error);
  const status = errorStatus(error);
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...envelope, error: envelope.message })}\n`);
  } else {
    process.stderr.write(`Error [${envelope.code}]: ${envelope.message}\n${envelope.suggestion}\n`);
  }
  process.exitCode = status >= 500 ? 1 : 2;
  process.exit(process.exitCode);
}

/** Build all resource command namespaces onto the program. jsonFlag() returns global --json. */
export function registerNamespaces(program: Command, jsonFlag: () => boolean): void {
  const namespaces = new Map<string, Command>();

  for (const def of OP_REGISTRY) {
    const [ns, cmd] = def.cli;
    let parent = namespaces.get(ns);
    if (!parent) {
      parent = program.command(ns).description(`${ns} operations`);
      namespaces.set(ns, parent);
    }
    const sub = parent.command(cmd).description(`${def.op}${def.mutates ? " (write)" : ""}`);
    for (const field of fieldsFor(SCHEMAS[def.mcpTool] ?? {})) {
      const desc = field.choices ? `one of: ${field.choices.join(", ")}` : field.required ? "(required)" : "(optional)";
      sub.option(field.flag, desc);
    }
    sub.action((opts: Record<string, unknown>) => {
      const json = jsonFlag();
      const ctx = buildCliContext(json);
      try {
        const result = invokeOp(ctx.service, def.op, buildInput(def, opts));
        emit(json, result);
      } catch (error) {
        emitError(json, error);
      }
    });
  }
}

export { z };
