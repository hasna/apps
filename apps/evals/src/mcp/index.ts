#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { runEvals } from "../core/runner.js";
import { judgeOnce } from "../core/judge.js";
import { loadDataset } from "../datasets/loader.js";
import { toJson, toMarkdown, compareRuns } from "../core/reporter.js";
import { saveRun, getRun, listRuns } from "../db/store.js";
import { writeFileSync, appendFileSync } from "fs";
import type { EvalCase, AdapterConfig } from "../types/index.js";

const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json() as { version: string };

const server = new Server(
  { name: "evals", version: pkg.version },
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
        limit: { type: "number", description: "Max runs to list if no run_id given" },
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
          : `${run.stats.passed}/${run.stats.total} passed (${(run.stats.passRate * 100).toFixed(1)}%) in ${run.stats.totalDurationMs}ms. Run ID: ${run.id.slice(0, 8)}`;
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
        return { content: [{ type: "text", text: files.length > 0 ? files.join("\n") : "No datasets found" }] };
      }

      case "evals_get_results": {
        if (a["run_id"]) {
          const run = getRun(String(a["run_id"]));
          if (!run) return { content: [{ type: "text", text: "Run not found" }] };
          const fmt = String(a["format"] ?? "summary");
          const text = fmt === "json" ? toJson(run) : fmt === "markdown" ? toMarkdown(run)
            : `Run ${run.id.slice(0, 8)}: ${run.stats.passed}/${run.stats.total} passed (${(run.stats.passRate * 100).toFixed(1)}%)`;
          return { content: [{ type: "text", text }] };
        } else {
          const runs = listRuns(Number(a["limit"] ?? 10));
          const summary = runs.map((r) =>
            `${r.id.slice(0, 8)} | ${r.createdAt.slice(0, 10)} | ${r.dataset} | ${r.stats.passed}/${r.stats.total} passed`
          ).join("\n");
          return { content: [{ type: "text", text: summary || "No runs found" }] };
        }
      }

      case "evals_compare": {
        const { getBaseline } = await import("../db/store.js");
        const before = getRun(String(a["before"])) ?? getBaseline(String(a["before"]));
        const after = getRun(String(a["after"])) ?? getBaseline(String(a["after"]));
        if (!before || !after) return { content: [{ type: "text", text: "Run(s) not found" }] };
        const diff = compareRuns(before, after);
        const lines = [
          `Score delta: ${diff.passRateDelta >= 0 ? "+" : ""}${(diff.passRateDelta * 100).toFixed(1)}%`,
          ...diff.regressions.map((r) => `↓ REGRESSION: ${r.caseId} (${r.before} → ${r.after})`),
          ...diff.improvements.map((i) => `↑ IMPROVEMENT: ${i.caseId} (${i.before} → ${i.after})`),
        ];
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

const transport = new StdioServerTransport();
await server.connect(transport);
