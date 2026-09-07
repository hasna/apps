import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../db/database.js";
import { resolveTelephonyClientTransport } from "./client-transport.js";
import { resetStore } from "./store/index.js";
import { dispatchWebhook } from "./webhooks.js";
import { isolateStoreEnv, snapshotStoreEnv } from "../../tests/support/hermetic-store-env.js";

// Every credential tier, the DB path and the data home are snapshotted once and
// restored after each test; the tests below point them at a temporary root so
// the machine's Keychain item or credentials file can never outrank the env
// key handed to the loopback stub (hasna/apps#1720).
const restoreEnv = snapshotStoreEnv();
const apiKeyEnvName = ["HASNA", "TELEPHONY", "API", "KEY"].join("_");

let tempRoot: string | undefined;

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for webhook dispatch");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "telephony-webhook-dispatch-test-"));
  isolateStoreEnv(tempRoot);
});

afterEach(() => {
  restoreEnv();
  resetStore();
  closeDatabase();
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("dispatchWebhook", () => {
  it("uses cloud dispatch targets when cloud-flipped, even with an empty local DB", async () => {
    let cloudRequests = 0;
    let targetHits = 0;
    let signatureConfigured = false;

    const target = Bun.serve({
      port: 0,
      async fetch(req) {
        targetHits += 1;
        signatureConfigured = Boolean(req.headers.get("x-webhook-signature"));
        await req.text();
        return new Response("ok");
      },
    });

    const cloud = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/v1/internal/webhook-dispatch-targets") {
          cloudRequests += 1;
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "cloud-webhook-1",
                  url: `http://127.0.0.1:${target.port}/hook`,
                  events: ["sms.inbound"],
                  secret_configured: true,
                  secret: "synthetic-signing-secret",
                  active: true,
                  created_at: new Date().toISOString(),
                },
              ],
              total: 1,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      },
    });

    try {
      process.env.HASNA_TELEPHONY_API_URL = `http://127.0.0.1:${cloud.port}`;
      process.env[apiKeyEnvName] = ["synthetic", "api", "key"].join("-");
      resetStore();
      // The synthetic env key is the credential the stub receives — not a
      // station key from a higher tier.
      expect(resolveTelephonyClientTransport(process.env).report.apiKeySource).toBe(apiKeyEnvName);

      await dispatchWebhook("sms.inbound", { id: "msg-1" });
      await waitFor(() => targetHits === 1);

      expect(cloudRequests).toBe(1);
      expect(targetHits).toBe(1);
      expect(signatureConfigured).toBe(true);
    } finally {
      cloud.stop(true);
      target.stop(true);
    }
  });
});
