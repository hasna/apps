import { describe, it, expect } from "bun:test";
import { resolveSedoConfig, sedoCapability } from "./sedo.js";

describe("resolveSedoConfig", () => {
  it("reads standard SEDO env names", () => {
    const cfg = resolveSedoConfig({
      SEDO_PARTNER_ID: "p",
      SEDO_API_KEY: "k",
      SEDO_USERNAME: "u",
      SEDO_PASSWORD: "pw",
    });
    expect(cfg).toEqual({ partnerId: "p", signKey: "k", username: "u", password: "pw" });
  });

  it("does not rely on org-scoped Sedo env aliases", () => {
    const cfg = resolveSedoConfig({
      ACME_SEDO_PARTNER_ID: "p",
      ACME_SEDO_API_KEY: "k",
      ACME_SEDO_EMAIL: "u",
      ACME_SEDO_PASSWORD: "pw",
    });
    expect(cfg).toEqual({ partnerId: undefined, signKey: undefined, username: undefined, password: undefined });
  });
});

describe("sedoCapability", () => {
  it("is configured with full credentials and remains marketplace-only", () => {
    const cap = sedoCapability({
      SEDO_PARTNER_ID: "p",
      SEDO_API_KEY: "k",
      SEDO_USERNAME: "u",
      SEDO_PASSWORD: "pw",
    });
    expect(cap.configured).toBe(true);
    expect(cap.gated).toBe(true);
    expect(cap.notes).toMatch(/marketplace|not registrar DNS/i);
  });

  it("is not configured when credentials are incomplete", () => {
    expect(sedoCapability({ SEDO_API_KEY: "k" }).configured).toBe(false);
  });
});
