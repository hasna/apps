// Live conformance test: drives the domains REPOSITORY (createDomain/getDomain/
// listDomains/deleteDomain) with the client flipped to self-hosted, proving the
// repo layer routes reads+writes to the selfHosted HTTP API. Skips cleanly when the
// selfHosted env is not configured.
//
// Enable by exporting:
//   HASNA_EMAILS_API_URL=https://emails.example
//   HASNA_EMAILS_API_KEY=<key>

import { describe, expect, test } from "bun:test";
import { createDomain, deleteDomain, getDomain, getDomainByName, listDomains } from "./domains.js";
import { resetSelfHostedConfigCache } from "./self-hosted-store.js";

const HAS_API =
  Boolean(process.env.HASNA_EMAILS_API_URL) &&
  Boolean(process.env.HASNA_EMAILS_API_KEY);

const maybe = HAS_API ? test : test.skip;

describe("live selfHosted domains CRUD via repository (self-hosted)", () => {
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
