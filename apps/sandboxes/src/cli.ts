#!/usr/bin/env bun
/**
 * sandboxes CLI — a thin /v1 API client (NOT a local database tool). It routes
 * every mutating/reading command to https://<host>/v1 using
 * HASNA_SANDBOXES_API_URL + HASNA_SANDBOXES_API_KEY. There is no local SQLite
 * path — the fleet reads/writes the shared self-hosted service.
 */
import { nowRfc3339 } from "./canonical.js";
import { SandboxError } from "./errors.js";
import { SCHEMA_VERSION } from "./types.js";
import { SandboxesClient, SandboxesApiError } from "./sdk.js";

const VERSION = "1.0.0-rc.1";

interface Envelope {
  schema_version: typeof SCHEMA_VERSION;
  ok: boolean;
  request_id: string;
  operation: string;
  server_time: string;
  data?: unknown;
  error?: { code: string; message: string; details: Readonly<Record<string, string | number | boolean>> };
  warnings: string[];
  next_actions: Array<{ action: string }>;
}

function requestId(): string {
  return `request_${crypto.randomUUID().replaceAll("-", "")}`;
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

function failure(operation: string, code: string, message: string, details: Record<string, string | number | boolean> = {}): Envelope {
  return {
    schema_version: SCHEMA_VERSION,
    ok: false,
    request_id: requestId(),
    operation,
    server_time: nowRfc3339(),
    error: { code, message, details },
    warnings: [],
    next_actions: [],
  };
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

function output(envelope: Envelope, mode: string): void {
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }
  if (!envelope.ok) {
    process.stderr.write(`${envelope.error?.code ?? "internal_failure"}: ${envelope.error?.message ?? "failed"}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(envelope.data, null, 2)}\n`);
}

async function stdinJson(args: string[]): Promise<unknown> {
  const input = option(args, "--input");
  if (input !== "-") {
    throw new SandboxError("validation_failed", "Structured input must use the supervisor-owned stdin pipe (--input -)");
  }
  const text = await Bun.stdin.text();
  if (text.length > 1_048_576) throw new SandboxError("resource_limit_exceeded", "Structured input exceeds the one MiB limit");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SandboxError("validation_failed", "stdin is not valid JSON");
  }
}

function usage(): string {
  return [
    "sandboxes version|health|whoami|doctor|status",
    "sandboxes validate KIND --input -",
    "sandboxes adapter list",
    "sandboxes sandbox create --adapter fake|e2b|daytona_cloud --input -   (stdin = spec, or {adapter,spec})",
    "sandboxes sandbox get ID | list | destroy ID",
    "sandboxes checkpoint create ID [--label L] --input - | list ID | get CHECKPOINT_ID",
    "sandboxes admin tenant create --input - | quota set --input - | key mint --input - | key revoke KID",
    "",
    "Config: HASNA_SANDBOXES_API_URL + HASNA_SANDBOXES_API_KEY (Bearer).",
  ].join("\n");
}

async function run(argv: string[]): Promise<{ envelope: Envelope; exitCode: number }> {
  const args = [...argv];
  const mode = option(args, "--output") ?? "human";
  if (mode !== "human" && mode !== "json") {
    return { envelope: failure("help", "validation_failed", "--output must be human or json"), exitCode: 2 };
  }
  const group = args.shift();
  const command = args.shift();
  const operation = [group, command].filter(Boolean).join(".") || "help";

  const client = new SandboxesClient();

  try {
    if (group === undefined || group === "help" || group === "--help" || group === "-h") {
      return { envelope: success("help", { usage: usage() }), exitCode: 0 };
    }
    if (group === "version") {
      return { envelope: success("version", { package: "@hasnaxyz/sandboxes", version: VERSION }), exitCode: 0 };
    }
    if (group === "health") {
      return { envelope: success("health", await client.health()), exitCode: 0 };
    }
    if (group === "whoami") {
      return { envelope: success("whoami", await client.whoami()), exitCode: 0 };
    }
    if (group === "doctor" || group === "status") {
      return { envelope: success(group, await client.v1Health()), exitCode: 0 };
    }
    if (group === "validate") {
      if (command === undefined) throw new SandboxError("validation_failed", "validate requires a document kind");
      const document = await stdinJson(args);
      return { envelope: success(`validate.${command}`, await client.validate(command, document)), exitCode: 0 };
    }
    if (group === "adapter" && command === "list") {
      return { envelope: success("adapter.list", await client.listAdapters()), exitCode: 0 };
    }
    if (group === "sandbox") {
      if (command === "create") {
        const adapterOpt = option(args, "--adapter");
        const raw = await stdinJson(args);
        const asObj = raw as Record<string, unknown>;
        const adapter = (adapterOpt ?? asObj["adapter"]) as "fake" | "e2b" | "daytona_cloud" | undefined;
        if (!adapter) throw new SandboxError("validation_failed", "adapter is required (--adapter or stdin.adapter)");
        const spec = (asObj["spec"] ?? raw) as never;
        return { envelope: success("sandbox.create", await client.allocate({ adapter, spec })), exitCode: 0 };
      }
      if (command === "list") {
        return { envelope: success("sandbox.list", await client.listSandboxes()), exitCode: 0 };
      }
      if (command === "get") {
        const id = args.shift();
        if (!id) throw new SandboxError("validation_failed", "sandbox get requires an ID");
        return { envelope: success("sandbox.get", await client.getSandbox(id)), exitCode: 0 };
      }
      if (command === "destroy") {
        const id = args.shift();
        if (!id) throw new SandboxError("validation_failed", "sandbox destroy requires an ID");
        return { envelope: success("sandbox.destroy", await client.destroySandbox(id)), exitCode: 0 };
      }
      throw new SandboxError("validation_failed", "Unknown sandbox command");
    }
    if (group === "checkpoint") {
      if (command === "create") {
        const id = args.shift();
        if (!id) throw new SandboxError("validation_failed", "checkpoint create requires a sandbox ID");
        const label = option(args, "--label");
        const body: { label?: string; payload_base64?: string } = {};
        if (label) body.label = label;
        if (args.includes("--input")) {
          const raw = (await stdinJson(args)) as Record<string, unknown>;
          if (typeof raw["payload_base64"] === "string") body.payload_base64 = raw["payload_base64"];
          if (typeof raw["label"] === "string" && !label) body.label = raw["label"];
        }
        return { envelope: success("checkpoint.create", await client.createCheckpoint(id, body)), exitCode: 0 };
      }
      if (command === "list") {
        const id = args.shift();
        if (!id) throw new SandboxError("validation_failed", "checkpoint list requires a sandbox ID");
        return { envelope: success("checkpoint.list", await client.listCheckpoints(id)), exitCode: 0 };
      }
      if (command === "get") {
        const id = args.shift();
        if (!id) throw new SandboxError("validation_failed", "checkpoint get requires a checkpoint ID");
        return { envelope: success("checkpoint.get", await client.getCheckpoint(id)), exitCode: 0 };
      }
      throw new SandboxError("validation_failed", "Unknown checkpoint command");
    }
    if (group === "admin") {
      const raw = args.includes("--input") ? ((await stdinJson(args)) as Record<string, unknown>) : {};
      if (command === "tenant" && args[0] === "create") {
        return { envelope: success("admin.tenant.create", await client.createTenant(raw)), exitCode: 0 };
      }
      if (command === "quota" && args[0] === "set") {
        return { envelope: success("admin.quota.set", await client.setQuota(raw as never)), exitCode: 0 };
      }
      if (command === "key" && args[0] === "mint") {
        return { envelope: success("admin.key.mint", await client.mintApiKey(raw)), exitCode: 0 };
      }
      if (command === "key" && args[0] === "revoke") {
        const kid = args[1];
        if (!kid) throw new SandboxError("validation_failed", "key revoke requires a KID");
        return { envelope: success("admin.key.revoke", await client.revokeApiKey(kid)), exitCode: 0 };
      }
      throw new SandboxError("validation_failed", "Unknown admin command");
    }
    throw new SandboxError("validation_failed", "Unknown command");
  } catch (error) {
    if (error instanceof SandboxesApiError) {
      return { envelope: failure(operation, error.code, error.message, error.details), exitCode: 1 };
    }
    if (error instanceof SandboxError) {
      return { envelope: failure(operation, error.code, error.message, error.details), exitCode: 2 };
    }
    return { envelope: failure(operation, "internal_failure", "The command failed"), exitCode: 14 };
  }
}

if (import.meta.main) {
  const modeArgIndex = process.argv.indexOf("--output");
  const outputMode = modeArgIndex >= 0 ? process.argv[modeArgIndex + 1] ?? "human" : "human";
  run(process.argv.slice(2))
    .then(({ envelope, exitCode }) => {
      output(envelope, outputMode);
      process.exitCode = exitCode;
    })
    .catch(() => {
      output(failure("startup", "internal_failure", "The command failed to start"), outputMode);
      process.exitCode = 14;
    });
}

export { run };
