import { expect, test } from "bun:test";
import { domainDnsSucceeded, type DomainDnsReceipt } from "./domain-dns-api.js";

test("only completed DNS receipts or actual dry-run plans report command success", () => {
  const receipt: DomainDnsReceipt = {
    dry_run: false,
    job: {
      id: "fixture",
      domain: "example.test",
      provider_id: "provider",
      zone_id: "zone",
      status: "processing",
      phase: "resolve",
      dns_published: true,
      verified_for_sending: true,
      requires_reconciliation: false,
      plan: null,
      message: "Prior receipt while the current job processes",
    },
  };
  expect(domainDnsSucceeded(receipt)).toBe(false);
  expect(domainDnsSucceeded(receipt, true)).toBe(false);
  receipt.job.status = "pending_verification";
  receipt.job.verified_for_sending = false;
  expect(domainDnsSucceeded(receipt)).toBe(true);
  expect(domainDnsSucceeded(receipt, true)).toBe(false);
  receipt.job.status = "verified";
  receipt.job.verified_for_sending = true;
  expect(domainDnsSucceeded(receipt, true)).toBe(true);
  receipt.dry_run = true;
  receipt.job.status = "blocked";
  expect(domainDnsSucceeded(receipt)).toBe(false);
  receipt.job.status = "planned";
  expect(domainDnsSucceeded(receipt)).toBe(true);
});
