import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { hashBearerToken } from "../src/auth";
import type { AuthorizationContext, InstallPolicyRule } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { createApp } from "../src/server";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function rulesForGeneration(generation: number): InstallPolicyRule[] {
  return [{ effect: "deny", packagePatterns: [`policy-generation-${generation}`] }];
}

function setupGenerationSeven(): {
  admin: AuthorizationContext;
  computerId: string;
  owner: AuthorizationContext;
  reader: SQLiteStorage;
  writer: SQLiteStorage;
  writerService: ComputersService;
} {
  const directory = mkdtempSync(join(process.cwd(), ".test-data-policy-read-"));
  directories.push(directory);
  const database = join(directory, "controller.db");
  const writer = new SQLiteStorage(database);
  writer.migrate();
  const writerService = new ComputersService(writer, {
    ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)),
  });
  const admin: AuthorizationContext = {
    tenantId: "tenant_policy_read", principalId: "principal_policy_admin", scopes: ["computers:admin"], authMethod: "bearer",
  };
  const computer = writerService.createComputer(admin, {
    slug: "policy-read-race", provider: "local_machine", ownerPrincipalId: "principal_policy_owner", idempotencyKey: "policy-read-create",
  });
  for (let generation = 2; generation <= 7; generation += 1) {
    expect(writerService.createInstallPolicy(admin, computer.id, rulesForGeneration(generation)).generation).toBe(generation);
  }
  const reader = new SQLiteStorage(database);
  reader.migrate();
  return {
    admin,
    computerId: computer.id,
    owner: {
      tenantId: admin.tenantId,
      principalId: computer.ownerPrincipalId,
      scopes: ["computers:read"],
      boundComputerId: computer.id,
      policyGeneration: 7,
      authMethod: "bearer",
    },
    reader,
    writer,
    writerService,
  };
}

async function appFor(service: ComputersService, context: AuthorizationContext): Promise<{
  app: ReturnType<typeof createApp>;
  credential: string;
}> {
  const credential = randomBytes(32).toString("base64url");
  return {
    credential,
    app: createApp(service, { principals: [{ tokenHash: await hashBearerToken(credential), context }] }),
  };
}

function policyRequest(app: ReturnType<typeof createApp>, credential: string, computerId: string, requestId: string): Promise<Response> {
  return app(new Request(`http://127.0.0.1/v1/computers/${computerId}/install/policy`, {
    headers: { authorization: `Bearer ${credential}`, "x-request-id": requestId },
  }));
}

describe("generation-pinned install policy reads", () => {
  test("a generation-7 authorization cannot return generation 8 when another connection commits between resolution and lookup", async () => {
    const fixture = setupGenerationSeven();
    try {
      const generationSeven = fixture.writer.getInstallPolicy(fixture.admin.tenantId, fixture.computerId, 7);
      expect(generationSeven).toBeDefined();
      let commitGenerationEight = true;
      const synchronizedReader = new Proxy(fixture.reader, {
        get(target, property) {
          if (property === "getComputer") {
            return (tenantId: string, computerId: string) => {
              const snapshot = target.getComputer(tenantId, computerId);
              if (commitGenerationEight && snapshot?.id === fixture.computerId) {
                commitGenerationEight = false;
                expect(snapshot.policyGeneration).toBe(7);
                expect(fixture.writerService.createInstallPolicy(
                  fixture.admin, fixture.computerId, rulesForGeneration(8),
                ).generation).toBe(8);
              }
              return snapshot;
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const service = new ComputersService(synchronizedReader, {
        ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)),
      });
      const { app, credential } = await appFor(service, fixture.owner);

      const raced = await policyRequest(app, credential, fixture.computerId, "req_policy_read_race");
      expect({ status: raced.status, body: await raced.json() }).toEqual({ status: 200, body: generationSeven });

      const stale = await policyRequest(app, credential, fixture.computerId, "req_policy_read_stale");
      expect({ status: stale.status, body: await stale.json() }).toEqual({
        status: 403,
        body: { error: { code: "policy_generation_mismatch", message: "Authorization denied", requestId: "req_policy_read_stale" } },
      });
    } finally {
      fixture.reader.close();
      fixture.writer.close();
    }
  });

  test("a missing exact policy revision returns a bounded storage error instead of an empty 200", async () => {
    const fixture = setupGenerationSeven();
    try {
      let removePolicies = true;
      const synchronizedReader = new Proxy(fixture.reader, {
        get(target, property) {
          if (property === "getComputer") {
            return (tenantId: string, computerId: string) => {
              const snapshot = target.getComputer(tenantId, computerId);
              if (removePolicies && snapshot?.id === fixture.computerId) {
                removePolicies = false;
                fixture.writer.database.query("DELETE FROM install_policy_revisions WHERE tenant_id = ? AND computer_id = ?")
                  .run(fixture.admin.tenantId, fixture.computerId);
              }
              return snapshot;
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const service = new ComputersService(synchronizedReader, {
        ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)),
      });
      const { app, credential } = await appFor(service, fixture.owner);

      const response = await policyRequest(app, credential, fixture.computerId, "req_policy_read_missing");
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 500,
        body: JSON.stringify({ error: { code: "storage_error", message: "Internal server error", requestId: "req_policy_read_missing" } }),
      });
    } finally {
      fixture.reader.close();
      fixture.writer.close();
    }
  });
});
