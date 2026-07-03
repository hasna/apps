#!/usr/bin/env bun
import { Command } from "commander";
import { buildDeploymentStatus, deploymentStatusLine } from "../lib/mode.js";
import { packageVersion } from "../lib/version.js";

const program = new Command();

program
  .name("loops-api")
  .description("OpenLoops self-hosted control-plane API foundation")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function wantsJson(opts?: { json?: boolean }): boolean {
  return Boolean(program.opts().json || opts?.json);
}

function printStatus(opts?: { json?: boolean }): void {
  const status = buildDeploymentStatus({ perspective: "self_hosted" });
  if (wantsJson(opts)) console.log(JSON.stringify(status, null, 2));
  else console.log(deploymentStatusLine(status));
}

function configuredAuthToken(): string | undefined {
  return process.env.LOOPS_API_TOKEN?.trim() || process.env.HASNA_LOOPS_API_TOKEN?.trim();
}

function isLocalBind(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function authorizeRequest(request: Request, host: string): Response | undefined {
  if (isLocalBind(host)) return undefined;
  const token = configuredAuthToken();
  if (!token) return Response.json({ ok: false, error: "auth_required" }, { status: 401 });
  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${token}`
    ? undefined
    : Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export function apiStatus() {
  return {
    ok: true,
    service: "loops-api",
    status: buildDeploymentStatus({ perspective: "self_hosted" }),
  };
}

export function createLoopsApiServer(opts: { host?: string; port?: number } = {}) {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  if (!isLocalBind(host) && !configuredAuthToken()) {
    throw new Error("non-local loops-api binds require LOOPS_API_TOKEN or HASNA_LOOPS_API_TOKEN");
  }
  return Bun.serve({
    hostname: host,
    port,
    fetch(request) {
      const unauthorized = authorizeRequest(request, host);
      if (unauthorized) return unauthorized;
      const url = new URL(request.url);
      if (url.pathname === "/health" || url.pathname === "/status") {
        return Response.json(apiStatus());
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
}

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

program.action(() => printStatus());

program.command("status").option("-j, --json", "print JSON").action((opts) => printStatus(opts));

program
  .command("serve")
  .description("serve the foundation health/status endpoints")
  .option("--host <host>", "host", "127.0.0.1")
  .option("--port <port>", "port", (value) => Number(value), 8787)
  .action((opts) => {
    const host = String(opts.host);
    const port = Number(opts.port);
    const server = createLoopsApiServer({ host, port });
    console.log(`loops-api listening on http://${server.hostname}:${server.port}`);
  });

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
