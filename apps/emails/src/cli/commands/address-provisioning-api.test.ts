import { afterEach, expect, test } from "bun:test";
import { Command } from "commander";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { registerAddressCommands } from "./address.js";
import { registerProvisionCommands } from "./provision.js";
import { provisionAddress } from "../../lib/address-provisioning-api.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
import {
  handleSelfHostedRequest,
  type SelfHostedServiceDeps,
} from "../../server/self-hosted/service.js";
import {
  selfScopedStore,
  testAuthDeps,
} from "../../server/self-hosted/auth/test-support.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
const original = { ...process.env };
const originalExitCode = process.exitCode;
let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  for (const key of Object.keys(process.env))
    if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  resetSelfHostedConfigCache();
  process.exitCode = originalExitCode;
});
function fixture() {
  const secret = crypto.randomUUID();
  const token = mintApiKey({
    app: "emails",
    scopes: ["emails:*"],
    signingSecret: secret,
  }).token;
  const client = {
    query: async () => ({ rows: [], rowCount: 0 }),
    many: async () => [],
    get: async () => null,
    one: async () => ({}),
    execute: async () => {},
  } as TypedQueryClient;
  const store = selfScopedStore(client);
  let writes = 0;
  const inputs: any[] = [];
  const domain = {
    id: "domain",
    domain: "example.com",
    provider: "provider",
    status: "active",
    verified: true,
  };
  const job: any = {
    id: "job",
    kind: "address",
    status: "pending",
    lease: "private-lease",
    receipt: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  Object.assign(store, {
    resolveAddressProvisioning: async (input: any) => {
      inputs.push(input);
      return {
        input,
        domain,
        provider_id: "provider",
        provider_type: "ses",
        owner_id: null,
        administrator_id: null,
        address: null,
      };
    },
    startProvisioningJob: async (input: any) => {
      writes++;
      job.input = input;
      job.status = "pending";
      return job;
    },
    getProvisioningJob: async () => job,
    claimProvisioningJob: async () => job,
    getDomain: async () => domain,
    getResource: async () => ({ id: "provider", type: "ses", active: true }),
    completeAddressProvisioning: async (
      _job: any,
      _refs: any,
      receipt: any,
    ) => {
      writes++;
      return {
        ...job,
        status: "ready",
        receipt: { ...receipt, address_id: "address" },
      };
    },
    blockProvisioningJob: async (_job: any, receipt: any) => ({
      ...job,
      status: "blocked",
      receipt,
    }),
  });
  const sender = {
    provider: "ses" as const,
    region: "us-east-1",
    send: async () => {
      throw new Error("No mail");
    },
    verifyDomain: async () => ({
      verifiedForSending: true,
      dkim: "verified" as const,
      spf: "pending" as const,
      dmarc: "pending" as const,
    }),
    checkInboundDomain: async () => ({
      ready: true,
      reason: "fixture",
      topicArn: "fixture-topic",
    }),
    checkInboundQueue: async () => ({ ready: true, reason: "fixture" }),
  };
  const deps = {
    client,
    store,
    sender,
    resolveSender: () => sender,
    verifier: verifyApiKey({
      app: "emails",
      signingSecret: secret,
      keyStatus: async () => "active",
    }),
    migrations: [],
    version: "fixture",
    ...testAuthDeps(client, secret),
    provisioning: {
      resolveMx: async () => [
        { exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 },
      ],
    },
    env: {
      EMAILS_INGEST_S3_BUCKET: "fixture-bucket",
      EMAILS_INGEST_QUEUE_URL: "fixture-queue",
    },
  } as SelfHostedServiceDeps;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) =>
      (await handleSelfHostedRequest(deps, req)) ??
      new Response("not found", { status: 404 }),
  });
  delete process.env.EMAILS_DB_PATH;
  delete process.env.HASNA_EMAILS_DB_PATH;
  process.env.HASNA_EMAILS_API_URL = server.url.origin;
  process.env.EMAILS_SESSION_TOKEN = token;
  resetSelfHostedConfigCache();
  return { deps, inputs, writes: () => writes, secret, job, sender };
}
test("both CLI aliases execute the authenticated API and preserve provisioning flags", async () => {
  const f = fixture();
  for (const args of [
    ["address", "provision"],
    ["provision", "address"],
  ]) {
    const program = new Command();
    let output: any;
    registerAddressCommands(program, (data) => {
      output = data;
    });
    registerProvisionCommands(program, (data) => {
      output = data;
    });
    await program.parseAsync([
      "node",
      "emails",
      ...args,
      "new@example.com",
      "--provider",
      "provider",
      "--domain",
      "domain",
      "--receive",
      "ses-s3",
      "--owner",
      "owner",
      "--administrator",
      "admin",
      "--bucket",
      "fixture-bucket",
      "--wait",
      "--timeout",
      "2",
      "--interval",
      "1",
    ]);
    expect(output).toMatchObject({
      job: { status: "ready", receipt: { ready: true, address_id: "address" } },
    });
    expect(output.job.lease).toBeUndefined();
  }
  expect(f.inputs[0]).toMatchObject({
    email: "new@example.com",
    provider_id: "provider",
    domain_id: "domain",
    receive_strategy: "ses-s3",
    owner: "owner",
    administrator: "admin",
    inbound_bucket: "fixture-bucket",
  });
  expect(f.writes()).toBe(4);
});
test("dry-run performs no writes and optional blank selectors fail instead of widening scope", async () => {
  const f = fixture();
  const plan = await provisionAddress("new@example.com", {
    provider: "provider",
    dryRun: true,
  });
  expect(plan).toMatchObject({ dry_run: true, receipt: { ready: true } });
  expect(f.writes()).toBe(0);
  await expect(
    provisionAddress("new@example.com", { provider: "provider", domain: "" }),
  ).rejects.toThrow("nonempty");
  expect(f.writes()).toBe(0);
});
test("only operators can create, read or retry provisioning jobs; inputs cannot inject tenant or readiness", async () => {
  const f = fixture();
  for (const [path, method] of [
    ["/v1/provision/address", "POST"],
    ["/v1/provision/jobs/job", "GET"],
    ["/v1/provision/jobs/job/run", "POST"],
  ]) {
    const token = mintApiKey({
      app: "emails",
      scopes: ["emails:read", "emails:write"],
      signingSecret: f.secret,
    }).token;
    const response = await handleSelfHostedRequest(
      f.deps,
      new Request(`http://fixture${path}`, {
        method,
        headers: { "x-api-key": token, "Content-Type": "application/json" },
        ...(method !== "GET" ? { body: "{}" } : {}),
      }),
    );
    expect(response!.status).toBe(403);
  }
  const response = await fetch(new URL("/v1/provision/address", server!.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.EMAILS_SESSION_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "new@example.com",
      provider_id: "provider",
      tenant_id: "foreign",
      ready: true,
    }),
  });
  expect(response.status).toBe(400);
  expect(f.writes()).toBe(0);
});
test("wait timeout preserves a truthful blocked job receipt and can be inspected later", async () => {
  const f = fixture();
  f.sender.checkInboundQueue = async () => ({
    ready: false,
    reason: "Missing subscription",
  });
  const result = await provisionAddress("new@example.com", {
    provider: "provider",
    wait: true,
    timeout: 1,
    interval: 1,
  });
  expect(result).toMatchObject({
    timed_out: true,
    job: {
      id: "job",
      status: "blocked",
      receipt: { ready: false, code: "queue_not_ready" },
    },
  });
  expect(f.writes()).toBe(1);
});
