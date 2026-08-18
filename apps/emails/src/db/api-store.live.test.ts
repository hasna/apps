// Live conformance test: drives the domains REPOSITORY (createDomain/getDomain/
// listDomains/deleteDomain) with the client flipped to api, proving the
// repo layer routes reads+writes to the api HTTP API. Skips cleanly when the
// api env is not configured.
//
// Enable by exporting:
//   HASNA_EMAILS_API_URL=https://emails.example
//   HASNA_EMAILS_API_KEY=<key>

import { describe, expect, test } from "bun:test";
import { createDomain, deleteDomain, getDomain, getDomainByName, listDomains } from "./domains.js";
import { resetApiConfigCache } from "./api-store.js";

const HAS_API =
  Boolean(process.env.HASNA_EMAILS_API_URL) &&
  Boolean(process.env.HASNA_EMAILS_API_KEY);

const maybe = HAS_API ? test : test.skip;

describe("live api domains CRUD via repository (api)", () => {
  maybe("create -> get -> list -> delete round-trips against the API client", () => {
    resetApiConfigCache();
    const name = `live-repo-probe-${Date.now()}.example.com`;

    const created = createDomain("api", name);
    expect(created.id).toBeTruthy();
    expect(created.domain).toBe(name);

    const fetched = getDomain(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.domain).toBe(name);

    const byName = getDomainByName("api", name);
    expect(byName?.id).toBe(created.id);

    const listed = listDomains();
    expect(listed.some((dm) => dm.id === created.id)).toBe(true);

    const deleted = deleteDomain(created.id);
    expect(deleted).toBe(true);
    expect(getDomain(created.id)).toBeNull();
  });
});
