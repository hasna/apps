import { afterEach, beforeEach, expect, test } from "bun:test";
import { Command } from "commander";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { registerDomainCommands } from "./domain.js";
import { registerProvisionCommands } from "./provision.js";
import { provisionSendingDomain } from "../../lib/domain-dns-api.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
import {
  handleSelfHostedRequest,
  type SelfHostedServiceDeps,
} from "../../server/self-hosted/service.js";
import {
  selfScopedStore,
  testAuthDeps,
} from "../../server/self-hosted/auth/test-support.js";
import { DEFAULT_TENANT_ID } from "../../server/self-hosted/migrations.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
let original: NodeJS.ProcessEnv,
  originalExitCode: typeof process.exitCode,
  server: ReturnType<typeof Bun.serve> | undefined;
beforeEach(() => {
  original = { ...process.env };
  originalExitCode = process.exitCode;
});
afterEach(() => {
  server?.stop(true);
  server = undefined;
  for (const key of Object.keys(process.env))
    if (!Object.prototype.hasOwnProperty.call(original, key))
      delete process.env[key];
  Object.assign(process.env, original);
  resetSelfHostedConfigCache();
  process.exitCode = originalExitCode;
});
function fixture() {
  const secret = crypto.randomUUID(),
    token = mintApiKey({
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
  const store = selfScopedStore(client),
    resolved: any[] = [];
  let calls = 0;
  Object.assign(store, {
    resolveDomainConnect: async (input: any) => {
      resolved.push(input);
      return { input, provider_type: "ses", domain: null };
    },
    domainDnsJobs: () => {
      calls++;
      throw new Error("dry run must not write");
    },
  });
  const sender = {
    provider: "ses" as const,
    region: "eu-west-1",
    send: async () => {
      throw new Error("No mail");
    },
    registerDomain: async () => {
      calls++;
    },
    setMailFrom: async () => {
      calls++;
      return "mail.example.test";
    },
    readDomainConnection: async () => {
      calls++;
      return { registered: false, verified_for_sending: false, dns_tasks: [] };
    },
  };
  const deps = {
    client,
    store,
    resolveSender: () => sender,
    verifier: verifyApiKey({
      app: "emails",
      signingSecret: secret,
      keyStatus: async () => "active",
    }),
    migrations: [],
    version: "fixture",
    ...testAuthDeps(client, secret),
    env: {
      EMAILS_DNS_BINDINGS: JSON.stringify([
        {
          tenant_id: DEFAULT_TENANT_ID,
          provider_id: "provider",
          domain: "example.test",
          zone_id: "a".repeat(32),
          zone_name: "example.test",
          token_env: "FIXTURE_DNS_TOKEN",
          inbound_mx: "inbound-smtp.eu-west-1.amazonaws.com",
        },
      ]),
      FIXTURE_DNS_TOKEN: crypto.randomUUID(),
    },
  } as unknown as SelfHostedServiceDeps;
  server = Bun.serve({
    port: 0,
    fetch: async (request) =>
      (await handleSelfHostedRequest(deps, request)) ??
      new Response("missing", { status: 404 }),
  });
  for (const key of Object.keys(process.env))
    if (/^(?:HASNA_EMAILS_|EMAILS_)/.test(key)) delete process.env[key];
  Object.assign(process.env, {
    HASNA_EMAILS_API_URL: `http://127.0.0.1:${server.port}/v1`,
    HASNA_EMAILS_API_KEY: token,
    EMAILS_CLIENT_ENV_LOADED: "1",
  });
  resetSelfHostedConfigCache();
  return { secret, resolved, calls: () => calls };
}
test("actual setup-cloudflare and provision domain CLI commands share authenticated dry-run plans without provider calls", async () => {
  const f = fixture(),
    results: any[] = [],
    program = new Command().exitOverride();
  registerDomainCommands(program, (value) => results.push(value));
  registerProvisionCommands(program, (value) => results.push(value));
  await program.parseAsync(
    [
      "domain",
      "setup-cloudflare",
      "example.test",
      "--provider",
      "provider",
      "--register-ses",
      "--mx",
      "--mx-server",
      "inbound-smtp.eu-west-1.amazonaws.com",
      "--force-mx-switch",
      "--dry-run",
    ],
    { from: "user" },
  );
  await program.parseAsync(
    [
      "provision",
      "domain",
      "example.test",
      "--provider",
      "provider",
      "--mail-from",
      "mail",
      "--add-mx",
      "--dry-run",
    ],
    { from: "user" },
  );
  expect(results).toHaveLength(2);
  for (const result of results)
    expect(result).toMatchObject({
      dry_run: true,
      job: { id: null, status: "planned", dns_published: false },
    });
  expect(f.calls()).toBe(0);
  expect(f.resolved).toHaveLength(2);
  expect(
    program.commands
      .find((command) => command.name() === "domain")!
      .commands.find((command) => command.name() === "setup-cloudflare")!
      .options.map((option) => option.long),
  ).not.toContain("--cloudflare-token");
});
test("ordinary writers cannot publish DNS or inspect operator receipts; foreign bindings refuse dry-run", async () => {
  const f = fixture();
  const key = mintApiKey({
    app: "emails",
    scopes: ["emails:write"],
    signingSecret: f.secret,
  }).token;
  for (const path of [
    "/v1/domains/setup-cloudflare",
    "/v1/domains/provision",
  ]) {
    const response = await fetch(`http://127.0.0.1:${server!.port}${path}`, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "example.test",
        provider_id: "provider",
        dry_run: true,
      }),
    });
    expect(response.status).toBe(403);
  }
  const reader = mintApiKey({
    app: "emails",
    scopes: ["emails:read"],
    signingSecret: f.secret,
  }).token;
  expect(
    (
      await fetch(
        `http://127.0.0.1:${server!.port}/v1/domain-dns-jobs/fixture-job`,
        { headers: { "x-api-key": reader } },
      )
    ).status,
  ).toBe(403);
  await expect(
    provisionSendingDomain("foreign.test", {
      provider: "provider",
      dryRun: true,
    }),
  ).rejects.toThrow();
  expect(f.calls()).toBe(0);
});
test("a changed API account stops a pending verification loop before another request", async () => {
  fixture();
  server!.stop(true);
  let requests = 0;
  server = Bun.serve({
    port: 0,
    fetch: () => {
      requests++;
      process.env.HASNA_EMAILS_API_KEY = crypto.randomUUID();
      return Response.json({
        dry_run: false,
        job: {
          id: "job",
          domain: "example.test",
          provider_id: "provider",
          zone_id: "zone",
          status: "pending_verification",
          phase: "complete",
          dns_published: true,
          verified_for_sending: false,
          requires_reconciliation: false,
          plan: null,
          message: "Pending",
        },
      });
    },
  });
  process.env.HASNA_EMAILS_API_URL = `http://127.0.0.1:${server.port}/v1`;
  await expect(
    provisionSendingDomain("example.test", {
      provider: "provider",
      wait: true,
      timeout: "7",
    }),
  ).rejects.toThrow("configuration changed");
  expect(requests).toBe(1);
}, 10000);
