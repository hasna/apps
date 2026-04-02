#!/usr/bin/env bun
// OMP HTTP Server — REST API for OMP operations

import { parseFromFile, parseFromString, validate, compile, run } from "../lib/pipeline.js";
import { validateAndLint } from "../validator/validate.js";

const VERSION = "0.1.0";
const PORT = parseInt(process.env.OMP_PORT ?? "7070", 10);

export function getServerHelpText(): string {
  return [
    "Usage: omp-serve [options]",
    "",
    "OMP HTTP Server — REST API for OMP operations",
    "",
    "Options:",
    "  -p, --port <port>   Port to listen on (or OMP_PORT env, default: 7070)",
    "  -v, --version       Output version",
    "  -h, --help          Display help",
  ].join("\n");
}

export function handleServerCliArgs(args: string[], log: (msg: string) => void = console.log): boolean {
  if (args.includes("-h") || args.includes("--help")) {
    log(getServerHelpText());
    return true;
  }

  if (args.includes("-v") || args.includes("--version")) {
    log(VERSION);
    return true;
  }

  return false;
}

export function createServer(port: number = PORT) {
  return Bun.serve({
    port,

    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS headers
      const headers = {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }

      try {
        switch (path) {
          case "/health": {
            return Response.json({ status: "ok", version: VERSION }, { headers });
          }

          case "/validate": {
            if (req.method !== "POST") return methodNotAllowed(headers);
            const body = await req.json() as { file?: string; content?: string };
            const doc = body.file ? parseFromFile(body.file) : parseFromString(body.content ?? "");
            const errors = validate(doc);
            const errorCount = errors.filter((e) => e.level === "error").length;
            return Response.json({
              valid: errorCount === 0,
              cards: doc.cards.length,
              errors: errors.filter((e) => e.level === "error"),
              warnings: errors.filter((e) => e.level === "warning"),
            }, { headers });
          }

          case "/compile": {
            if (req.method !== "POST") return methodNotAllowed(headers);
            const body = await req.json() as { file?: string; content?: string };
            const doc = body.file ? parseFromFile(body.file) : parseFromString(body.content ?? "");
            const plan = compile(doc);
            return Response.json(plan, { headers });
          }

          case "/inspect": {
            if (req.method !== "POST") return methodNotAllowed(headers);
            const body = await req.json() as { file?: string; content?: string };
            const doc = body.file ? parseFromFile(body.file) : parseFromString(body.content ?? "");
            const plan = compile(doc);
            return Response.json({
              title: doc.title,
              cards: doc.cards.map((c) => ({
                type: c.type, id: c.id, depends: c.depends,
                accepts: c.accepts, headerKeys: Object.keys(c.headers),
              })),
              executionPlan: plan,
            }, { headers });
          }

          case "/lint": {
            if (req.method !== "POST") return methodNotAllowed(headers);
            const body = await req.json() as { file?: string; content?: string };
            const doc = body.file ? parseFromFile(body.file) : parseFromString(body.content ?? "");
            const issues = validateAndLint(doc);
            return Response.json({
              cards: doc.cards.length,
              errors: issues.filter((e) => e.level === "error"),
              warnings: issues.filter((e) => e.level === "warning"),
              info: issues.filter((e) => e.level === "info"),
            }, { headers });
          }

          case "/run": {
            if (req.method !== "POST") return methodNotAllowed(headers);
            const body = await req.json() as { file: string; output_dir?: string; dry_run?: boolean };
            if (!body.file) return Response.json({ error: "file is required" }, { status: 422, headers });
            const result = await run(body.file, {
              outputDir: body.output_dir ?? ".",
              dryRun: body.dry_run ?? true,
            });
            return Response.json(result, { headers });
          }

          default:
            return Response.json({ error: "Not found" }, { status: 404, headers });
        }
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500, headers }
        );
      }
    },
  });
}

export function main(args: string[] = process.argv.slice(2)) {
  if (handleServerCliArgs(args)) return null;

  const server = createServer(PORT);
  console.log(`OMP server running on http://localhost:${server.port}`);
  return server;
}

function methodNotAllowed(headers: Record<string, string>) {
  return Response.json({ error: "Method not allowed" }, { status: 405, headers });
}

if (import.meta.main) {
  main();
}
