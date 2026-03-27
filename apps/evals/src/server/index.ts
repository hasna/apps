#!/usr/bin/env bun
import { runEvals } from "../core/runner.js";
import { judgeOnce } from "../core/judge.js";
import { loadDataset } from "../datasets/loader.js";
import { toMarkdown } from "../core/reporter.js";
import { saveRun, getRun, listRuns, setBaseline, getBaseline } from "../db/store.js";
import type { AdapterConfig } from "../types/index.js";

const PORT = parseInt(process.env["EVALS_PORT"] ?? "19440");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    try {
      // POST /api/runs — run a dataset
      if (method === "POST" && path === "/api/runs") {
        const body = await req.json() as { dataset?: string; adapter?: AdapterConfig; concurrency?: number; skipJudge?: boolean; save?: boolean };
        if (!body.dataset) return err("dataset is required");
        if (!body.adapter) return err("adapter is required");

        const { cases } = await loadDataset(body.dataset);
        const run = await runEvals(cases, {
          dataset: body.dataset,
          adapter: body.adapter,
          concurrency: body.concurrency,
          skipJudge: body.skipJudge,
        });

        if (body.save !== false) saveRun(run);
        return json(run);
      }

      // GET /api/runs — list recent runs
      if (method === "GET" && path === "/api/runs") {
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        const dataset = url.searchParams.get("dataset") ?? undefined;
        return json(listRuns(limit, dataset));
      }

      // GET /api/runs/:id — get a specific run
      if (method === "GET" && path.startsWith("/api/runs/")) {
        const id = path.slice("/api/runs/".length);
        const run = getRun(id);
        if (!run) return err("Run not found", 404);
        const fmt = url.searchParams.get("format");
        if (fmt === "markdown") return new Response(toMarkdown(run), { headers: { "Content-Type": "text/markdown" } });
        return json(run);
      }

      // POST /api/judge — one-shot judge
      if (method === "POST" && path === "/api/judge") {
        const body = await req.json() as { input?: string; output?: string; rubric?: string; expected?: string; model?: string };
        if (!body.input || !body.output || !body.rubric) return err("input, output, and rubric are required");
        const result = await judgeOnce({ input: body.input, output: body.output, rubric: body.rubric, expected: body.expected, model: body.model });
        return json(result);
      }

      // POST /api/baselines — set baseline
      if (method === "POST" && path === "/api/baselines") {
        const body = await req.json() as { name?: string; runId?: string };
        if (!body.name || !body.runId) return err("name and runId are required");
        setBaseline(body.name, body.runId);
        return json({ ok: true, name: body.name, runId: body.runId });
      }

      // GET /api/baselines/:name — get baseline
      if (method === "GET" && path.startsWith("/api/baselines/")) {
        const name = path.slice("/api/baselines/".length);
        const run = getBaseline(name);
        if (!run) return err("Baseline not found", 404);
        return json(run);
      }

      // GET /api/health
      if (method === "GET" && path === "/api/health") {
        return json({ ok: true, version: "0.1.0" });
      }

      return err("Not found", 404);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e), 500);
    }
  },
});

console.log(`evals-serve running on http://localhost:${PORT}`);
