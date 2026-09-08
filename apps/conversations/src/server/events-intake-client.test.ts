import { expect, test } from "bun:test";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintApiKey } from "@hasna/contracts/auth";
import { resolveEventsIntake } from "./events-intake-client.js";

test("recorded target comes from the exact client snapshot during authority rotation", () => {
  const source = {
    tenant_id: randomUUID(),
    corpus_id: `cor_${randomUUID().replaceAll("-", "")}`,
    authority_id: "authority:fixture",
  };
  // Vary the rotation point across resolver reads. The ledger must never pair
  // an earlier independently resolved URL with a later client snapshot.
  const home = mkdtempSync(join(tmpdir(), "conversations-authority-fixture-"));
  let constructed = 0;
  try {
    for (let rotation = 1; rotation <= 20; rotation++) {
      let reads = 0;
      const env: Record<string, string | undefined> = {
        HOME: home,
        HASNA_HOME: join(home, ".hasna"),
        HASNA_STATION: `fixture-${randomUUID()}`,
        HASNA_CONVERSATIONS_EVENTS_SINK_ID: randomUUID(),
        HASNA_CONVERSATIONS_EVENTS_PRODUCER_ID: randomUUID(),
        HASNA_EVENTS_API_KEY_OVERRIDE: mintApiKey({
          app: "events", tid: source.tenant_id, scopes: ["events:receipts"], signingSecret: randomBytes(32),
        }).token,
        HASNA_EVENTS_API_URL: "http://127.0.0.1:31001",
      };
      const rotatingEnv = new Proxy(env, {
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          return key === "HASNA_EVENTS_API_URL" && descriptor
            ? { ...descriptor, value: ++reads <= rotation ? "http://127.0.0.1:31001" : "http://127.0.0.1:31002" }
            : descriptor;
        },
      });
      let resolved;
      try {
        resolved = resolveEventsIntake(source, rotatingEnv);
      } catch (error) {
        expect((error as Error).message).toBe("events_intake_not_configured");
        continue;
      }
      constructed++;
      expect(resolved.target.url).toBe(resolved.client.baseUrl);
      expect(Object.isFrozen(resolved.client)).toBe(true);
    }
    expect(constructed).toBeGreaterThan(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
