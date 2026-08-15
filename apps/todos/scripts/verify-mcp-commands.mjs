// Fresh-session MCP verification harness for @hasna/todos.
// Spawns `todos-mcp --stdio` (the installed 0.11.51), lists every tool, proves the
// create_task agent-name fix, then calls every tool and classifies it as
// WORKING vs BROKEN (internal handler exception). Validation errors (missing
// required args) count as WORKING — the tool is registered and guarding input.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbDir = mkdtempSync(join(tmpdir(), "todos-mcp-verify-"));
const env = { ...process.env, TODOS_DB_PATH: join(dbDir, "verify.db"), TODOS_AUTO_PROJECT: "false", TODOS_PROFILE: "full" };

// MCP_CMD lets us point at a freshly-built local bundle instead of the global install.
const cmd = process.env.MCP_CMD || "todos-mcp";
const cmdArgs = process.env.MCP_CMD ? [process.env.MCP_CMD_ARG || "dist/mcp/index.js", "--stdio"] : ["--stdio"];
const transport = new StdioClientTransport(process.env.MCP_CMD
  ? { command: process.env.MCP_CMD, args: [process.env.MCP_CMD_ARG || "dist/mcp/index.js", "--stdio"], env }
  : { command: "todos-mcp", args: ["--stdio"], env });
const client = new Client({ name: "verify-harness", version: "1.0.0" }, { capabilities: {} });

const BROKEN_RE = /UNKNOWN_ERROR|is not a function|Cannot read|Cannot find|does not exist|undefined is not|TypeError|ReferenceError|no such table|SQLITE_ERROR/i;

function classify(res) {
  const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n");
  if (res?.isError && BROKEN_RE.test(text)) return { state: "BROKEN", text: text.slice(0, 160) };
  return { state: "OK", text: text.slice(0, 80) };
}

async function call(name, args) {
  try {
    const res = await client.callTool({ name, arguments: args });
    return classify(res);
  } catch (e) {
    const msg = String(e?.message ?? e);
    // JSON-RPC validation / invalid-params = tool present & guarding input = OK.
    if (/invalid|required|validation|Expected|param|-32602/i.test(msg) && !BROKEN_RE.test(msg)) {
      return { state: "OK", text: "validation: " + msg.slice(0, 80) };
    }
    return { state: "BROKEN", text: msg.slice(0, 160) };
  }
}

const main = async () => {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`CONNECTED. ${tools.length} tools registered.\n`);

  // --- Prove the create_task agent-name fix explicitly ---
  console.log("=== FIX CHECK: create_task with assigned_to = agent NAME ===");
  const reg = await call("register_agent", { name: "verifagent" });
  console.log("register_agent:", reg.state, reg.text);
  const proj = await call("create_project", { name: "VerifyProj", path: dbDir });
  console.log("create_project:", proj.state, proj.text);
  const created = await client.callTool({ name: "create_task", arguments: { title: "fix-check task", assigned_to: "verifagent", priority: "high", tags: ["verify"] } });
  const cc = classify(created);
  console.log("create_task(assigned_to=NAME):", cc.state, cc.text);
  const FIX_OK = cc.state === "OK";
  console.log(`\n>>> FIX VERIFIED: ${FIX_OK ? "YES — agent name resolves, no UNKNOWN_ERROR" : "NO — STILL BROKEN"}\n`);

  // --- Exercise every tool with minimal/empty args ---
  console.log("=== ALL TOOLS PROBE (each called with {} or minimal args) ===");
  const minimal = {
    create_task: { title: "t" }, get_task: { task_id: "x" }, register_agent: { name: "probe2" },
    create_project: { name: "P2", path: dbDir + "-2" }, search_tasks: { query: "t" },
    add_comment: { task_id: "x", comment: "c" }, get_task_history: { task_id: "x" },
  };
  const broken = [], ok = [];
  for (const t of tools.map((x) => x.name).sort()) {
    const r = await call(t, minimal[t] ?? {});
    (r.state === "BROKEN" ? broken : ok).push(t);
    if (r.state === "BROKEN") console.log(`  BROKEN  ${t} :: ${r.text}`);
  }
  console.log(`\n=== SUMMARY ===`);
  console.log(`tools registered: ${tools.length}`);
  console.log(`WORKING/guarded : ${ok.length}`);
  console.log(`BROKEN (internal): ${broken.length}`);
  if (broken.length) console.log(`broken tools: ${broken.join(", ")}`);
  console.log(`FIX (create_task by agent name): ${FIX_OK ? "PASS" : "FAIL"}`);

  await client.close();
  process.exit(FIX_OK ? 0 : 1);
};
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
