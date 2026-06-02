import { describe, it, expect } from "bun:test";
import { checkProvisioningCredentials } from "./creds-check.js";

describe("checkProvisioningCredentials", () => {
  it("detects AWS profile + Cloudflare global key + account", () => {
    const s = checkProvisioningCredentials({
      AWS_PROFILE: "hasna",
      HASNAXYZ_CLOUDFLARE_LIVE_API_KEY: "k", HASNAXYZ_CLOUDFLARE_LIVE_EMAIL: "a@b.com", CLOUDFLARE_ACCOUNT_ID: "acct",
    });
    const r53 = s.find((x) => x.provider === "route53")!;
    const cf = s.find((x) => x.provider === "cloudflare")!;
    expect(r53.configured).toBe(true);
    expect(r53.mode).toBe("profile:hasna");
    expect(cf.configured).toBe(true);
    expect(cf.mode).toContain("global-key");
    expect(cf.mode).toContain("account");
  });

  it("flags missing cloudflare account id", () => {
    const s = checkProvisioningCredentials({ CLOUDFLARE_API_TOKEN: "t" });
    const cf = s.find((x) => x.provider === "cloudflare")!;
    expect(cf.configured).toBe(true);
    expect(cf.detail).toMatch(/ACCOUNT_ID/);
  });

  it("reports brandsight gated regardless", () => {
    const s = checkProvisioningCredentials({});
    expect(s.find((x) => x.provider === "brandsight")!.detail).toMatch(/gated|enterprise/);
  });
});
