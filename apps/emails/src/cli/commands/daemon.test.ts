// Self-hosted-ONLY.
//
// These commands used to refuse outright. They are not server-only:
//   • `daemon status` reads the provisioning queue from the SAME paged status facts
//     `emails status` reports (`/v1/domains` + `/v1/addresses` — NOT
//     `/v1/provisioning`, which holds only the audit trail), so its counts carry an
//     availability record and render as `≥N` when the read could not be completed.
//   • `daemon restart` reports that no supervisor is configured, which is a
//     statement about THIS process, not about the server — so it makes no request.
//   • `logs tail` reads tenant-scoped API lifecycle events without claiming worker liveness.
//
// The tests drive the REAL commands against an out-of-process /v1 stub, with a
// temporary HOME so the log tail can never read (or create) anything in the
// operator's real data directory.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startV1Stub, type V1Stub, type V1StubResources } from "../../test-support/v1-stub.js";
import { registerDaemonCommands } from "./daemon.remote.js";

let stub: V1Stub;
let home: string;
let priorHome: string | undefined;

beforeAll(async () => {
  stub = await startV1Stub();
});
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
  home = mkdtempSync(join(tmpdir(), "emails-daemon-home-"));
  priorHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  stub.clearEnv();
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  rmSync(home, { recursive: true, force: true });
});

async function runDaemon(args: string[]) {
  const program = new Command();
  program.exitOverride();
  let data: unknown;
  const out: string[] = [];
  registerDaemonCommands(program, (payload, formatted) => {
    data = payload;
    out.push(String(formatted ?? ""));
  });
  await program.parseAsync(["node", "emails", ...args]);
  return { data, output: out.join("\n") };
}

describe("daemon status reads the provisioning queue over /v1", () => {
  it("counts due and failed provisioning work instead of refusing", async () => {
    // The queue is derived from the provisioning lifecycle columns the domain and
    // address resources carry (the deleted HTTP arm's `dueRows`), so seed
    // those rows rather than a synthetic queue table.
    await stub.seed({
      domains: [
        { id: "dom-due", domain: "due.example.com", provisioning_status: "pending", next_check_at: "2020-01-01T00:00:00.000Z" },
        { id: "dom-failed", domain: "failed.example.com", provisioning_status: "failed" },
        { id: "dom-done", domain: "done.example.com", provisioning_status: "ready", next_check_at: "2020-01-01T00:00:00.000Z" },
      ],
      addresses: [
        { id: "addr-failed", email: "broken@failed.example.com", provisioning_status: "failed" },
      ],
    } as V1StubResources);

    const { data, output } = await runDaemon(["daemon", "status"]);
    const status = data as {
      queue: {
        availability: { available: boolean; complete: boolean | null };
        domains_pending: number | null;
        domains_failed: number | null;
        addresses_failed: number | null;
        due_derivable: boolean;
        drainable: boolean;
      };
    };

    expect(status.queue.domains_pending).toBe(1);
    expect(status.queue.domains_failed).toBe(1);
    expect(status.queue.addresses_failed).toBe(1);
    expect(status.queue.drainable).toBe(false);
    // The counts come from the PAGED status-facts read, so they arrive with an
    // availability record. Without it a caller cannot tell a total from a floor.
    expect(status.queue.availability.available).toBe(true);
    expect(status.queue.availability.complete).toBe(true);
    expect(output).not.toContain("not available in the self-hosted client");
  });

  // The reason this command stopped calling getProvisioningWorkSummary(): that read
  // is a single `list({ limit: 1000 })`, clamped to 500 server-side, and it published
  // the result as an exact count. `emails status` reports the same data as a lower
  // bound when it cannot walk the table; the daemon view has to agree.
  it("never labels a count 'due' when only 'pending' was measured", async () => {
    const { data, output } = await runDaemon(["daemon", "status"]);
    const status = data as { queue: Record<string, unknown> };

    expect(status.queue).not.toHaveProperty("due_domains");
    expect(status.queue).not.toHaveProperty("due_addresses");
    expect(status.queue["due_derivable"]).toBe(false);
    expect(output).toContain("No schedule-aware 'due now' count is derivable over /v1");
  });

  it("reports the realtime queue as unavailable rather than as 'not configured'", async () => {
    // This status read does not poll the queue; unavailable is not evidence
    // that the server binding is absent or a separate watcher is stopped.
    const { data, output } = await runDaemon(["daemon", "status"]);
    const status = data as { realtime: { queue_configured: boolean | null } };

    expect(status.realtime.queue_configured).toBeNull();
    expect(output).toContain("unavailable");
    expect(output).not.toContain("not configured");
  });

  it("offers the foreground API watcher with explicit binding and operator requirements", async () => {
    const { data, output } = await runDaemon(["daemon", "status"]);
    const status = data as { start_commands: Record<string, string>; start_requirements: string };
    expect(status.start_commands.inbound).toBe("emails inbox watch --source <source-id>");
    expect(status.start_requirements).toContain("operator credential");
    expect(status.start_requirements).toContain("server ingest binding");
    expect(output).toContain("does not establish a separate worker heartbeat");
    expect(output).not.toContain("self-hosted server");
  });
});

describe("daemon restart reports this process, not the server", () => {
  it("states that no supervisor is configured", async () => {
    const { data, output } = await runDaemon(["daemon", "restart"]);
    const result = data as { managed_process: boolean; cli_equivalent: string };

    expect(result.managed_process).toBe(false);
    expect(result.cli_equivalent).toBe("emails daemon status --json");
    expect(output).not.toContain("not available in the self-hosted client");
  });
});

describe("logs tail reads tenant API lifecycle events", () => {
  async function api(items: unknown[], run: () => Promise<void>) {
    const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch: request => {
      expect(request.headers.get("authorization")).toMatch(/^Bearer /);
      const url=new URL(request.url);expect(url.pathname).toBe("/v1/runtime/logs");
      return Response.json({scope:"tenant_api_operations",component:url.searchParams.get("component"),items,container_stdout:false,worker_liveness:"not_measured"});
    }});
    const previous=process.env.EMAILS_SELF_HOSTED_URL;process.env.EMAILS_SELF_HOSTED_URL=`http://127.0.0.1:${server.port}`;
    try{await run();}finally{server.stop(true);if(previous===undefined)delete process.env.EMAILS_SELF_HOSTED_URL;else process.env.EMAILS_SELF_HOSTED_URL=previous;}
  }
  it("renders API events with original component and line options", async () => {
    await api([{id:crypto.randomUUID(),request_id:crypto.randomUUID(),component:"scheduler",operation:"scheduled_run",event:"returned",http_status:200,created_at:"2026-09-07T00:00:00.000Z"}],async()=>{
      const {data,output}=await runDaemon(["logs","tail","--component","scheduler","--lines","2"]);
      expect(data).toMatchObject({scope:"tenant_api_operations",container_stdout:false});expect(output).toContain("scheduled_run  returned HTTP 200");expect(output).not.toContain("stopped");
    });
  });
  it("empty components do not claim a stopped worker",async()=>{
    await api([],async()=>{const {data,output}=await runDaemon(["logs","tail","--component","nightly"]);expect(data).toMatchObject({items:[],worker_liveness:"not_measured"});expect(output).toContain("not evidence that a worker is stopped");});
  });
  it("rejects invalid component and line inputs before transport",async()=>{
    const originalExit=process.exit,originalError=console.error;console.error=()=>{};process.exit=((code?:number)=>{throw Error(`process.exit:${code}`);}) as typeof process.exit;
    try{for(const args of [["--component","constructor"],["--component","__proto__"],["--lines","2x"],["--lines","501"]])await expect(runDaemon(["logs","tail",...args])).rejects.toThrow("process.exit:1");}
    finally{process.exit=originalExit;console.error=originalError;}
  });
});
