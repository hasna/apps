import { describe, it, expect } from "bun:test";
import { resolveCloudflareConfig, cloudflareAuthHeaders } from "./cloudflare-auth.js";

describe("resolveCloudflareConfig", () => {
  it("prefers a scoped token", () => {
    const c = resolveCloudflareConfig({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acct" });
    expect(c).toEqual({ apiToken: "tok", accountId: "acct" });
  });

  it("falls back to global key + email (standard env)", () => {
    const c = resolveCloudflareConfig({ CLOUDFLARE_API_KEY: "gk", CLOUDFLARE_EMAIL: "a@b.com", CLOUDFLARE_ACCOUNT_ID: "acct" });
    expect(c).toEqual({ apiKey: "gk", email: "a@b.com", accountId: "acct" });
  });

  it("falls back to the HASNAXYZ vault env names", () => {
    const c = resolveCloudflareConfig({
      HASNAXYZ_CLOUDFLARE_LIVE_API_KEY: "vk",
      HASNAXYZ_CLOUDFLARE_LIVE_EMAIL: "ops@hasna.com",
    });
    expect(c.apiKey).toBe("vk");
    expect(c.email).toBe("ops@hasna.com");
  });

  it("returns empty config when nothing set", () => {
    expect(resolveCloudflareConfig({})).toEqual({});
  });
});

describe("cloudflareAuthHeaders", () => {
  it("uses Bearer for a token", () => {
    expect(cloudflareAuthHeaders({ apiToken: "tok" })).toEqual({ Authorization: "Bearer tok" });
  });

  it("uses X-Auth-Key + X-Auth-Email for a global key", () => {
    expect(cloudflareAuthHeaders({ apiKey: "gk", email: "a@b.com" })).toEqual({
      "X-Auth-Key": "gk",
      "X-Auth-Email": "a@b.com",
    });
  });

  it("throws when no usable auth is present", () => {
    expect(() => cloudflareAuthHeaders({})).toThrow(/Cloudflare credentials/);
    expect(() => cloudflareAuthHeaders({ apiKey: "gk" })).toThrow(/Cloudflare credentials/);
  });
});
