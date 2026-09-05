// Live conformance test: drives the domains REPOSITORY (createDomain/getDomain/
// listDomains/deleteDomain) with the client pointed at a self-hosted API, proving
// the repo layer routes reads+writes to the selfHosted HTTP API. Skips cleanly
// when the self-hosted env is not configured.
//
// Enable by exporting (deployment modes are removed — hasna/apps#1566 — so the
// API origin and credential alone select the arm):
//   EMAILS_SELF_HOSTED_URL=https://emails.example
//   EMAILS_SELF_HOSTED_API_KEY=<key>

import { describe, expect, test } from "bun:test";
import { createDomain, deleteDomain, getDomain, getDomainByName, listDomains } from "./domains.js";
import { resetSelfHostedConfigCache } from "./self-hosted-store.js";

// The live lane must be unambiguous: an API origin with a credential, and no
// database path that would make storage configuration contradict itself.
const HAS_CLOUD =
  Boolean(process.env.EMAILS_SELF_HOSTED_URL) &&
  Boolean(process.env.EMAILS_SELF_HOSTED_API_KEY) &&
  !Boolean(process.env.EMAILS_DB_PATH || process.env.HASNA_EMAILS_DB_PATH);

const maybe = HAS_CLOUD ? test : test.skip;

describe("live selfHosted domains CRUD via repository (self_hosted)", () => {
  maybe("create -> get -> list -> delete round-trips against the selfHosted API", () => {
    resetSelfHostedConfigCache();
    const name = `live-repo-probe-${Date.now()}.example.com`;

    const created = createDomain("selfHosted", name);
    expect(created.id).toBeTruthy();
    expect(created.domain).toBe(name);

    const fetched = getDomain(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.domain).toBe(name);

    const byName = getDomainByName("selfHosted", name);
    expect(byName?.id).toBe(created.id);

    const listed = listDomains();
    expect(listed.some((dm) => dm.id === created.id)).toBe(true);

    const deleted = deleteDomain(created.id);
    expect(deleted).toBe(true);
    expect(getDomain(created.id)).toBeNull();
  });
});
