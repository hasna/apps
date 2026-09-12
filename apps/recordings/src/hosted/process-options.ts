import { HostedRecordingsClient } from "./index.js";
import { RecordingsSDKError } from "./transport.js";

export interface HostedProcessOptions { apiBase: string; credentialEnv?: string; host?: string; port?: number; allowWrites?: boolean }
/** Explicit named input, not an ambient credential resolution chain. */
export function hostedProcessClient(options: HostedProcessOptions, env: Record<string, string | undefined> = process.env, fetch?: typeof globalThis.fetch) {
  if (!options.credentialEnv || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(options.credentialEnv)) {
    throw new RecordingsSDKError("invalid_configuration");
  }
  const name = options.credentialEnv;
  return new HostedRecordingsClient({ apiBase: options.apiBase, fetch, credentialProvider: () => {
    const value = env[name];
    if (!value) throw new RecordingsSDKError("credential_unavailable");
    return value;
  } });
}

/** Hosted mode deliberately accepts no legacy modes, token values or arbitrary headers. */
export function parseHostedProcessOptions(args: string[], surface: "mcp" | "serve"): HostedProcessOptions {
  const values: Record<string, string> = {};
  const booleans = new Set<string>();
  const allowed = surface === "mcp" ? ["--api-base", "--credential-env"] : ["--api-base", "--host", "--port"];
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (key === "--hosted" || key === "--allow-writes" || (surface === "mcp" && key === "--stdio")) {
      if (booleans.has(key)) throw new RecordingsSDKError("invalid_configuration");
      booleans.add(key); continue;
    }
    if (!allowed.includes(key) || Object.hasOwn(values, key) || !args[index + 1] || args[index + 1]!.startsWith("--")) {
      throw new RecordingsSDKError("invalid_configuration");
    }
    values[key] = args[++index]!;
  }
  if (!booleans.has("--hosted") || !values["--api-base"] || (surface === "mcp" && !booleans.has("--stdio"))) {
    throw new RecordingsSDKError("invalid_configuration");
  }
  // Validate the complete authority before any credential lookup or listener.
  const apiBase = new HostedRecordingsClient({ apiBase: values["--api-base"] }).apiBase;
  const writes = booleans.has("--allow-writes") ? { allowWrites: true } : {};
  if (surface === "mcp") {
    const options = { apiBase, credentialEnv: values["--credential-env"], ...writes };
    hostedProcessClient(options, {}); return options;
  }
  const host = values["--host"] ?? "127.0.0.1", rawPort = values["--port"] ?? "8874";
  if (!["127.0.0.1", "::1"].includes(host) || !/^[0-9]{1,5}$/.test(rawPort) || Number(rawPort) > 65535) {
    throw new RecordingsSDKError("invalid_configuration");
  }
  return { apiBase, host, port: Number(rawPort), ...writes };
}

export function hostedFailure(error: unknown) {
  const safe = error instanceof RecordingsSDKError ? error : new RecordingsSDKError("invalid_input");
  return { error: { code: safe.code, message: safe.message } };
}
