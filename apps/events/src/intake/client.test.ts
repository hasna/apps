import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintApiKey } from "@hasna/contracts/auth";
import { createIntakeClient, INTAKE_PROTOCOL } from "./client.js";

test("the immutable authority comes from the same transport and a later authority rotation never dispatches", async () => {
  const home = mkdtempSync(join(tmpdir(), "events-authority-fixture-"));
  const binding = { sink_id: randomUUID(), producer_id: randomUUID(), corpus_id: `cor_${randomUUID().replaceAll("-", "")}`, source_authority_id: "authority:fixture.v1" };
  const tenant = randomUUID();
  const key = () => mintApiKey({ app: "events", tid: tenant, scopes: ["events:receipts"], signingSecret: randomBytes(32) });
  let callsA = 0, callsB = 0;
  const result = () => Response.json({ protocol: INTAKE_PROTOCOL, ...binding, tenant_id: tenant, kid: "fixture-key" });
  const a = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { callsA++; return result(); } });
  const b = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { callsB++; return result(); } });
  try {
    const env = { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: `fixture-${randomUUID()}`,
      HASNA_EVENTS_API_URL: a.url.origin, HASNA_EVENTS_API_KEY_OVERRIDE: key().token };
    const client = createIntakeClient({ binding, tenantId: tenant, env });
    expect(new URL(client.baseUrl).origin).toBe(a.url.origin);
    expect(Object.isFrozen(client)).toBe(true);
    expect(Reflect.set(client, "baseUrl", b.url.origin)).toBe(false);
    const readonlyType = () => {
      // @ts-expect-error A producer cannot rewrite the exposed captured authority.
      client.baseUrl = b.url.origin;
    };
    void readonlyType;
    await client.capability();
    env.HASNA_EVENTS_API_KEY_OVERRIDE = key().token;
    await client.capability(); // Credential rotation at the same authority still works.
    expect(callsA).toBe(2);
    env.HASNA_EVENTS_API_URL = b.url.origin;
    await expect(client.capability()).rejects.toThrow("authority changed");
    expect(callsA).toBe(2);
    expect(callsB).toBe(0);
    expect(new URL(client.baseUrl).origin).toBe(a.url.origin);
  } finally { a.stop(true); b.stop(true); rmSync(home, { recursive: true, force: true }); }
});
