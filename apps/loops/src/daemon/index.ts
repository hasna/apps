#!/usr/bin/env bun
import { Command } from "commander";
import { runDaemon, startDaemon } from "./daemon.js";
import { daemonStatus, stopDaemon } from "./control.js";
import { installStartup } from "./install.js";
import { Store, refuseLocalStore } from "../lib/store.js";
import { packageVersion } from "../lib/version.js";
import { noticeLocalLoopsMode, resolveCloudStorage } from "../lib/cloud/resolve.js";
import {
  LOOPS_LOCAL_OPT_IN_HINT,
  REMOTE_COMMAND_UNSUPPORTED,
  hasRetiredLoopsConnectionSwitch,
  selectsLoopsLocalStore,
} from "../lib/local-opt-in.js";

export const LOOPS_DAEMON_REFUSAL_PREFIX = "loops-daemon: refusing to start —";

/**
 * The fail-closed startup gate for `loops-daemon` (owner ruling 2026-09-07,
 * hasna/apps#1720). The daemon is the ON-BOX scheduler: it polls this
 * machine's SQLite store for due loops, so it has exactly one legitimate
 * route — the explicit `HASNA_LOOPS_LOCAL=1` opt-in, answered from the
 * environment before any Keychain or disk read and honoured only when the
 * environment configures no loops authority. On every other route it refuses
 * BEFORE touching the data dir: with a hosted credential resolvable the
 * on-box store is `REMOTE_COMMAND_UNSUPPORTED` (the hosted scheduler is
 * `loops-runner`), and with nothing configured the resolver's own one-line
 * refusal names the tiers and the opt-in — never a value, never a local
 * default. On 0.7.0 every subcommand opened (and created)
 * `~/.hasna/loops/loops.db` with no credential check at all.
 */
export function resolveLoopsDaemonStartupGate(env: Record<string, string | undefined> = process.env):
  | { ok: true }
  | { ok: false; message: string } {
  let issue: string;
  try {
    if (selectsLoopsLocalStore(env) && !hasRetiredLoopsConnectionSwitch(env)) return { ok: true };
    // Not the opt-in: run the same chain the CLI uses so the refusal names
    // the tier that decided (nothing configured, a retired switch, a
    // terminal credential failure) — or, when a credential DID resolve, say
    // plainly that the on-box scheduler is not a hosted-route surface.
    resolveCloudStorage("loops", env);
    issue =
      `${REMOTE_COMMAND_UNSUPPORTED}: a loops credential resolved, so this process is on the hosted route and ` +
      `loops-daemon (the on-box SQLite scheduler) must not open this machine's store. The hosted scheduler is ` +
      `loops-runner. To run the on-box scheduler set ${LOOPS_LOCAL_OPT_IN_HINT} in an environment that configures ` +
      `no loops authority.`;
  } catch (error) {
    issue = error instanceof Error ? error.message : String(error);
  }
  return { ok: false, message: `${LOOPS_DAEMON_REFUSAL_PREFIX} ${issue.replace(/\s*\n\s*/g, " ")}` };
}

const program = new Command();

program.name("loops-daemon").description("Loops daemon helper (on-box scheduler; requires HASNA_LOOPS_LOCAL=1)").version(packageVersion());

program
  .command("run")
  .option("--interval-ms <ms>", "tick interval", (value) => Number(value))
  .option("--concurrency <n>", "legacy total knob; sets the agent/workflow lane budget", (value) => Number(value))
  .option("--command-concurrency <n>", "claim budget for command-target loops (default 4)", (value) => Number(value))
  .option("--agent-concurrency <n>", "claim budget for agent/workflow-target loops (default 8)", (value) => Number(value))
  .action(async (opts) =>
    runDaemon({
      intervalMs: opts.intervalMs,
      concurrency: opts.concurrency,
      commandConcurrency: opts.commandConcurrency,
      agentConcurrency: opts.agentConcurrency,
    }),
  );

program.command("start").action(async () => {
  const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops-daemon", args: ["run"] });
  console.log(JSON.stringify(result, null, 2));
});

program.command("stop").action(async () => {
  console.log(JSON.stringify(await stopDaemon(), null, 2));
});

program.command("status").action(() => {
  const store = new Store();
  try {
    console.log(JSON.stringify(daemonStatus(store), null, 2));
  } finally {
    store.close();
  }
});

program
  .command("install")
  .description("write a systemd user service or launchd plist for the on-box scheduler")
  .option("--local", "pin the unit to the on-box store (writes HASNA_LOOPS_LOCAL=1 into it); without it the unit inherits no opt-in")
  .action((opts: { local?: boolean }) => {
    console.log(
      JSON.stringify(
        installStartup(process.argv[1] ?? "loops-daemon", process.execPath, ["run"], process.platform, { local: Boolean(opts.local) }),
        null,
        2,
      ),
    );
  });

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const informational = argv.length === 0 || argv.some((arg) => ["--help", "-h", "--version", "-V", "help"].includes(arg));
  if (!informational) {
    // STARTUP GATE: decide the route ONCE, before any subcommand runs and
    // before the data dir is touched. `install` only writes a unit file (no
    // store), but it is gated too: a unit for a scheduler that would refuse
    // to start is not something to install by accident.
    const gate = resolveLoopsDaemonStartupGate();
    if (!gate.ok) {
      console.error(gate.message);
      process.exit(1);
    }
    noticeLocalLoopsMode();
    // Belt and braces: even on the admitted local route, a later env mutation
    // cannot re-route a running daemon; the choke point is armed only when the
    // gate refused, which exits above — so nothing to arm here.
  } else {
    // Help/version never open a store; make the guarantee structural.
    refuseLocalStore(`${LOOPS_DAEMON_REFUSAL_PREFIX} an informational invocation never opens the on-box store.`);
  }
  await program.parseAsync(process.argv);
}
