#!/usr/bin/env bun
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export type DistServerRuntimeEvidence = {
  expectedVersion: string | undefined;
  versionExitCode: number | null;
  versionOutput: string;
  startupExitCode: number | null;
  versionRouteStatus: number | null;
  versionRouteVersion: string | null;
  dashboardRouteStatus: number | null;
  dashboardRootPresent: boolean;
};

export function validateDistServerRuntimeEvidence(evidence: DistServerRuntimeEvidence): string[] {
  const failures: string[] = [];
  if (evidence.versionExitCode !== 0) failures.push("version command must exit zero");
  if (!evidence.expectedVersion || evidence.versionOutput !== evidence.expectedVersion) {
    failures.push("version command must report the package version exactly");
  }
  if (evidence.versionRouteStatus !== 200 || evidence.versionRouteVersion !== evidence.expectedVersion) {
    failures.push("GET /version must execute the lazy route and report the package version");
  }
  if (evidence.dashboardRouteStatus !== 200 || !evidence.dashboardRootPresent) {
    failures.push("GET / must serve the built dashboard contract");
  }
  if (evidence.startupExitCode !== 0) failures.push("server must exit zero after graceful smoke shutdown");
  return failures;
}

async function reservePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
  const port = probe.port;
  await probe.stop(true);
  return port;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, "..");
  const serverEntrypoint = join(root, "dist", "server", "index.js");
  const dashboardEntrypoint = join(root, "dashboard", "dist", "index.html");
  if (!existsSync(serverEntrypoint)) throw new Error("packaged server smoke requires dist/server/index.js");
  if (!existsSync(dashboardEntrypoint)) throw new Error("packaged server smoke requires dashboard/dist/index.html");

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
  const runtimeRoot = mkdtempSync(join(tmpdir(), "todos-dist-server-"));
  try {
    cpSync(join(root, "dist"), join(runtimeRoot, "dist"), { recursive: true, verbatimSymlinks: true });
    cpSync(join(root, "dashboard", "dist"), join(runtimeRoot, "dashboard", "dist"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    if (existsSync(join(runtimeRoot, "node_modules"))) {
      throw new Error("packaged server smoke unexpectedly contains node_modules");
    }
    const runtimeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: runtimeRoot,
      NODE_ENV: "production",
      TODOS_NO_OPEN: "true",
      HASNA_TODOS_DB_PATH: ":memory:",
      TODOS_DB_PATH: ":memory:",
    };
    const version = spawnSync(
      process.execPath,
      ["--no-install", "dist/server/index.js", "--version"],
      { cwd: runtimeRoot, encoding: "utf8", env: runtimeEnv },
    );

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const startup = spawn(
      process.execPath,
      ["--no-install", "dist/server/index.js", `--port=${port}`, "--host", "127.0.0.1", "--no-open"],
      { cwd: runtimeRoot, env: runtimeEnv },
    );
    let startupOutput = "";
    startup.stdout?.setEncoding("utf8");
    startup.stderr?.setEncoding("utf8");
    startup.stdout?.on("data", (chunk: string) => { startupOutput += chunk; });
    startup.stderr?.on("data", (chunk: string) => { startupOutput += chunk; });
    const startupExited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      let settled = false;
      const settle = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolveExit({ code, signal });
      };
      startup.once("exit", settle);
      startup.once("error", () => settle(null, null));
    });

    let versionRouteStatus: number | null = null;
    let versionRouteVersion: string | null = null;
    let dashboardRouteStatus: number | null = null;
    let dashboardRootPresent = false;
    let lastRouteError: unknown;
    const deadline = Date.now() + 5_000;
    try {
      while (Date.now() < deadline) {
        try {
          const versionResponse = await fetch(`${baseUrl}/version`);
          versionRouteStatus = versionResponse.status;
          const payload = await versionResponse.json() as { version?: string };
          versionRouteVersion = payload.version ?? null;
          const dashboardResponse = await fetch(`${baseUrl}/`);
          dashboardRouteStatus = dashboardResponse.status;
          const dashboardHtml = await dashboardResponse.text();
          dashboardRootPresent = dashboardHtml.includes('<div id="root">');
          break;
        } catch (error) {
          lastRouteError = error;
          await Bun.sleep(50);
        }
      }
    } finally {
      if (startup.exitCode === null && startup.signalCode === null) startup.kill("SIGTERM");
    }
    let startupExit = await Promise.race([
      startupExited,
      Bun.sleep(2_000).then(() => null),
    ]);
    if (startupExit === null) {
      startup.kill("SIGKILL");
      startupExit = await startupExited;
    }
    const startupExitCode = startupExit.code;
    const evidence: DistServerRuntimeEvidence = {
      expectedVersion: packageJson.version,
      versionExitCode: version.status,
      versionOutput: version.stdout.trim(),
      startupExitCode,
      versionRouteStatus,
      versionRouteVersion,
      dashboardRouteStatus,
      dashboardRootPresent,
    };
    const failures = validateDistServerRuntimeEvidence(evidence);
    if (failures.length > 0) {
      const routeError = lastRouteError instanceof Error ? `; last route error: ${lastRouteError.message}` : "";
      throw new Error(`${failures.join("; ")}${routeError}; output=${startupOutput.trim().slice(0, 1_000)}`);
    }
    console.log(`packaged server runtime passed CLI, lazy HTTP, dashboard, and graceful-exit checks (${packageJson.version})`);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
