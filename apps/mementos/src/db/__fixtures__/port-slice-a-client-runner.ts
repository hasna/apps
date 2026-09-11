// Child-process runner for port-to-api-slice-a.test.ts.
//
// One scenario = one ported surface, invoked through the REAL handler the user
// reaches: the MCP tool callback registered by src/mcp/tools/*.ts, or the
// commander action registered by src/cli/commands/*.ts. Nothing here calls a
// db/ function directly — the point is to prove the shipped handler takes the
// hosted route.
//
// It runs in its own process because (a) the api-mode transport is a blocking
// Bun.spawnSync(curl) and (b) sibling suites own the ambient store-selector
// env; the harness builds this child's env with stubApiEnv() + a scratch HOME.

import { Command } from "commander";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const captureFile = process.env["CAPTURE_FILE"];
const scenario = process.env["SCENARIO"];
if (!captureFile || !scenario) throw new Error("missing CAPTURE_FILE / SCENARIO");

// ---------------------------------------------------------------------------
// MCP harness: capture the tool callbacks a register* function installs.
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function collectTools(register: (server: McpServer) => void): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const fake = {
    tool(...args: unknown[]) {
      const name = args[0] as string;
      const handler = args[args.length - 1] as ToolHandler;
      handlers.set(name, handler);
    },
  };
  register(fake as unknown as McpServer);
  return handlers;
}

async function callTool(
  register: (server: McpServer) => void,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const handlers = collectTools(register);
  const handler = handlers.get(name);
  if (!handler) throw new Error(`tool not registered: ${name}`);
  const result = (await handler(args)) as { isError?: boolean; content?: { text?: string }[] };
  if (result?.isError) {
    throw new Error(`${name} returned isError: ${result.content?.[0]?.text ?? "(no text)"}`);
  }
}

async function callCli(
  register: (program: Command) => void,
  argv: string[],
): Promise<void> {
  const program = new Command();
  program.exitOverride();
  register(program);
  await program.parseAsync(["bun", "mementos", ...argv]);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const scenarios: Record<string, () => Promise<void>> = {
  // --- synthesis (MCP) ---
  memory_synthesize: async () => {
    const { registerSynthesisTools } = await import("../../mcp/tools/synthesis-tools.js");
    await callTool(registerSynthesisTools, "memory_synthesize", { dry_run: false });
  },
  memory_synthesis_status: async () => {
    const { registerSynthesisTools } = await import("../../mcp/tools/synthesis-tools.js");
    await callTool(registerSynthesisTools, "memory_synthesis_status", {});
  },
  memory_synthesis_history: async () => {
    const { registerSynthesisTools } = await import("../../mcp/tools/synthesis-tools.js");
    await callTool(registerSynthesisTools, "memory_synthesis_history", {});
  },
  memory_synthesis_rollback: async () => {
    const { registerSynthesisTools } = await import("../../mcp/tools/synthesis-tools.js");
    await callTool(registerSynthesisTools, "memory_synthesis_rollback", { run_id: "run-1" });
  },

  // --- synthesis (CLI) ---
  "cli-synthesis-run": async () => {
    const { registerSynthesisCommand } = await import("../../cli/commands/system-synthesis.js");
    await callCli(registerSynthesisCommand, ["synthesis", "run"]);
  },
  "cli-synthesis-status": async () => {
    const { registerSynthesisCommand } = await import("../../cli/commands/system-synthesis.js");
    await callCli(registerSynthesisCommand, ["synthesis", "status"]);
  },
  "cli-synthesis-rollback": async () => {
    const { registerSynthesisCommand } = await import("../../cli/commands/system-synthesis.js");
    await callCli(registerSynthesisCommand, ["synthesis", "rollback", "run-1"]);
  },
  "cli-synthesized-profile": async () => {
    const { registerSynthesizedProfileCommand } = await import(
      "../../cli/commands/system-synthesized-profile.js"
    );
    await callCli(registerSynthesizedProfileCommand, ["synthesized-profile"]);
  },
  memory_profile: async () => {
    const { synthesizeProfile } = await import("../../lib/profile-synthesizer.js");
    // The memory_profile MCP tool body is `await synthesizeProfile(args)`; the
    // surrounding utility-tools module registers ~20 unrelated tools, so the
    // ported call is exercised directly here and through the CLI above.
    const result = await synthesizeProfile({ force_refresh: true });
    if (!result || !result.profile.includes("hosted-profile-body")) {
      throw new Error(`memory_profile did not return the hosted profile: ${JSON.stringify(result)}`);
    }
  },

  // --- memory locks (MCP) ---
  memory_lock: async () => {
    const { registerLockTools } = await import("../../mcp/tools/lock-tools.js");
    await callTool(registerLockTools, "memory_lock", {
      agent_id: "agent-1",
      key: "deploy-key",
      scope: "shared",
      ttl_seconds: 30,
    });
  },
  memory_unlock: async () => {
    const { registerLockTools } = await import("../../mcp/tools/lock-tools.js");
    await callTool(registerLockTools, "memory_unlock", { lock_id: "lock-1", agent_id: "agent-1" });
  },
  memory_check_lock: async () => {
    const { registerLockTools } = await import("../../mcp/tools/lock-tools.js");
    await callTool(registerLockTools, "memory_check_lock", { key: "deploy-key", scope: "shared" });
  },
  agentHoldsLock: async () => {
    const { agentHoldsLock } = await import("../locks.js");
    const held = agentHoldsLock("agent-1", "memory", "shared:deploy-key:", "exclusive");
    if (!held || held.id !== "lock-1") {
      throw new Error(`agentHoldsLock did not resolve the hosted lock: ${JSON.stringify(held)}`);
    }
  },

  // --- session jobs (MCP) ---
  memory_ingest_session: async () => {
    const { registerSessionTools } = await import("../../mcp/tools/session-tools.js");
    await callTool(registerSessionTools, "memory_ingest_session", {
      transcript: "hello",
      session_id: "session-1",
      agent_id: "agent-1",
      source: "manual",
    });
  },
  memory_session_status: async () => {
    const { registerSessionTools } = await import("../../mcp/tools/session-tools.js");
    await callTool(registerSessionTools, "memory_session_status", { job_id: "job-1" });
  },
  memory_session_list: async () => {
    const { registerSessionTools } = await import("../../mcp/tools/session-tools.js");
    await callTool(registerSessionTools, "memory_session_list", {});
  },

  // --- session jobs (CLI) ---
  "cli-session-ingest": async () => {
    const transcript = join(process.env["HOME"]!, "transcript.txt");
    writeFileSync(transcript, "hello from the transcript");
    const { registerSessionCommand } = await import("../../cli/commands/system-session.js");
    await callCli(registerSessionCommand, ["session", "ingest", transcript, "--session-id", "session-1"]);
  },
  "cli-session-status": async () => {
    const { registerSessionCommand } = await import("../../cli/commands/system-session.js");
    await callCli(registerSessionCommand, ["session", "status", "job-1"]);
  },
  "cli-session-list": async () => {
    const { registerSessionCommand } = await import("../../cli/commands/system-session.js");
    await callCli(registerSessionCommand, ["session", "list"]);
  },
  "session-queue-stats": async () => {
    const { getSessionQueueStats } = await import("../../lib/session-queue.js");
    const stats = getSessionQueueStats();
    if (stats.pending !== 2 || stats.completed !== 5) {
      throw new Error(`queue stats did not come from the hosted route: ${JSON.stringify(stats)}`);
    }
  },

  // --- lifecycle / tool-events (regression cover for the T1 gaps that main
  //     already closed; they must not regress while this slice moves around
  //     them) ---
  memory_stale: async () => {
    const { registerMemoryLifecycleTools } = await import("../../mcp/tools/memory-lifecycle.js");
    await callTool(registerMemoryLifecycleTools, "memory_stale", { days: 30 });
  },
  "tool-events": async () => {
    const { getToolEvents } = await import("../tool-events.js");
    const events = getToolEvents({ limit: 5 });
    if (events.length !== 1) throw new Error(`tool-events did not read the hosted route`);
  },
};

const run = scenarios[scenario];
if (!run) throw new Error(`unknown scenario: ${scenario}`);
await run();
writeFileSync(`${captureFile}.done`, "ok");
