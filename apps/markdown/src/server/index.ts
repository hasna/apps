#!/usr/bin/env bun
// OMP HTTP Server — REST API for OMP operations

import { parseFromFile, parseFromString, validate, compile, run } from "../lib/pipeline.js";
import { validateAndLint } from "../validator/validate.js";

const VERSION = "0.1.3";
const DEFAULT_PORT = parseInt(process.env.OMP_PORT ?? "7070", 10);

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

export function parseServerCliArgs(args: string[], log: (msg: string) => void = console.log): { handled: boolean; port?: number } {
  if (args.includes("-h") || args.includes("--help")) {
    log(getServerHelpText());
    return { handled: true };
  }

  if (args.includes("-v") || args.includes("--version")) {
    log(VERSION);
    return { handled: true };
  }

  const port = parsePortArg(args);
  return { handled: false, port };
}

function parsePortArg(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-p" || arg === "--port") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error("Missing value for --port. Example: omp-serve --port 8080");
      }
      return parseAndValidatePort(next);
    }

    if (arg.startsWith("--port=")) {
      return parseAndValidatePort(arg.slice("--port=".length));
    }

    if (arg.startsWith("-p=")) {
      return parseAndValidatePort(arg.slice("-p=".length));
    }
  }

  return undefined;
}

function parseAndValidatePort(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid port: ${raw}. Port must be an integer between 1 and 65535.`);
  }

  const port = Number.parseInt(raw, 10);
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${raw}. Port must be between 1 and 65535.`);
  }

  return port;
}

export function createServer(port: number = DEFAULT_PORT) {
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
  let parsed: { handled: boolean; port?: number };

  try {
    parsed = parseServerCliArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (parsed.handled) return null;

  const server = createServer(parsed.port ?? DEFAULT_PORT);
  console.log(`OMP server running on http://localhost:${server.port}`);
  return server;
}

function methodNotAllowed(headers: Record<string, string>) {
  return Response.json({ error: "Method not allowed" }, { status: 405, headers });
}

if (import.meta.main) {
  main();
}
