import { buildServer } from "../../mcp/server.js";
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
  process.exitCode = originalExitCode ?? 0;
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
    "/v1/domains/setup",
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

test("MCP provision_domain executes the authenticated DNS plan and rejects foreign bindings", async () => {
  const f = fixture();
  const mcp = buildServer() as unknown as {
    _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }>;
  };
  const handler = mcp._registeredTools.provision_domain!.handler;
  const result = await handler({ domain: "example.test", provider_id: "provider", dry_run: true, add_mx: true, mail_from: "mail" });
  expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.content[0]!.text)).toMatchObject({ dry_run: true, job: { status: "planned" } });
  expect(f.calls()).toBe(0);
  expect(f.resolved).toHaveLength(1);
  const blocked = await handler({ domain: "foreign.test", provider_id: "provider", dry_run: true });
  expect(blocked.isError).toBe(true);
  expect(f.calls()).toBe(0);
});

test("MCP does not turn an HTTP 200 blocked DNS receipt into success", async () => {
  fixture();
  server!.stop(true);
  server = Bun.serve({ port: 0, fetch: () => Response.json({
    dry_run: false, job: { id: "fixture-job", domain: "example.test", provider_id: "provider", zone_id: "zone",
      status: "blocked", phase: "resolve", dns_published: false, verified_for_sending: false,
      requires_reconciliation: false, plan: null, message: "Server binding changed" }
  }) });
  process.env.HASNA_EMAILS_API_URL = `http://127.0.0.1:${server.port}/v1`;
  const mcp = buildServer() as unknown as {
    _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }>;
  };
  const result = await mcp._registeredTools.provision_domain!.handler({ domain: "example.test", provider_id: "provider" });
  expect(result.isError).toBe(true);
  const payload = JSON.parse(result.content[0]!.text);
  expect(JSON.parse(payload.error.message).job.status).toBe("blocked");
});

test("owned domain setup works without purchase flags or PII, and skip-buy remains compatible",async()=>{
 const f=fixture(),results:any[]=[];
 for(const compatibility of [[],["--skip-buy"]]){
  const program=new Command().exitOverride();registerDomainCommands(program,value=>results.push(value));
  await program.parseAsync(["domain","setup","example.test","--provider","provider","--dry-run",...compatibility],{from:"user"});
  const command=program.commands.find(item=>item.name()==="domain")!.commands.find(item=>item.name()==="setup")!;
  expect(command.helpInformation()).toContain("already-owned");expect(command.helpInformation()).not.toContain("--email");expect(command.helpInformation()).not.toContain("--years");
 }
 expect(results).toHaveLength(2);expect(results[0]).toMatchObject({dry_run:true,job:{status:"planned",dns_published:false}});expect(f.calls()).toBe(0);expect(f.resolved).toHaveLength(2);
});
test("retired setup purchase inputs fail before any API work and never echo registrant values",async()=>{
 const f=fixture(),exit=process.exit,error=console.error;let messages:string[]=[];
 process.exit=(()=>{throw Error("captured exit");}) as typeof process.exit;console.error=(...parts:unknown[])=>{messages.push(parts.join(" "));};
 try{
  for(const flags of [["--email","private-fixture@example.test"],["--years","2"],["--phone","private-fixture-phone"],["--buy"]]){
   const program=new Command().exitOverride();registerDomainCommands(program,()=>{});
   await expect(program.parseAsync(["domain","setup","example.test","--provider","provider",...flags],{from:"user"})).rejects.toThrow("captured exit");
  }
 }finally{process.exit=exit;console.error=error;}
 expect(messages.join(" ")).toContain("domains route53 buy --help");expect(messages.join(" ")).not.toContain("private-fixture");expect(f.resolved).toHaveLength(0);expect(f.calls()).toBe(0);
});
test("owned setup cannot report success while verification is pending",async()=>{
 fixture();server!.stop(true);server=Bun.serve({port:0,fetch:()=>Response.json({dry_run:false,job:{id:"fixture-job",domain:"example.test",provider_id:"provider",zone_id:"zone",status:"pending_verification",phase:"dns_published",dns_published:true,verified_for_sending:false,requires_reconciliation:false,plan:null,message:"Pending provider verification"}})});
 process.env.HASNA_EMAILS_API_URL=`http://127.0.0.1:${server.port}/v1`;
 const program=new Command().exitOverride(),results:any[]=[];registerDomainCommands(program,value=>results.push(value));await program.parseAsync(["domain","setup","example.test","--provider","provider"],{from:"user"});expect(process.exitCode).toBe(1);expect(results[0].job.status).toBe("pending_verification");
});

test.each([404, 405])("older API HTTP %s cannot turn owned setup into a successful placeholder", async (status) => {
  fixture(); server!.stop(true);
  server = Bun.serve({port:0, fetch:()=>Response.json({error:"not_found",message:"Unknown route"},{status})});
  process.env.HASNA_EMAILS_API_URL=`http://127.0.0.1:${server.port}/v1`;
  const {setupOwnedDomain}=await import("../../lib/domain-dns-api.js");
  await expect(setupOwnedDomain("example.test",{provider:"provider"})).rejects.toThrow("API needs an update");
});
