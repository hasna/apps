import { afterEach, beforeEach, expect, test } from "bun:test";
import { Command } from "commander";
import { registerProvisionCommands } from "./provision.js";
import {
  provisionUpBody,
  provisionUpSucceeded,
  runProvisionDaemon,
  runProvisionUp,
} from "../../lib/provision-up-api.js";
let original: NodeJS.ProcessEnv,
  exitCode: typeof process.exitCode,
  server: ReturnType<typeof Bun.serve> | undefined;
beforeEach(() => {
  original = { ...process.env };
  exitCode = process.exitCode;
});
afterEach(() => {
  server?.stop(true);
  server = undefined;
  for (const key of Object.keys(process.env))
    if (!Object.prototype.hasOwnProperty.call(original, key))
      delete process.env[key];
  Object.assign(process.env, original);
  process.exitCode = exitCode;
});
function fixture() {
  const calls: Array<{ path: string; body: any; auth: string | null }> = [],
    token = crypto.randomUUID();
  const job = {
    id: "run-1",
    status: "ready",
    input: {
      domain: "example.test",
      provider_id: "provider",
      addresses: ["one", "two"],
      test_count: 0,
      add_mx: false,
      force_mx_switch: false,
    },
    receipt: {
      phase: "complete",
      address_cursor: 2,
      dns: null,
      addresses: {},
      roundtrip: {
        run_id: "run-1",
        items: [],
        poll_cursor: 0,
        poll_pass: 0,
        preflight: false,
      },
      next_attempt_ms: 0,
      complete: true,
      delivery_tested: false,
      errors: [],
    },
    created_at: "fixture",
    updated_at: "fixture",
  };
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      calls.push({
        path,
        body: req.method === "POST" ? await req.json() : null,
        auth: req.headers.get("authorization"),
      });
      return Response.json(
        path.endsWith("/tick") ? { jobs: [job], advanced: 1 } : { job },
      );
    },
  });
  for (const key of Object.keys(process.env))
    if (/^(?:HASNA_EMAILS_|EMAILS_)/.test(key)) delete process.env[key];
  Object.assign(process.env, {
    HASNA_EMAILS_API_URL: `http://127.0.0.1:${server.port}/v1`,
    HASNA_EMAILS_API_KEY: token,
    EMAILS_CLIENT_ENV_LOADED: "1",
  });
  return { calls, token, job };
}
test("actual CLI up/daemon/retry/read use the shared API and preserve MX by default", async () => {
  const f = fixture(),
    out: any[] = [];
  for (const args of [
    ["up", "example.test", "--provider", "provider", "--no-test"],
    ["daemon", "--provider", "provider", "--once"],
    ["retry", "example.test", "--job", "run-1"],
    ["run", "run-1"],
  ]) {
    const program = new Command().exitOverride();
    registerProvisionCommands(program, (value) => out.push(value));
    await program.parseAsync(["provision", ...args], { from: "user" });
  }
  expect(f.calls.map((call) => call.path)).toEqual([
    "/v1/provision/up",
    "/v1/provision/tick",
    "/v1/provision/retry",
    "/v1/provision/runs/run-1",
  ]);
  expect(f.calls[0]!.body).toMatchObject({
    add_mx: false,
    force_mx_switch: false,
    count: 0,
  });
  expect(f.calls[2]!.body).toEqual({ domain: "example.test", job_id: "run-1" });
  expect(f.calls.every((call) => call.auth === `Bearer ${f.token}`)).toBe(true);
  expect(out).toHaveLength(4);
});
test("legacy purchase selectors and invalid inputs refuse before any API calls", async () => {
  const f = fixture();
  for (const options of [
    { buyIfNeeded: true },
    { purchaseProfile: "ambient" },
    { forceMxSwitch: true },
    { count: "-1" },
    { count: "101" },
    { provider: "" },
  ])
    await expect(
      runProvisionUp("example.test", { provider: "provider", ...options }),
    ).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
  const program = new Command();
  registerProvisionCommands(program, () => {});
  const up = program.commands[0]!.commands.find((cmd) => cmd.name() === "up")!;
  expect(up.helpInformation()).not.toContain("--buy-if-needed");
  expect(up.helpInformation()).not.toContain("--purchase-profile");
});
test("daemon filters are assertions and interrupting a wait prevents later ticks", async () => {
  const f = fixture(),
    controller = new AbortController();
  await expect(
    runProvisionDaemon(
      {
        provider: "provider",
        addMx: true,
        forceMxSwitch: true,
        bucket: "fixture-bucket",
        interval: "30",
      },
      controller.signal,
      () => controller.abort(),
    ),
  ).rejects.toThrow();
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.body).toEqual({
    provider_id: "provider",
    add_mx: true,
    force_mx_switch: true,
    bucket: "fixture-bucket",
  });
});
test("processing with an old completed receipt never reports success", () => {
  const f = fixture();
  expect(
    provisionUpSucceeded({ job: { ...f.job, status: "processing" } } as any),
  ).toBe(false);
  expect(
    provisionUpBody("example.test", { provider: "provider", count: "0" }),
  ).toMatchObject({ count: 0, add_mx: false });
});
test("account changes between daemon ticks stop before another request", async () => {
  const f = fixture(),
    controller = new AbortController();
  await expect(
    runProvisionDaemon(
      { provider: "provider", interval: "1", maxTicks: "2" },
      controller.signal,
      () => {
        process.env.HASNA_EMAILS_API_KEY = crypto.randomUUID();
      },
    ),
  ).rejects.toThrow("account configuration changed");
  expect(f.calls).toHaveLength(1);
});
