import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { childEnvironment } from "./harness-environment";
import { CommandInterrupted, Fault } from "./domain";
import type { PreparedLaunch } from "./harness-types";
import { codexCommandIndex, codexOptionTakesValue } from "./harness-arguments";
import { HarnessSettlementError, settleHarnessGroup } from "./harness-process";

type Thread = { id: string; name?: string | null; preview?: string; cwd: string };
type Page = { data: Thread[]; nextCursor: string | null };
type Query = { cursor?: string; searchTerm?: string; cwd?: string; limit: number };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const unavailable = () => new Fault(422, "codex_session_discovery", "Native Codex session discovery failed. No conversation was started. Retry discovery or provide an exact session ID.");

/** A metadata-only app-server process. Never starts/resumes a thread or sends
 * inference; every page has a finite deadline and the owned process is reaped. */
export async function listCodexSessions(prepared: PreparedLaunch, cwd: string, query: Query,
  beforeSpawn?: () => Promise<void>): Promise<Page> {
  // Every picker page starts a new native process. Revalidate after the user's
  // input, immediately before that spawn, not just before opening the picker.
  let cancelled: CommandInterrupted | undefined;
  const cancel = () => { cancelled ??= new CommandInterrupted(130, "Session discovery was cancelled; no conversation was started."); };
  const terminateAdmission = () => { cancelled ??= new CommandInterrupted(143, "Session discovery was interrupted; no conversation was started."); };
  process.on("SIGINT", cancel); process.on("SIGTERM", terminateAdmission); process.on("SIGHUP", terminateAdmission);
  try { await beforeSpawn?.(); if (cancelled) throw cancelled; }
  finally { process.off("SIGINT", cancel); process.off("SIGTERM", terminateAdmission); process.off("SIGHUP", terminateAdmission); }
  const grouped = process.platform !== "win32";
  const child = spawn(prepared.executable, [...prepared.args, "app-server"], {
    cwd, env: { ...childEnvironment(), ...prepared.env }, stdio: ["pipe", "pipe", "ignore"], detached: grouped,
  });
  let done = false, initialized = false, pending = Buffer.alloc(0), responseBytes = 0;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let resolvePage!: (page: Page) => void, rejectPage!: (error: Error) => void;
  const result = new Promise<Page>((resolve, reject) => { resolvePage = resolve; rejectPage = reject; });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  const signal = (value: NodeJS.Signals) => {
    if (!child.pid) return;
    try { if (grouped) process.kill(-child.pid, value); else child.kill(value); }
    catch { /* Disappearance is proved separately, never inferred from signalling. */ }
  };
  const exists = () => {
    if (!child.pid) return false;
    if (!grouped) return child.exitCode === null && child.signalCode === null;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  };
  const stop = () => { child.stdin.destroy(); signal("SIGTERM"); killTimer ??= setTimeout(() => signal("SIGKILL"), 2000); killTimer.unref(); };
  const fail = (error: Error = unavailable()) => { if (!done) { done = true; rejectPage(error); } stop(); };
  const interrupt = () => fail(new CommandInterrupted(130, "Session discovery was cancelled; no conversation was started."));
  const terminate = () => fail(new CommandInterrupted(143, "Session discovery was interrupted; no conversation was started."));
  process.once("SIGINT", interrupt); process.once("SIGTERM", terminate); process.once("SIGHUP", terminate);
  const timer = setTimeout(() => fail(), 10000);
  child.once("error", () => fail()); child.stdin.on("error", () => fail());
  child.once("close", () => { if (!done) fail(); });
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
  child.stdout.on("data", (chunk: Buffer) => {
    if (done) return;
    try {
      responseBytes += chunk.length;
      if (responseBytes > 16 * 1024 * 1024 || pending.length + chunk.length > 8 * 1024 * 1024) throw unavailable();
      pending = Buffer.concat([pending, chunk]);
      let end: number;
      while ((end = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, end); pending = pending.subarray(end + 1);
        if (!line.length) continue;
        const message: unknown = JSON.parse(line.toString("utf8"));
        if (!object(message)) throw unavailable();
        if (message.id === 1) {
          if (initialized || message.error || !object(message.result)) throw unavailable();
          initialized = true;
          send({ method: "initialized" });
          send({ id: 2, method: "thread/list", params: { ...query, modelProviders: [], useStateDbOnly: false, sortKey: "updated_at", sortDirection: "desc" } });
        } else if (message.id === 2) {
          const page = message.result;
          if (!initialized || message.error || !object(page) || !Array.isArray(page.data) || page.data.length > query.limit
              || !(page.nextCursor === null || typeof page.nextCursor === "string")
              || (typeof page.nextCursor === "string" && page.nextCursor.length > 4096)) throw unavailable();
          const data = page.data.map((thread: unknown): Thread => {
            if (!object(thread) || typeof thread.id !== "string" || !/^[a-f\d-]{36}$/i.test(thread.id)
                || typeof thread.cwd !== "string" || thread.cwd.length > 32768
                || (thread.name != null && typeof thread.name !== "string")
                || (thread.preview !== undefined && typeof thread.preview !== "string")) throw unavailable();
            return { id: thread.id, cwd: thread.cwd, name: thread.name as string | null | undefined, preview: thread.preview as string | undefined };
          });
          done = true; resolvePage({ data, nextCursor: page.nextCursor as string | null }); stop(); return;
        }
      }
    } catch { fail(); }
  });
  send({ id: 1, method: "initialize", params: { clientInfo: { name: "switcher_session_discovery", version: "1" }, capabilities: { experimentalApi: true } } });
  try { return await result; }
  finally {
    clearTimeout(timer); stop();
    try {
      await settleHarnessGroup({ exists, signal });
      if (killTimer) clearTimeout(killTimer);
      // Even a settled group can leave pipes held by an escaped descendant.
      // Do not hang or delete the launch files when pipe closure is uncertain.
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([closed, new Promise<never>((_, reject) => {
          closeTimer = setTimeout(() => reject(new HarnessSettlementError()), 5000);
        })]);
      } finally { if (closeTimer) clearTimeout(closeTimer); }
    } finally {
      if (killTimer) clearTimeout(killTimer);
      child.stdin.destroy(); child.stdout.destroy();
      process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); process.off("SIGHUP", terminate);
    }
  }
}

/** Switcher's picker asks the native catalog for all providers, then resumes
 * the selected exact native ID. The original transcript is never rewritten. */
export async function resolveCodexResumeArguments(prepared: PreparedLaunch, nativeArgs: string[], cwd: string,
  list: (prepared: PreparedLaunch, cwd: string, query: Query) => Promise<Page> = listCodexSessions): Promise<string[]> {
  const command = codexCommandIndex(nativeArgs);
  if (command < 0 || nativeArgs[command] !== "resume") return nativeArgs;
  let last = false, all = false, positional = false;
  let effectiveCwd = cwd;
  const remove = new Set<number>();
  for (let i = 0; i < nativeArgs.length; i++) {
    if(i===command)continue;
    if (nativeArgs[i] === "--") { positional ||= i > command && Boolean(nativeArgs[i + 1]); break; }
    if(nativeArgs[i].startsWith("--cd="))effectiveCwd=resolve(cwd,nativeArgs[i].slice(5));
    else if(nativeArgs[i].startsWith("-C")&&nativeArgs[i].length>2)effectiveCwd=resolve(cwd,nativeArgs[i].slice(2));
    if (codexOptionTakesValue(nativeArgs[i])) {
      if(nativeArgs[i]==="--cd"||nativeArgs[i]==="-C") { if(!nativeArgs[i+1])throw unavailable();effectiveCwd=resolve(cwd,nativeArgs[i+1]); }
      i++;continue;
    }
    if (["--help", "-h", "--version", "-V"].includes(nativeArgs[i])) return nativeArgs;
    if (i>command&&nativeArgs[i] === "--last") { last = true; remove.add(i); }
    if (i>command&&nativeArgs[i] === "--all") { all = true; remove.add(i); }
    if (i>command&&!nativeArgs[i].startsWith("-")) positional = true;
  }
  if (positional && !last) return nativeArgs;
  const query: Query = { limit: last ? 1 : 30, ...(all ? {} : { cwd:effectiveCwd }) };
  if (!last && (!process.stdin.isTTY || !process.stderr.isTTY))
    throw new Fault(400, "codex_session_required", "Provide an exact session ID or use resume --last in noninteractive mode.");
  const finish = (id: string) => [...nativeArgs.slice(0,command),"resume", id, ...nativeArgs.slice(command+1).filter((_arg, i) => !remove.has(i + command+1))];
  let page = await list(prepared, effectiveCwd, query);
  if (last) {
    if (!page.data[0]) throw new Fault(404, "codex_session_missing", "No Codex conversations match this workspace. Use resume --all to include other workspaces.");
    return finish(page.data[0].id);
  }
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  const controller = new AbortController();
  const cancel = () => controller.abort(new CommandInterrupted(130, "Session selection was cancelled."));
  const terminate = () => controller.abort(new CommandInterrupted(143, "Session selection was interrupted."));
  reader.on("SIGINT", cancel); reader.on("close", cancel); process.on("SIGINT", cancel); process.on("SIGTERM", terminate);
  const display = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 180);
  try {
    for (;;) {
      console.error("Codex conversations across providers:");
      page.data.forEach((thread, i) => console.error(`  ${i + 1}. ${display(thread.name ?? thread.preview ?? thread.id)} — ${display(thread.cwd)}`));
      const answer = (await reader.question("Number, search text, or n for next page (Ctrl-C cancels): ", { signal: controller.signal })
        .catch(error => { throw controller.signal.aborted ? controller.signal.reason : error; })).trim();
      if (/^[1-9]\d*$/.test(answer) && page.data[Number(answer) - 1]) return finish(page.data[Number(answer) - 1].id);
      if (answer === "n" && page.nextCursor) query.cursor = page.nextCursor;
      else { delete query.cursor; query.searchTerm = answer; }
      page = await list(prepared, effectiveCwd, query);
    }
  } finally { reader.off("SIGINT", cancel); reader.off("close", cancel); process.off("SIGINT", cancel); process.off("SIGTERM", terminate); reader.close(); }
}
