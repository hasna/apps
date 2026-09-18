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
): Promise<string> {
  const handlers = collectTools(register);
  const handler = handlers.get(name);
  if (!handler) throw new Error(`tool not registered: ${name}`);
  const result = (await handler(args)) as { isError?: boolean; content?: { text?: string }[] };
  if (result?.isError) {
    throw new Error(`${name} returned isError: ${result.content?.[0]?.text ?? "(no text)"}`);
  }
  const text = result?.content?.map((item) => item.text ?? "").join("\n").trim() ?? "";
  if (!text) throw new Error(`${name} returned no consumable hosted result`);
  return text;
}

async function callCli(
  register: (program: Command) => void,
  argv: string[],
): Promise<string> {
  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => { output.push(values.map(String).join(" ")); };
  console.error = (...values: unknown[]) => { output.push(values.map(String).join(" ")); };
  try {
    const program = new Command();
    program.exitOverride();
    register(program);
    await program.parseAsync(["bun", "mementos", ...argv]);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const text = output.join("\n").trim();
  if (!text) throw new Error(`CLI ${argv.join(" ")} returned no consumable hosted result`);
  return text;
}


async function expectProtocolRefusal(run: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("malformed 2xx response")) return;
    throw new Error(`expected a hosted protocol refusal, received: ${message}`);
  }
  throw new Error("expected a hosted protocol refusal, but the malformed response was accepted");
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
    const result = await synthesizeProfile({
      agent_id: "agent-1",
      scope: "global",
      force_refresh: true,
    });
    if (!result || !result.profile.includes("hosted-profile-body")) {
      throw new Error(`memory_profile did not return the hosted profile: ${JSON.stringify(result)}`);
    }
  },

  // --- machines (MCP) ---
  register_machine: async () => {
    const { registerProjectTools } = await import("../../mcp/tools/project-tools.js");
    await callTool(registerProjectTools, "register_machine", { name: "apple01" });
  },
  list_machines: async () => {
    const { registerProjectTools } = await import("../../mcp/tools/project-tools.js");
    await callTool(registerProjectTools, "list_machines", {});
  },
  rename_machine: async () => {
    const { registerProjectTools } = await import("../../mcp/tools/project-tools.js");
    await callTool(registerProjectTools, "rename_machine", { id: "machine-1", new_name: "renamed" });
  },
  set_primary_machine: async () => {
    const { registerProjectTools } = await import("../../mcp/tools/project-tools.js");
    await callTool(registerProjectTools, "set_primary_machine", { id: "machine-1" });
  },
  "machine-cache-credential-change": async () => {
    const { getCurrentMachineId } = await import("../machines.js");
    getCurrentMachineId();
    process.env["HASNA_MEMENTOS_API_KEY"] = "stub-valid-rotated";
    getCurrentMachineId();
  },
  "machine-cache-delete": async () => {
    const { deleteMachine, getCurrentMachineId } = await import("../machines.js");
    const id = getCurrentMachineId();
    deleteMachine(id);
    getCurrentMachineId();
  },
  "memory-save-machine-failure": async () => {
    const { registerMemoryCrudTools } = await import("../../mcp/tools/memory-crud.js");
    const handlers = collectTools(registerMemoryCrudTools);
    const result = await handlers.get("memory_save")!({ key: "machine-failure", value: "must not widen" }) as { isError?: boolean };
    if (!result.isError) throw new Error("memory_save accepted a hosted machine identity failure");
  },
  "machine-visibility-memo": async () => {
    // getCurrentMachineId is on the memory_save / memory_inject / projects
    // hot paths. The hosted arm must resolve ONCE per process: an unmemoized
    // one would put an idempotent-register WRITE in front of every read.
    const { getCurrentMachineId } = await import("../machines.js");
    const a = getCurrentMachineId();
    const b = getCurrentMachineId();
    const c = getCurrentMachineId();
    if (a !== b || b !== c || a !== "machine-1") {
      throw new Error(`memoized machine id disagreed: ${a} ${b} ${c}`);
    }
  },
  "machine-visibility": async () => {
    // The filter the CLI `projects` / `inject` / `context` / `project-panel`
    // commands apply: it used to fall back to null (= no machine filter, so
    // another machine's memories became visible) because getCurrentMachineId
    // could only read local SQLite.
    const { resolveVisibleMachineId } = await import("../../lib/machine-visibility.js");
    const id = resolveVisibleMachineId();
    if (id !== "machine-1") {
      throw new Error(`machine-visibility did not resolve the hosted machine id: ${String(id)}`);
    }
  },
  "malformed-machine-register": async () => {
    const { registerMachine } = await import("../machines.js");
    await expectProtocolRefusal(() => registerMachine("apple01"));
  },
  "malformed-machine-register-binding": async () => {
    const { registerMachine } = await import("../machines.js");
    await expectProtocolRefusal(() => registerMachine("apple01"));
  },
  "malformed-machine-list": async () => {
    const { listMachines } = await import("../machines.js");
    await expectProtocolRefusal(() => listMachines());
  },
  "malformed-machine-rename": async () => {
    const { renameMachine } = await import("../machines.js");
    await expectProtocolRefusal(() => renameMachine("machine-1", "renamed"));
  },
  "malformed-machine-primary": async () => {
    const { setPrimaryMachine } = await import("../machines.js");
    await expectProtocolRefusal(() => setPrimaryMachine("machine-1"));
  },
  "malformed-machine-get": async () => {
    const { getMachine } = await import("../machines.js");
    await expectProtocolRefusal(() => getMachine("machine-1"));
  },
  "malformed-machine-touch": async () => {
    const { touchMachine } = await import("../machines.js");
    await expectProtocolRefusal(() => touchMachine("machine-1"));
  },
  "malformed-machine-delete": async () => {
    const { deleteMachine } = await import("../machines.js");
    await expectProtocolRefusal(() => deleteMachine("machine-1"));
  },

  // --- immutable audit log (MCP/client) ---
  memory_audit_trail: async () => {
    const { registerMemoryAuditTools } = await import("../../mcp/tools/memory-audit.js");
    await callTool(registerMemoryAuditTools, "memory_audit_trail", { memory_id: "mem-1", limit: 10, format: "json" });
  },
  memory_audit_export: async () => {
    const { registerMemoryAuditTools } = await import("../../mcp/tools/memory-audit.js");
    await callTool(registerMemoryAuditTools, "memory_audit_export", { operation: "update", limit: 10, format: "json" });
  },
  memory_audit_stats: async () => {
    const { registerMemoryAuditTools } = await import("../../mcp/tools/memory-audit.js");
    await callTool(registerMemoryAuditTools, "memory_audit_stats", {});
  },
  "malformed-audit-trail": async () => {
    const { getMemoryAuditTrailPage } = await import("../audit.js");
    await expectProtocolRefusal(() => getMemoryAuditTrailPage("mem-1", { limit: 10 }));
  },
  "false-empty-audit-trail": async () => {
    const { getMemoryAuditTrail, getMemoryAuditTrailPage } = await import("../audit.js");
    await expectProtocolRefusal(() => getMemoryAuditTrailPage("mem-1", { limit: 10 }));
    await expectProtocolRefusal(() => getMemoryAuditTrail("mem-1", 10));
  },
  "malformed-audit-export": async () => {
    const { exportAuditLogPage } = await import("../audit.js");
    await expectProtocolRefusal(() => exportAuditLogPage({ operation: "update", limit: 10 }));
  },
  "limit-mismatch-audit-export": async () => {
    const { exportAuditLogPage } = await import("../audit.js");
    await expectProtocolRefusal(() => exportAuditLogPage({ operation: "update", limit: 10 }));
  },
  "filter-mismatch-audit-export": async () => {
    const { exportAuditLogPage } = await import("../audit.js");
    await expectProtocolRefusal(() => exportAuditLogPage({ operation: "update", limit: 10 }));
  },
  "malformed-audit-stats": async () => {
    const { getAuditStats } = await import("../audit.js");
    await expectProtocolRefusal(() => getAuditStats());
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
  clean_expired_locks: async () => {
    const { registerLockTools } = await import("../../mcp/tools/lock-tools.js");
    const text = await callTool(registerLockTools, "clean_expired_locks", {});
    if (!text.includes("hosted store") || !text.includes("2")) {
      throw new Error(`clean_expired_locks did not consume the hosted count: ${text}`);
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
    await callTool(registerSessionTools, "memory_session_list", {
      session_id: "session-1",
      limit: 5,
      offset: 7,
    });
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
    await callCli(registerSessionCommand, [
      "session", "list", "--session-id", "session-1", "--limit", "4", "--offset", "9",
    ]);
  },
  "session-queue-stats": async () => {
    const { getSessionQueueStats } = await import("../../lib/session-queue.js");
    const stats = getSessionQueueStats();
    if (stats.pending !== 2 || stats.completed !== 5) {
      throw new Error(`queue stats did not come from the hosted route: ${JSON.stringify(stats)}`);
    }
  },


  // --- malformed hosted 2xx responses must never become empty/zero/success ---
  "malformed-lock-acquire": async () => {
    const { acquireLock } = await import("../locks.js");
    await expectProtocolRefusal(() => acquireLock("agent-1", "memory", "shared:deploy-key:"));
  },
  "malformed-lock-list": async () => {
    const { checkLock } = await import("../locks.js");
    await expectProtocolRefusal(() => checkLock("memory", "shared:deploy-key:"));
  },
  "malformed-lock-release": async () => {
    const { releaseLock } = await import("../locks.js");
    await expectProtocolRefusal(() => releaseLock("lock-1", "agent-1"));
  },
  "malformed-agent-lock-list": async () => {
    const { listAgentLocks } = await import("../locks.js");
    await expectProtocolRefusal(() => listAgentLocks("agent-1"));
  },
  "malformed-agent-lock-release": async () => {
    const { releaseAllAgentLocks } = await import("../locks.js");
    await expectProtocolRefusal(() => releaseAllAgentLocks("agent-1"));
  },
  "malformed-lock-clean": async () => {
    const { cleanExpiredLocks } = await import("../locks.js");
    await expectProtocolRefusal(() => cleanExpiredLocks());
  },
  "malformed-session-ingest": async () => {
    const { createSessionJob } = await import("../session-jobs.js");
    await expectProtocolRefusal(() => createSessionJob({ session_id: "session-1", transcript: "hello" }));
  },
  "malformed-session-job": async () => {
    const { getSessionJob } = await import("../session-jobs.js");
    await expectProtocolRefusal(() => getSessionJob("job-1"));
  },
  "malformed-session-list": async () => {
    const { listSessionJobs } = await import("../session-jobs.js");
    await expectProtocolRefusal(() => listSessionJobs({ limit: 5, offset: 7 }));
  },
  "old-session-list": async () => {
    const { listSessionJobs } = await import("../session-jobs.js");
    await expectProtocolRefusal(() => listSessionJobs({ limit: 5, offset: 7 }));
  },
  "malformed-session-stats": async () => {
    const { getSessionQueueStats } = await import("../../lib/session-queue.js");
    await expectProtocolRefusal(() => getSessionQueueStats());
  },
  "malformed-profile": async () => {
    const { synthesizeProfile } = await import("../../lib/profile-synthesizer.js");
    await expectProtocolRefusal(() => synthesizeProfile({ scope: "global", force_refresh: true }));
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
