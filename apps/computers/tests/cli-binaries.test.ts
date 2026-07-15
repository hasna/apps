import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

async function run(entry: string, args: string[] = [], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(["bun", entry, ...args], { stdout: "pipe", stderr: "pipe", env: { ...Bun.env, ...env } });
  const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { code, stdout, stderr };
}

describe("CLI and binary envelopes", () => {
  test("help and unsupported commands use stable stdout/stderr/exit contracts", async () => {
    const help = await run("src/bin/computers.ts", ["--help"]);
    expect(help.code).toBe(0); expect(help.stderr).toBe(""); expect(help.stdout).toContain("Requests return a truthful pending operation");
    const directory = mkdtempSync(join(process.cwd(), ".test-data-cli-")); directories.push(directory);
    const unsupported = await run("src/bin/computers.ts", ["unsupported", "--db", join(directory, "unsupported.db")]);
    expect(unsupported.code).toBe(2); expect(unsupported.stdout).toBe("");
    expect(JSON.parse(unsupported.stderr)).toEqual({ error: { code: "unsupported_operation", message: "Unsupported command" } });
  });

  test("create is pending until worker records a truthful unconfigured-provider failure", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-cli-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const created = await run("src/bin/computers.ts", ["computer", "create", "--db", database, "--slug", "cli-pending", "--provider", "local_machine", "--idempotency-key", "cli-pending-create"]);
    expect(created.code).toBe(0); expect(created.stderr).toBe("");
    const payload = JSON.parse(created.stdout) as { computer: { id: string; status: string }; operation: { status: string } };
    expect(payload.computer.status).toBe("provisioning"); expect(payload.operation.status).toBe("pending");
    const worker = await run("src/bin/computers-worker.ts", [], { COMPUTERS_DB: database, COMPUTERS_TENANT: "tenant_local" });
    expect(worker.code).toBe(0); expect(worker.stderr).toBe("");
    expect(JSON.parse(worker.stdout)).toEqual({ handled: 1, providerAdaptersConfigured: false });
    const status = await run("src/bin/computers.ts", ["computer", "status", "--db", database, "--id", payload.computer.id]);
    const observed = JSON.parse(status.stdout) as { computer: { status: string }; operations: Array<{ status: string; errorCode: string }> };
    expect(observed.computer.status).toBe("error");
    expect(observed.operations[0]).toMatchObject({ status: "failed", errorCode: "provider_not_configured" });
  });

  test("policy and startup failures are generic structured envelopes without raw exceptions", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-cli-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const created = await run("src/bin/computers.ts", ["computer", "create", "--db", database, "--slug", "cli-policy", "--provider", "local_machine", "--idempotency-key", "cli-policy-create"]);
    const computerId = (JSON.parse(created.stdout) as { computer: { id: string } }).computer.id;
    const policy = await run("src/bin/computers.ts", ["policies", "set", "--db", database, "--computer", computerId, "--rules", JSON.stringify([{ effect: "maybe" }])]);
    expect(policy.code).toBe(2); expect(policy.stdout).toBe("");
    expect(JSON.parse(policy.stderr)).toEqual({ error: { code: "invalid_request", message: "Invalid install policy" } });
    expect(policy.stderr).not.toContain("TypeError");

    const malformedDatabase = join(directory, "malformed-auth.db");
    const serve = await run("src/bin/computers-serve.ts", [], { COMPUTERS_AUTH: "{", COMPUTERS_DB: malformedDatabase });
    expect(serve.code).toBe(1); expect(serve.stdout).toBe("");
    expect(JSON.parse(serve.stderr)).toEqual({ error: { code: "configuration_error", message: "Controller configuration is invalid" } });
    expect(existsSync(malformedDatabase)).toBe(false);
    const mcp = await run("src/bin/computers-mcp.ts");
    expect(mcp.code).toBe(1); expect(mcp.stdout).toBe("");
    expect(JSON.parse(mcp.stderr)).toEqual({ error: { code: "configuration_error", message: "MCP controller configuration is invalid" } });
    const resident = await run("src/bin/computers-resident.ts");
    expect(resident.code).toBe(1); expect(resident.stderr).toBe("");
    expect(JSON.parse(resident.stdout)).toMatchObject({ ready: false, mtlsTransport: false, privilegedDaemon: false });
  });

  test("MCP stdio emits one JSON-RPC frame per response and no notification response", async () => {
    const process = Bun.spawn(["bun", "src/bin/computers-mcp.ts"], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...Bun.env, COMPUTERS_API_URL: "http://127.0.0.1:7788" },
    });
    process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: { roots: { listChanged: true } }, clientInfo: { name: "stdio-test", version: "1" } } })}\n`);
    process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping", params: {} })}\n`);
    process.stdin.end();
    const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    expect(code).toBe(0); expect(stderr).toBe("");
    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line) as { id: number; jsonrpc: string });
    expect(lines).toHaveLength(2); expect(lines.map((line) => line.id)).toEqual([1, 2]);
    expect(lines.every((line) => line.jsonrpc === "2.0")).toBe(true);
  });
});
