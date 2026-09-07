import { afterEach, beforeEach, expect, test } from "bun:test";
import { Command } from "commander";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { registerDomainCommands } from "./domain.js";
import { connectDomain } from "../../lib/domain-connect-api.js";
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
let original: NodeJS.ProcessEnv;
let originalExitCode: typeof process.exitCode;
beforeEach(() => {
  original = { ...process.env };
  originalExitCode = process.exitCode;
});
let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
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
  const store = selfScopedStore(client);
  let registered = false,
    writes = 0,
    reads = 0,
    registrations = 0;
  const inputs: any[] = [];
  Object.assign(store, {
    resolveDomainConnect: async (input: any) => ({
      input,
      provider_type: "ses",
      domain: null,
    }),
    claimDomainConnect: async (input: any) => {
      writes++;
      inputs.push(input);
      return {
        id: "connection",
        lease: "private-lease",
        input,
        provider_type: "ses",
      };
    },
    domainConnectLeaseCurrent: async () => true,
    completeDomainConnect: async (_claim: any, result: any) => {
      writes++;
      return {
        ...result,
        connection: { ...result.connection, domain_id: "domain" },
      };
    },
    blockDomainConnect: async () => {
      writes++;
    },
    getDomainConnection: async () => null,
  });
  const sender = {
    provider: "ses" as const,
    send: async () => {
      throw new Error("no mail");
    },
    registerDomain: async () => {
      registrations++;
      registered = true;
    },
    readDomainConnection: async () => {
      reads++;
      return {
        registered,
        verified_for_sending: false,
        dns_tasks: registered
          ? [
              {
                type: "CNAME",
                name: "selector._domainkey.example.test",
                value: "fixture.dkim.example.test",
                purpose: "DKIM",
                status: "pending",
              },
            ]
          : [],
      };
    },
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
  return {
    deps,
    secret,
    sender,
    inputs,
    stats: () => ({ writes, reads, registrations }),
    token,
  };
}
test("both connect aliases use authenticated API and preserve requested DNS/registration flags", async () => {
  const f = fixture();
  for (const alias of ["domain", "domains"]) {
    const program = new Command();
    let output: any;
    registerDomainCommands(program, (data) => {
      output = data;
    });
    await program.parseAsync([
      "bun",
      "emails",
      alias,
      "connect",
      "example.test",
      "--provider",
      "provider",
      "--dns-provider",
      "route53",
      "--no-register-provider",
    ]);
    expect(output.connection).toMatchObject({
      domain: "example.test",
      dns_provider: "route53",
      register_provider: false,
      status: "pending_verification",
      provider_registered: false,
    });
  }
  expect(f.stats().registrations).toBe(0);
  expect(f.inputs).toHaveLength(2);
  const registered = await connectDomain("example.test", {
    provider: "provider",
    dnsProvider: "cloudflare",
  });
  expect(registered.connection).toMatchObject({
    provider_registered: true,
    status: "pending_verification",
  });
  expect(registered.connection.dns_tasks).toHaveLength(1);
  expect(f.stats().registrations).toBe(1);
});
test("dry run performs no provider calls or writes and rejects removed deployment metadata", async () => {
  const f = fixture();
  const result = await connectDomain("example.test", {
    provider: "provider",
    dryRun: true,
  });
  expect(result.connection.status).toBe("planned");
  expect(f.stats()).toEqual({ writes: 0, reads: 0, registrations: 0 });
  const response = await handleSelfHostedRequest(
    f.deps,
    new Request("http://fixture/v1/domains/connect", {
      method: "POST",
      headers: {
        authorization: `Bearer ${f.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        domain: "example.test",
        provider_id: "provider",
        domain_type: "local_only",
      }),
    }),
  );
  expect(response?.status).toBe(400);
  expect(f.stats().writes).toBe(0);
});
test("tenant data writers cannot register domains or read connection receipts", async () => {
  const f = fixture();
  const key = mintApiKey({
    app: "emails",
    scopes: ["emails:read", "emails:write"],
    signingSecret: f.secret,
  }).token;
  for (const [path, method] of [
    ["/v1/domains/connect", "POST"],
    ["/v1/domain-connections/connection", "GET"],
  ]) {
    const response = await handleSelfHostedRequest(
      f.deps,
      new Request(`http://fixture${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                domain: "example.test",
                provider_id: "provider",
              }),
            }
          : {}),
      }),
    );
    expect(response?.status).toBe(403);
  }
  expect(f.stats()).toEqual({ writes: 0, reads: 0, registrations: 0 });
});
test("unknown provider failures stay blocked and redact arbitrary provider details", async () => {
  const f = fixture();
  f.sender.registerDomain = async () => {
    throw new Error("PRIVATE_PROVIDER_DETAIL");
  };
  const result = await connectDomain("example.test", { provider: "provider" });
  expect(result.connection.status).toBe("blocked");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  expect(result.connection.id).toBe("connection");
});

test("missing or malformed provider DNS evidence yields blocked receipts without a publication success claim", async () => {
  const f = fixture();
  for (const dns_tasks of [
    [],
    [
      {
        type: "TXT",
        name: "selector._domainkey.example.test",
        value: "",
        purpose: "DKIM",
        status: "pending",
      },
    ],
  ]) {
    f.sender.readDomainConnection = async () =>
      ({ registered: true, verified_for_sending: false, dns_tasks }) as any;
    const result = await connectDomain("example.test", {
      provider: "provider",
    });
    expect(result.connection.status).toBe("blocked");
    expect(result.connection.message).toContain("DNS");
    expect(result.connection.message).not.toContain("Publish or merge");
  }
});
