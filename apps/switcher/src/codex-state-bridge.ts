import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { once } from "node:events";
import { codexConfigRoots } from "./harness-arguments";

const MAX_FRAME = 8 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
export type CodexStateRouting = { model: string; config: ObjectValue };

/** Supported native RPC only: catalog read-repair and current launch routing.
 * Thread IDs, histories, tool calls, permissions and response bytes are intact. */
export function rewriteCodexStateRequest(line: Buffer, routing: CodexStateRouting): Buffer {
  if (line.length > MAX_FRAME) throw new Error("codex_state_frame_limit");
  const request: unknown = JSON.parse(line.toString("utf8"));
  if (!object(request)) throw new Error("codex_state_protocol");
  if (!Object.hasOwn(request, "id") || !["thread/list", "thread/start", "thread/resume", "thread/fork"].includes(String(request.method))) return line;
  if (request.params != null && !object(request.params)) throw new Error("codex_state_protocol");
  const params = (request.params ?? {}) as ObjectValue;
  if (request.method === "thread/list") {
    request.params = { ...params, modelProviders: [], useStateDbOnly: false };
  } else {
    if (params.config != null && !object(params.config)) throw new Error("codex_state_protocol");
    const owned = new Set(["model", "model_provider", "model_providers", "model_catalog_json", "review_model", "agents", "memories", "sqlite_home"]);
    const retained: ObjectValue = {};
    for(const [key,value] of Object.entries(params.config ?? {})) {
      const roots=codexConfigRoots(key);
      if(roots.some(root=>["profile","profiles","include"].includes(root)))throw new Error("codex_state_profile_override");
      if(!roots.some(root=>owned.has(root)))retained[key]=value;
    }
    request.params = { ...params, modelProvider: "switcher", model: routing.model,
      ...(request.method === "thread/start" ? { allowProviderModelFallback: false } : {}),
      config: { ...retained, ...routing.config } };
  }
  return Buffer.from(JSON.stringify(request));
}

export function codexStateRequestStream(routing: CodexStateRouting): Transform {
  let pending = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const joined = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let start = 0, end: number;
        while ((end = joined.indexOf(10, start)) >= 0) {
          const line = joined.subarray(start, end);
          if (line.length) this.push(Buffer.concat([rewriteCodexStateRequest(line, routing), Buffer.from("\n")]));
          start = end + 1;
        }
        pending = Buffer.from(joined.subarray(start));
        if (pending.length > MAX_FRAME) throw new Error("codex_state_frame_limit");
        callback();
      } catch { callback(new Error("codex_state_protocol")); }
    },
    flush(callback) { callback(pending.length ? new Error("codex_state_truncated_frame") : undefined); },
  });
}

/** The native app-server owns inference and state. This process only adapts
 * requests over its supported stdio API, with no retry or conversation replay. */
export async function runCodexStateBridge(executable: string, args: string[], routing: CodexStateRouting): Promise<number> {
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "inherit"] });
  const requests = codexStateRequestStream(routing);
  let stopping = false, failed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopping) return; stopping = true;
    child.stdin.destroy(); child.kill("SIGTERM");
    timer = setTimeout(() => child.kill("SIGKILL"), 5000); timer.unref();
  };
  const fail = () => { failed = true; stop(); };
  child.on("error", fail); child.stdin.on("error", fail); requests.on("error", fail);
  process.stdout.on("error", fail);
  process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
  const endInput = () => { timer ??= setTimeout(stop, 5000); timer.unref(); };
  process.stdin.once("end", endInput);
  process.stdin.pipe(requests).pipe(child.stdin); child.stdout.pipe(process.stdout, { end: false });
  try {
    const [code] = await once(child, "close");
    return failed ? 1 : typeof code === "number" ? code : 1;
  } catch { return 1; }
  finally {
    if (timer) clearTimeout(timer);
    process.stdin.unpipe(requests); requests.destroy(); child.stdout.unpipe(process.stdout);
    process.stdin.pause();
    process.stdin.off("end", endInput); process.stdout.off("error", fail);
    process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop);
  }
}

if (import.meta.main) {
  try {
    const [executable, model, config, ...args] = process.argv.slice(2);
    const parsed: unknown = JSON.parse(config);
    if (!executable?.startsWith("/") || !model || !object(parsed) || args[0] !== "app-server") throw new Error();
    process.exitCode = await runCodexStateBridge(executable, args, { model, config: parsed });
  } catch { console.error("Switcher native session bridge failed."); process.exitCode = 1; }
}
