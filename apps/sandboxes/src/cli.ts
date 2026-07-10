#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalDigest, canonicalJson, nowRfc3339 } from "./canonical.js";
import { SandboxError, asSandboxError, exitCodeFor } from "./errors.js";
import { SqliteSandboxRepositoryV1 } from "./repository-sqlite.js";
import { E2BRunnerPendingV1, DaytonaCloudRunnerPendingV1 } from "./runner.js";
import { SCHEMA_VERSION } from "./types.js";
import { validateDocument, type ValidationKind } from "./validation.js";

const VERSION = "1.0.0";

interface Envelope {
  schema_version: typeof SCHEMA_VERSION;
  ok: boolean;
  request_id: string;
  operation: string;
  server_time: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details: Readonly<Record<string, string | number | boolean>>;
  };
  warnings: string[];
  next_actions: Array<{ action: string }>;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new SandboxError("validation_failed", `${name} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function flag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function requestId(): string {
  return `request_${crypto.randomUUID().replaceAll("-", "")}`;
}

function output(envelope: Envelope, mode: string): void {
  if (mode === "json") {
    process.stdout.write(`${canonicalJson(envelope)}\n`);
    return;
  }
  if (!envelope.ok) {
    process.stderr.write(`${envelope.error?.code ?? "internal_failure"}: ${envelope.error?.message ?? "failed"}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(envelope.data, null, 2)}\n`);
}

function success(operation: string, data: unknown): Envelope {
  return {
    schema_version: SCHEMA_VERSION,
    ok: true,
    request_id: requestId(),
    operation,
    server_time: nowRfc3339(),
    data,
    warnings: [],
    next_actions: [],
  };
}

function failure(operation: string, error: SandboxError): Envelope {
  return {
    schema_version: SCHEMA_VERSION,
    ok: false,
    request_id: requestId(),
    operation,
    server_time: nowRfc3339(),
    error: { code: error.code, message: error.message, details: error.details },
    warnings: [],
    next_actions: [],
  };
}

function usage(): string {
  return [
    "sandboxes version|doctor|status|migrate",
    "sandboxes validate TYPE --input -",
    "sandboxes sandbox create|activate|get|list|expire|destroy",
    "sandboxes operation resolve OPERATION_ID",
    "sandboxes adapter list|doctor",
    "",
    "Lifecycle mutations require a protected Infinity integration and fail closed standalone.",
  ].join("\n");
}

async function stdinJson(args: string[]): Promise<unknown> {
  const input = option(args, "--input");
  if (input !== "-") {
    throw new SandboxError("validation_failed", "Structured input must use the supervisor-owned stdin pipe (--input -)");
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = Bun.stdin.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 1_048_576) {
        throw new SandboxError("resource_limit_exceeded", "Structured input exceeds the one MiB limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SandboxError("validation_failed", "stdin is not valid JSON");
  }
}

function openRepository(databasePath: string): SqliteSandboxRepositoryV1 {
  const repository = new SqliteSandboxRepositoryV1(databasePath);
  repository.migrate();
  return repository;
}

async function run(argv: string[]): Promise<{ envelope: Envelope; exitCode: number }> {
  const args = [...argv];
  const mode = option(args, "--output") ?? "human";
  if (mode !== "human" && mode !== "json") {
    throw new SandboxError("validation_failed", "--output must be human or json");
  }
  if (args.includes("--database")) {
    throw new SandboxError(
      "validation_failed",
      "The CLI never accepts a caller-selected database or host path",
    );
  }
  const databasePath = join(homedir(), ".hasna", "sandboxes", "sandboxes.db");
  flag(args, "--no-color");
  const group = args.shift();
  const command = args.shift();
  const operation = [group, command].filter(Boolean).join(".") || "help";

  try {
    if (group === undefined || group === "help" || group === "--help" || group === "-h") {
      return { envelope: success("help", { usage: usage() }), exitCode: 0 };
    }
    if (group === "version") {
      if (command !== undefined || args.length !== 0) throw new SandboxError("validation_failed", "version takes no arguments");
      return { envelope: success("version", { package: "@hasna/sandboxes", version: VERSION }), exitCode: 0 };
    }
    if (group === "validate") {
      if (command === undefined || args.length === 0) {
        throw new SandboxError("validation_failed", "validate requires a document type and --input -");
      }
      const kinds: ValidationKind[] = [
        "sandbox-spec",
        "create-sandbox",
        "fence",
        "capability",
        "activation-grant",
        "cleanup-grant",
        "checkpoint-receipt",
      ];
      if (!kinds.includes(command as ValidationKind)) {
        throw new SandboxError("validation_failed", "Unknown validation document type");
      }
      const value = await stdinJson(args);
      if (args.length !== 0) throw new SandboxError("validation_failed", "Unexpected arguments");
      const validated = validateDocument(command as ValidationKind, value);
      return { envelope: success(`validate.${command}`, { valid: true, document_sha256: canonicalDigest(validated) }), exitCode: 0 };
    }
    if (group === "doctor" || group === "status" || group === "migrate") {
      if (command !== undefined || args.length !== 0) throw new SandboxError("validation_failed", `${group} takes no arguments`);
      const repository = openRepository(databasePath);
      try {
        const health = await repository.health();
        return {
          envelope: success(group, {
            deployment_mode: "local",
            health,
            authority_verifier: "not_configured",
            live_effects: "disabled",
          }),
          exitCode: 0,
        };
      } finally {
        await repository.close();
      }
    }
    if (group === "adapter") {
      if (command !== "list" && command !== "doctor") {
        throw new SandboxError("validation_failed", "adapter supports list or doctor");
      }
      if (args.length !== 0) throw new SandboxError("validation_failed", "Unexpected arguments");
      const descriptors = await Promise.all([
        new E2BRunnerPendingV1().descriptor(),
        new DaytonaCloudRunnerPendingV1().descriptor(),
      ]);
      return { envelope: success(operation, { adapters: descriptors, admitted_count: 0 }), exitCode: 0 };
    }
    if (group === "sandbox") {
      if (command === "get") {
        const id = args.shift();
        if (id === undefined || args.length !== 0) throw new SandboxError("validation_failed", "sandbox get requires one full ID");
        if (!/^sbx_[0-9a-f]{32}$/.test(id)) throw new SandboxError("validation_failed", "Sandbox ID must be exact and full");
        throw new SandboxError(
          "capability_denied",
          "Standalone reads require a configured authenticated Infinity read capability",
        );
      }
      if (command === "list") {
        if (args.length !== 0) throw new SandboxError("validation_failed", "sandbox list takes no arguments");
        throw new SandboxError(
          "capability_denied",
          "Standalone reads require a configured authenticated Infinity read capability",
        );
      }
      if (["create", "activate", "expire", "destroy"].includes(command ?? "")) {
        if (command === "create") {
          const value = await stdinJson(args);
          validateDocument("create-sandbox", value);
        }
        throw new SandboxError(
          "capability_denied",
          "Standalone lifecycle mutation is disabled: invoke through a configured Infinity capability provider",
        );
      }
      throw new SandboxError("validation_failed", "Unknown sandbox command");
    }
    if (group === "operation" && command === "resolve") {
      const id = args.shift();
      if (id === undefined || args.length !== 0) {
        throw new SandboxError("validation_failed", "operation resolve requires one exact opaque operation ID");
      }
      if (!/^op_[0-9a-f]{32}$/.test(id)) throw new SandboxError("validation_failed", "Operation ID must be exact and full");
      throw new SandboxError(
        "capability_denied",
        "Operation resolution requires a configured authenticated Infinity read capability",
      );
    }
    throw new SandboxError("validation_failed", "Unknown command");
  } catch (error) {
    const safe = asSandboxError(error);
    return { envelope: failure(operation, safe), exitCode: exitCodeFor(safe) };
  }
}

const modeArgIndex = process.argv.indexOf("--output");
const outputMode = modeArgIndex >= 0 ? process.argv[modeArgIndex + 1] ?? "human" : "human";
run(process.argv.slice(2))
  .then(({ envelope, exitCode }) => {
    output(envelope, outputMode);
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const safe = asSandboxError(error);
    output(failure("startup", safe), outputMode);
    process.exitCode = exitCodeFor(safe);
  });
