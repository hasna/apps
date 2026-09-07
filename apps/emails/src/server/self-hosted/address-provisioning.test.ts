import { expect, test } from "bun:test";
import { runDomainOperation } from "./domain-operations.js";
import type { TenantScopedStore } from "./store.js";
import { normalizeAddressProvisioning } from "./address-provisioning.js";

test("receive strategy must be a string, not a coercible container", () => {
  expect(() =>
    normalizeAddressProvisioning({
      email: "one@example.test",
      provider_id: "provider",
      receive_strategy: ["ses-s3"],
    }),
  ).toThrow("Unknown receive strategy");
});

test("address planning can reuse fresh domain routing checks without changing stored readiness", async () => {
  let writes = 0;
  const domain = {
    id: "domain",
    domain: "example.test",
    provider: "provider",
    status: "active",
  };
  const store = {
    getDomain: async () => domain,
    getResource: async () => ({ type: "ses", active: true }),
    updateDomain: async () => {
      writes++;
      return domain;
    },
    applyDomainProvisioning: async () => {
      writes++;
      return domain;
    },
  } as unknown as TenantScopedStore;
  const result = await runDomainOperation(
    store,
    "tenant",
    "domain",
    "enable-inbound",
    {
      dryRun: true,
      env: {
        EMAILS_INGEST_S3_BUCKET: "fixture",
        EMAILS_INGEST_QUEUE_URL: "fixture",
      },
      mx: async () => [
        { exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 },
      ],
      resolveSender: () => ({
        provider: "ses",
        region: "us-east-1",
        send: async () => {
          throw new Error("no mail");
        },
        verifyDomain: async () => ({
          verifiedForSending: true,
          dkim: "verified",
          spf: "pending",
          dmarc: "pending",
        }),
        checkInboundDomain: async () => ({
          ready: true,
          reason: "checked",
          objectKeyPrefix: "incoming/",
        }),
      }),
    },
  );
  expect(result.inbound?.ready).toBe(true);
  expect(writes).toBe(0);
});
