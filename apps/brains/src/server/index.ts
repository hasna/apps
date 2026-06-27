#!/usr/bin/env bun
// HTTP server for @hasna/brains — REST API for model management and training data

import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, fineTunedModels, trainingJobs, trainingDatasets } from "../db/index.js";
import { getPackageVersion } from "../lib/package-metadata.js";
import { gatherAll } from "../lib/gatherers/index.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function notFound(): Response {
  return json({ error: "not found" }, 404);
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function createServerFetchHandler() {
  return function fetch(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method.toUpperCase();

    // GET /health
    if (pathname === "/health" && method === "GET") {
      return json({ status: "ok", service: "brains", version: getPackageVersion() });
    }

    // GET /models
    if (pathname === "/models" && method === "GET") {
      return handleListModels();
    }

    // GET /models/:id  or  PATCH /models/:id
    const modelMatch = pathname.match(/^\/models\/([^/]+)$/);
    if (modelMatch?.[1]) {
      const id = modelMatch[1];
      if (method === "GET") return handleGetModel(id);
      if (method === "PATCH") return handleUpdateModel(id, req);
    }

    // GET /jobs
    if (pathname === "/jobs" && method === "GET") {
      return handleListJobs();
    }

    // GET /jobs/:id
    const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
    if (jobMatch?.[1] && method === "GET") {
      return handleGetJob(jobMatch[1]);
    }

    // GET /datasets
    if (pathname === "/datasets" && method === "GET") {
      return handleListDatasets();
    }

    // POST /datasets/gather
    if (pathname === "/datasets/gather" && method === "POST") {
      return handleGather(req);
    }

    return notFound();
  };
}

async function handleListModels(): Promise<Response> {
  const db = getDb();
  const models = await db
    .select()
    .from(fineTunedModels)
    .orderBy(desc(fineTunedModels.createdAt));
  return json(models);
}

async function handleGetModel(id: string): Promise<Response> {
  const db = getDb();
  const [model] = await db
    .select()
    .from(fineTunedModels)
    .where(eq(fineTunedModels.id, id));
  if (!model) return notFound();
  return json(model);
}

async function handleUpdateModel(id: string, req: Request): Promise<Response> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(fineTunedModels)
    .where(eq(fineTunedModels.id, id));
  if (!existing) return notFound();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const allowed = ["displayName", "description", "collection", "tags"] as const;
  const updates: Partial<typeof existing> = { updatedAt: Date.now() };

  for (const key of allowed) {
    if (key in body) {
      if (key === "tags" && Array.isArray(body[key])) {
        (updates as Record<string, unknown>)[key] = JSON.stringify(body[key]);
      } else if (typeof body[key] === "string") {
        (updates as Record<string, unknown>)[key] = body[key];
      }
    }
  }

  await db.update(fineTunedModels).set(updates).where(eq(fineTunedModels.id, id));
  const [updated] = await db.select().from(fineTunedModels).where(eq(fineTunedModels.id, id));
  return json(updated);
}

async function handleListJobs(): Promise<Response> {
  const db = getDb();
  const jobs = await db
    .select()
    .from(trainingJobs)
    .orderBy(desc(trainingJobs.startedAt));
  return json(jobs);
}

async function handleGetJob(id: string): Promise<Response> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(trainingJobs)
    .where(eq(trainingJobs.id, id));
  if (!job) return notFound();
  return json(job);
}

async function handleListDatasets(): Promise<Response> {
  const db = getDb();
  const datasets = await db
    .select()
    .from(trainingDatasets)
    .orderBy(desc(trainingDatasets.createdAt));
  return json(datasets);
}

async function handleGather(req: Request): Promise<Response> {
  let body: { sources?: string[]; limit?: number; output_dir?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const sources = body.sources ?? ["todos", "mementos", "conversations", "sessions"];
  const limit = body.limit ?? 500;
  const outDir = body.output_dir ?? join(homedir(), ".hasna", "brains", "datasets");

  mkdirSync(outDir, { recursive: true });
  const results = await gatherAll(sources, { limit });
  const db = getDb();
  const now = Date.now();
  const saved = [];

  for (const result of results) {
    if (result.count === 0) continue;
    const fileName = `${result.source}-${now}.jsonl`;
    const filePath = join(outDir, fileName);
    writeFileSync(filePath, result.examples.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const id = randomUUID();
    await db.insert(trainingDatasets).values({
      id,
      source: result.source as "todos" | "mementos" | "conversations" | "sessions" | "mixed",
      filePath,
      exampleCount: result.count,
      createdAt: now,
    });
    saved.push({ id, source: result.source, count: result.count, file_path: filePath });
  }

  return json({ datasets: saved, total_examples: saved.reduce((s, d) => s + d.count, 0) });
}

const USAGE = `Usage: brains-serve [options]\n\nOptions:\n  -p, --port <number>   Port to bind (default: PORT env or 7020)\n  -h, --help            Show this help message`;

export function resolveServerPort(argv: string[], envPort: string | undefined): { port?: number; showHelp: boolean; error?: string } {
  let port = Number(envPort ?? 7020);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") {
      return { showHelp: true };
    }
    if (arg === "-p" || arg === "--port") {
      const value = argv[i + 1];
      if (!value) {
        return { showHelp: false, error: "Missing value for --port" };
      }
      port = Number(value);
      i += 1;
      continue;
    }
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { showHelp: false, error: `Invalid port: ${String(port)}` };
  }

  return { showHelp: false, port };
}

if (import.meta.main) {
  const resolved = resolveServerPort(process.argv.slice(2), process.env["PORT"]);
  if (resolved.showHelp) {
    console.log(USAGE);
    process.exit(0);
  }
  if (resolved.error || !resolved.port) {
    console.error(resolved.error ?? "Failed to resolve server port");
    console.error(USAGE);
    process.exit(1);
  }

  console.log(`brains server starting on port ${resolved.port}`);
  Bun.serve({ port: resolved.port, fetch: createServerFetchHandler() });
}
