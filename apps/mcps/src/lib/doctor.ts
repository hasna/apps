import { execFileSync } from "child_process";
import type { McpServerEntry } from "../types.js";
import { connectToServer, disconnectServer } from "./proxy.js";
import { assertLocalCommandConsent, type LocalCommandConsent } from "./local-command-consent.js";

export interface DoctorCheck {
  name: string;
  pass: boolean;
  message: string;
  fixable?: boolean;
  fixHint?: string;
}

export interface DoctorReport {
  server: McpServerEntry;
  checks: DoctorCheck[];
  healthy: boolean;
}

export async function diagnoseServer(
  server: McpServerEntry,
  options: { localCommandConsent?: LocalCommandConsent } = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  let hasLocalConsent = true;

  // 1. Command exists on PATH (for stdio servers)
  if (server.transport === "stdio") {
    try {
      assertLocalCommandConsent(
        {
          command: server.command,
          args: server.args,
          env: server.env,
          transport: server.transport,
          operation: "diagnose",
        },
        options.localCommandConsent,
      );
    } catch (err) {
      hasLocalConsent = false;
      checks.push({ name: "local command consent", pass: false, message: (err as Error).message });
    }

    try {
      const path = execFileSync("which", [server.command], { stdio: "pipe" }).toString().trim();
      let version = "";
      try {
        if (!hasLocalConsent) throw new Error("local stdio command approval is required before version probing");
        version = execFileSync(server.command, ["--version"], { stdio: "pipe" }).toString().trim().split("\n")[0];
      } catch {}
      checks.push({ name: "command on PATH", pass: true, message: `${path}${version ? ` (${version})` : ""}` });
    } catch {
      checks.push({
        name: "command on PATH",
        pass: false,
        message: `${server.command} not found on PATH`,
        fixable: true,
        fixHint: server.args[0] || server.command,
      });
    }
  }

  // 2. Required env vars — check if any env keys have empty values
  const missingEnv = Object.entries(server.env).filter(([, v]) => !v);
  if (Object.keys(server.env).length === 0) {
    checks.push({ name: "env vars", pass: true, message: "no env vars required" });
  } else if (missingEnv.length > 0) {
    checks.push({ name: "env vars", pass: false, message: `missing values for: ${missingEnv.map(([k]) => k).join(", ")}` });
  } else {
    checks.push({ name: "env vars", pass: true, message: `${Object.keys(server.env).length} env var(s) set` });
  }

  // 3. URL reachable (for SSE/HTTP servers)
  if (server.transport !== "stdio" && server.url) {
    try {
      const res = await fetch(server.url, { signal: AbortSignal.timeout(5000) });
      checks.push({ name: "URL reachable", pass: res.ok || res.status < 500, message: `HTTP ${res.status}` });
    } catch (err) {
      checks.push({ name: "URL reachable", pass: false, message: `unreachable: ${(err as Error).message}` });
    }
  }

  // 4. Can connect and list tools (with 10s timeout)
  if (server.enabled && hasLocalConsent) {
    try {
      await Promise.race([
        connectToServer(server, { localCommandConsent: options.localCommandConsent }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout after 10s")), 10000)),
      ]);
      await disconnectServer(server.id);
      checks.push({ name: "connect & list tools", pass: true, message: "connected successfully" });
    } catch (err) {
      checks.push({ name: "connect & list tools", pass: false, message: (err as Error).message });
    }
  } else if (!server.enabled) {
    checks.push({ name: "connect & list tools", pass: true, message: "skipped (server disabled)" });
  } else {
    checks.push({ name: "connect & list tools", pass: false, message: "skipped until local stdio command is approved" });
  }

  return {
    server,
    checks,
    healthy: checks.every((c) => c.pass),
  };
}
