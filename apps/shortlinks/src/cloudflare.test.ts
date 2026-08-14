import { describe, expect, test } from "bun:test";
import { createCloudflarePlan, generateWorkerScript } from "./cloudflare.js";
import { buildDomainsArgs } from "./domains-cli.js";

describe("integration helpers", () => {
  test("creates Cloudflare setup plans without secrets", () => {
    const plan = createCloudflarePlan({
      hostname: "has.na",
      target: "shortlinks.hasna.xyz",
      origin: "https://shortlinks.hasna.xyz",
      workerName: "shortlinks",
    });

    expect(plan.dnsRecord).toEqual({
      type: "CNAME",
      name: "has.na",
      content: "shortlinks.hasna.xyz",
      proxied: true,
    });
    expect(plan.wranglerCommand).toContain("wrangler deploy");
  });

  test("generates a worker that forwards host context to the origin", () => {
    const script = generateWorkerScript();
    expect(script).toContain("SHORTLINKS_ORIGIN");
    expect(script).toContain("x-forwarded-host");
    expect(script).toContain("redirect: \"manual\"");
  });

  test("uses the @hasna/domains CLI rather than connect packages", () => {
    expect(buildDomainsArgs("check", "has.na")).toEqual(["domain", "check", "has.na"]);
    expect(buildDomainsArgs("buy", "has.na")).toEqual(["domain", "buy", "has.na"]);
    expect(buildDomainsArgs("setup", "has.na")).toEqual(["domain", "setup", "has.na"]);
  });
});
