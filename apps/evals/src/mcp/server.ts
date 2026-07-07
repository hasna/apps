import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { runEvals } from "../core/runner.js";
import { judgeOnce } from "../core/judge.js";
import { loadDataset } from "../datasets/loader.js";
import {
  compareRuns,
  formatRunList,
  formatRunSummary,
  parseDisplayLimit,
  summarizeRun,
  toJson,
  toMarkdown,
  truncateDisplayText,
} from "../core/reporter.js";
import { countRuns, saveRun, getRun, listRuns } from "../db/store.js";
import { writeFileSync, appendFileSync } from "fs";
import type { EvalCase, AdapterConfig } from "../types/index.js";

const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json() as { version: string };

export const MCP_NAME = "evals";
export const DEFAULT_MCP_HTTP_PORT = 8862;

export function buildServer(): Server {
const server = new Server(
  { name: MCP_NAME, version: pkg.version },
  { capabilities: { tools: {} } }
);

// ─── Tool schemas ─────────────────────────────────────────────────────────────

const AdapterSchema = z.object({
  type: z.enum(["http", "anthropic", "openai", "mcp", "function", "cli"]),
  url: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  command: z.array(z.string()).optional(),
  tool: z.string().optional(),
  modulePath: z.string().optional(),
}).passthrough();

function parseCursor(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function boolArg(value: unknown): boolean {
  return value === true || value === "true";
}

const tools = [
  {
    name: "evals_run",
    description: "Run a full eval dataset against an app and return results",
    inputSchema: {
      type: "object",
      properties: {
        dataset: { type: "string", description: "Path to JSONL/JSON dataset" },
        adapter: { type: "object", description: "Adapter config (type, url/model/command, etc.)" },
        concurrency: { type: "number", description: "Parallel execution limit (default: 5)" },
        skip_judge: { type: "boolean", description: "Skip LLM judge, run assertions only" },
        tags: { type: "array", items: { type: "string" }, description: "Filter cases by tags" },
        save: { type: "boolean", description: "Save run to database" },
        output_format: { type: "string", enum: ["json", "markdown", "summary"], description: "Output format" },
        limit: { type: "number", description: "Max result rows in summary output (default: 10)" },
        verbose: { type: "boolean", description: "Show all result rows in summary output" },
      },
      required: ["dataset", "adapter"],
    },
  },
  {
    name: "evals_run_single",
    description: "Run a single eval case ad-hoc — useful for agents to verify their own output quality",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input to the AI app" },
        output: { type: "string", description: "AI's response to evaluate" },
        rubric: { type: "string", description: "Plain-English grading criteria" },
        expected: { type: "string", description: "Expected behavior description" },
        assertions: { type: "array", description: "Optional deterministic assertions" },
        judge_model: { type: "string", description: "Judge model (default: claude-sonnet-4-6)" },
        judge_provider: { type: "string", enum: ["anthropic", "openai"] },
      },
      required: ["input", "output", "rubric"],
    },
  },
  {
    name: "evals_judge",
    description: "One-shot LLM judge — no dataset needed",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string" },
        output: { type: "string" },
        rubric: { type: "string" },
        expected: { type: "string" },
        model: { type: "string" },
        provider: { type: "string", enum: ["anthropic", "openai"] },
      },
      required: ["input", "output", "rubric"],
    },
  },
  {
    name: "evals_list_datasets",
    description: "List available JSONL datasets in a directory",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory to search (default: ./datasets)" },
        limit: { type: "number", description: "Max dataset paths to return (default: 50)" },
        cursor: { type: "string", description: "Pagination offset returned by a previous call" },
      },
    },
  },
  {
    name: "evals_get_results",
    description: "Get results for a past eval run",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Run ID or partial ID" },
        format: { type: "string", enum: ["json", "markdown", "summary"] },
        limit: { type: "number", description: "Max runs/results to show (default: 10)" },
        cursor: { type: "string", description: "Pagination offset when listing runs" },
        verbose: { type: "boolean", description: "Show all result rows in summary output when run_id is provided" },
      },
    },
  },
  {
    name: "evals_compare",
    description: "Compare two eval runs — show regressions and improvements",
    inputSchema: {
      type: "object",
      properties: {
        before: { type: "string", description: "Before run ID or baseline name" },
        after: { type: "string", description: "After run ID" },
        limit: { type: "number", description: "Max diff rows in compact output (default: 20)" },
        verbose: { type: "boolean", description: "Show all diff rows" },
      },
      required: ["before", "after"],
    },
  },
  {
    name: "evals_create_case",
    description: "Add a new eval case to a dataset file",
    inputSchema: {
      type: "object",
      properties: {
        dataset: { type: "string", description: "Path to JSONL file to append to" },
        id: { type: "string", description: "Unique case ID" },
        input: { type: "string" },
        expected: { type: "string" },
        rubric: { type: "string", description: "Judge rubric for this case" },
        assertions: { type: "array" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["dataset", "id", "input"],
    },
  },
  {
    name: "evals_generate_cases",
    description: "Auto-generate eval cases from a description using Claude",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What behavior to test" },
        count: { type: "number", description: "Number of cases to generate (default: 10)" },
        output: { type: "string", description: "Output JSONL path" },
        seeds: { type: "string", description: "Path to seed examples JSONL" },
      },
      required: ["description"],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "evals_run": {
        const adapter = AdapterSchema.parse(a["adapter"]) as AdapterConfig;
        const { cases } = await loadDataset(String(a["dataset"]), {
          tags: (a["tags"] as string[] | undefined),
        });
        const run = await runEvals(cases, {
          dataset: String(a["dataset"]),
          adapter,
          concurrency: Number(a["concurrency"] ?? 5),
          skipJudge: Boolean(a["skip_judge"]),
        });
        if (a["save"]) saveRun(run);
        const fmt = String(a["output_format"] ?? "summary");
        const output = fmt === "json" ? toJson(run)
          : fmt === "markdown" ? toMarkdown(run)
          : formatRunSummary(run, {
              limit: parseDisplayLimit(a["limit"], 10),
              verbose: boolArg(a["verbose"]),
              detailHint: "set verbose=true for all rows",
              jsonHint: "set output_format=json for full run data",
            });
        return { content: [{ type: "text", text: output }] };
      }

      case "evals_run_single": {
        const evalCase: EvalCase = {
          id: "mcp-single",
          input: String(a["input"]),
          expected: a["expected"] ? String(a["expected"]) : undefined,
          assertions: (a["assertions"] as EvalCase["assertions"]) ?? [],
          judge: {
            rubric: String(a["rubric"]),
            model: a["judge_model"] ? String(a["judge_model"]) : undefined,
            provider: a["judge_provider"] as "anthropic" | "openai" | undefined,
          },
        };
        // Use a no-op adapter since output is provided directly
        const mockAdapter: AdapterConfig = { type: "function", modulePath: "__mock__" };
        // Override: we already have the output, just judge it
        const judgeResult = await judgeOnce({
          input: String(a["input"]),
          output: String(a["output"]),
          rubric: String(a["rubric"]),
          expected: a["expected"] ? String(a["expected"]) : undefined,
          model: a["judge_model"] ? String(a["judge_model"]) : undefined,
          provider: a["judge_provider"] as "anthropic" | "openai" | undefined,
        });
        void evalCase; void mockAdapter;
        return {
          content: [{
            type: "text",
            text: `VERDICT: ${judgeResult.verdict}\nREASONING: ${judgeResult.reasoning}`,
          }],
        };
      }

      case "evals_judge": {
        const r = await judgeOnce({
          input: String(a["input"]),
          output: String(a["output"]),
          rubric: String(a["rubric"]),
          expected: a["expected"] ? String(a["expected"]) : undefined,
          model: a["model"] ? String(a["model"]) : undefined,
          provider: a["provider"] as "anthropic" | "openai" | undefined,
        });
        return { content: [{ type: "text", text: `${r.verdict}\n${r.reasoning}` }] };
      }

      case "evals_list_datasets": {
        const dir = String(a["directory"] ?? "./datasets");
        const files: string[] = [];
        for await (const f of new Bun.Glob(`${dir}/**/*.jsonl`).scan(".")) files.push(f);
        for await (const f of new Bun.Glob(`${dir}/**/*.json`).scan(".")) files.push(f);
        files.sort();
        const limit = parseDisplayLimit(a["limit"], 50);
        const cursor = parseCursor(a["cursor"]);
        const visible = files.slice(cursor, cursor + limit);
        const nextCursor = cursor + visible.length < files.length ? cursor + visible.length : null;
        const lines = visible.length > 0 ? visible : ["No datasets found"];
        if (files.length > visible.length) {
          lines.push(`Showing ${Math.min(cursor + visible.length, files.length)} of ${files.length} datasets.`);
          if (nextCursor !== null) lines.push(`Next cursor: ${nextCursor}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "evals_get_results": {
        if (a["run_id"]) {
          const run = getRun(String(a["run_id"]));
          if (!run) return { content: [{ type: "text", text: "Run not found" }] };
          const fmt = String(a["format"] ?? "summary");
          const text = fmt === "json" ? toJson(run) : fmt === "markdown" ? toMarkdown(run)
            : formatRunSummary(run, {
                limit: parseDisplayLimit(a["limit"], 10),
                verbose: boolArg(a["verbose"]),
                detailHint: "set verbose=true for all rows",
                jsonHint: "set format=json for full run data",
              });
          return { content: [{ type: "text", text }] };
        } else {
          const limit = parseDisplayLimit(a["limit"], 10);
          const cursor = parseCursor(a["cursor"]);
          const runs = listRuns(limit, undefined, cursor);
          const total = countRuns();
          const nextCursor = cursor + runs.length < total ? cursor + runs.length : null;
          if (String(a["format"] ?? "summary") === "json") {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ runs: runs.map(summarizeRun), total, limit, cursor, nextCursor }, null, 2),
              }],
            };
          }
          return {
            content: [{
              type: "text",
              text: formatRunList(runs, {
                total,
                cursor,
                limit,
                nextCursor,
                detailCommand: "Call evals_get_results with run_id for details, format=json for full data.",
              }),
            }],
          };
        }
      }

      case "evals_compare": {
        const { getBaseline } = await import("../db/store.js");
        const before = getRun(String(a["before"])) ?? getBaseline(String(a["before"]));
        const after = getRun(String(a["after"])) ?? getBaseline(String(a["after"]));
        if (!before || !after) return { content: [{ type: "text", text: "Run(s) not found" }] };
        const diff = compareRuns(before, after);
        const limit = parseDisplayLimit(a["limit"], 20);
        const verbose = boolArg(a["verbose"]);
        const lines = [`Score delta: ${diff.passRateDelta >= 0 ? "+" : ""}${(diff.passRateDelta * 100).toFixed(1)}%`];
        const totalChanges = diff.regressions.length + diff.improvements.length;
        let shown = 0;
        for (const r of diff.regressions) {
          if (!verbose && shown >= limit) break;
          const caseId = verbose ? r.caseId : truncateDisplayText(r.caseId, 48);
          lines.push(`↓ REGRESSION: ${caseId} (${r.before} → ${r.after})`);
          shown++;
        }
        for (const i of diff.improvements) {
          if (!verbose && shown >= limit) break;
          const caseId = verbose ? i.caseId : truncateDisplayText(i.caseId, 48);
          lines.push(`↑ IMPROVEMENT: ${caseId} (${i.before} → ${i.after})`);
          shown++;
        }
        const hidden = totalChanges - shown;
        if (hidden > 0) lines.push(`... ${hidden} more change${hidden === 1 ? "" : "s"} hidden. Set verbose=true or increase limit for more.`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "evals_create_case": {
        const evalCase: EvalCase = {
          id: String(a["id"]),
          input: String(a["input"]),
          expected: a["expected"] ? String(a["expected"]) : undefined,
          judge: a["rubric"] ? { rubric: String(a["rubric"]) } : undefined,
          assertions: (a["assertions"] as EvalCase["assertions"]) ?? undefined,
          tags: (a["tags"] as string[]) ?? undefined,
        };
        appendFileSync(String(a["dataset"]), JSON.stringify(evalCase) + "\n");
        return { content: [{ type: "text", text: `Case "${evalCase.id}" appended to ${a["dataset"]}` }] };
      }

      case "evals_generate_cases": {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic();
        const count = Number(a["count"] ?? 10);
        const res = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          temperature: 1,
          system: "Generate eval cases as JSONL. Each line: {id, input, expected, judge: {rubric}, tags}. Output only JSONL lines.",
          messages: [{ role: "user", content: `Generate ${count} eval cases for: ${a["description"]}` }],
        });
        const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const lines = text.split("\n").filter((l) => l.trim().startsWith("{"));
        const output = String(a["output"] ?? "generated.jsonl");
        writeFileSync(output, lines.join("\n") + "\n");
        return { content: [{ type: "text", text: `Generated ${lines.length} cases → ${output}` }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

return server;
}
