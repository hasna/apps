import { describe, it, expect } from "bun:test";
import { checkProvisioningCredentials } from "./creds-check.js";

describe("checkProvisioningCredentials", () => {
  it("detects AWS profile + Cloudflare global key + account", () => {
    const s = checkProvisioningCredentials({
      AWS_PROFILE: "production-domains",
      CLOUDFLARE_API_KEY: "k", CLOUDFLARE_EMAIL: "a@b.com", CLOUDFLARE_ACCOUNT_ID: "acct",
    });
    const r53 = s.find((x) => x.provider === "route53")!;
    const cf = s.find((x) => x.provider === "cloudflare")!;
    expect(r53.configured).toBe(true);
    expect(r53.mode).toBe("profile:production-domains");
    expect(cf.configured).toBe(true);
    expect(cf.mode).toContain("global-key");
    expect(cf.mode).toContain("account");
  });

  it("detects Route53 aliases and AWS provider-chain credential modes", () => {
    const aliases = checkProvisioningCredentials({
      ROUTE53_ACCESS_KEY_ID: "ak",
      ROUTE53_SECRET_ACCESS_KEY: "sk",
    });
    expect(aliases.find((x) => x.provider === "route53")!).toMatchObject({
      configured: true,
      mode: "access-keys",
    });

    const webIdentity = checkProvisioningCredentials({
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/domain-role",
      AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/secrets/token",
    });
    expect(webIdentity.find((x) => x.provider === "route53")!).toMatchObject({
      configured: true,
      mode: "web-identity",
    });

    const container = checkProvisioningCredentials({
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/test",
    });
    expect(container.find((x) => x.provider === "route53")!).toMatchObject({
      configured: true,
      mode: "container-credentials",
    });
  });

  it("flags missing cloudflare account id", () => {
    const s = checkProvisioningCredentials({ CLOUDFLARE_API_TOKEN: "t" });
    const cf = s.find((x) => x.provider === "cloudflare")!;
    expect(cf.configured).toBe(true);
    expect(cf.detail).toMatch(/ACCOUNT_ID/);
  });

  it("reports brandsight gated with standard credentials", () => {
    const s = checkProvisioningCredentials({
      BRANDSIGHT_API_KEY: "k",
      BRANDSIGHT_API_SECRET: "s",
      BRANDSIGHT_CUSTOMER_ID: "c",
    });
    const bs = s.find((x) => x.provider === "brandsight")!;
    expect(bs.configured).toBe(true);
    expect(bs.mode).toBe("standard-env");
    expect(bs.detail).toMatch(/gated|enterprise/);
  });

  it("does not invent account-specific AWS providers", () => {
    const s = checkProvisioningCredentials({
      ACME_AWS_ACCESS_KEY_ID: "ak",
      ACME_AWS_SECRET_ACCESS_KEY: "sk",
    });
    expect(s.find((x) => x.provider === "route53")!.configured).toBe(false);
    expect(s.some((x) => x.provider.startsWith("aws:"))).toBe(false);
  });

  it("reports Namecheap and Sedo credential status", () => {
    const s = checkProvisioningCredentials({
      NAMECHEAP_API_KEY: "k",
      NAMECHEAP_USERNAME: "u",
      NAMECHEAP_CLIENT_IP: "127.0.0.1",
      SEDO_PARTNER_ID: "p",
      SEDO_API_KEY: "k",
      SEDO_USERNAME: "u@example.com",
      SEDO_PASSWORD: "pw",
    });
    expect(s.find((x) => x.provider === "namecheap")!.configured).toBe(true);
    const sedo = s.find((x) => x.provider === "sedo")!;
    expect(sedo.configured).toBe(true);
    expect(sedo.mode).toBe("standard-env");
    expect(sedo.detail).toMatch(/marketplace/i);
  });
});
