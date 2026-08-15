import { describe, it, expect } from "bun:test";
import { godaddyCapability } from "./godaddy.js";

describe("godaddyCapability", () => {
  it("configured when key+secret present, always gated", () => {
    const cap = godaddyCapability({ GODADDY_API_KEY: "k", GODADDY_API_SECRET: "s" });
    expect(cap.configured).toBe(true);
    expect(cap.gated).toBe(true);
    expect(cap.notes).toMatch(/Route53|qualifying account/);
  });
  it("not configured when creds missing", () => {
    expect(godaddyCapability({}).configured).toBe(false);
  });
});
