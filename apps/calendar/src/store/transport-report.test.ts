/**
 * Transport-report tests for the calendar resolver seam (hasna/apps#1720,
 * checklist item 6): WHAT the seam reports about the resolved transport —
 * sources and tiers never values — in every configuration shape.
 */
import { describe, expect, test } from "bun:test";
import { resolveClientTransport, resolveStorageClient } from "./http-storage.js";

describe("calendar transport report", () => {
  test("a fully configured pair reports http-api with both sources and the env tier", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_API_URL: "https://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "key",
    });
    expect(r.transport).toBe("http-api");
    expect(r.baseUrl).toBe("https://calendar.example.test/v1");
    expect(r.apiUrlSource).toBe("HASNA_CALENDAR_API_URL");
    expect(r.apiKeyPresent).toBe(true);
    expect(r.apiKeySource).toBe("HASNA_CALENDAR_API_KEY");
    expect(r.apiKeyTier).toBe("env");
    expect(r.misconfigured).toBe(false);
    expect(r.warning).toBeNull();
  });

  test("a key alone reports http-api against the fleet gateway, source 'default'", () => {
    const r = resolveClientTransport("calendar", { HASNA_CALENDAR_API_KEY: "key" });
    expect(r.transport).toBe("http-api");
    expect(r.baseUrl).toBe("https://api.hasna.com/calendar/v1");
    expect(r.apiUrlSource).toBe("default");
    expect(r.apiKeySource).toBe("HASNA_CALENDAR_API_KEY");
    expect(r.apiKeyTier).toBe("env");
  });

  test("the unprefixed alias pair reports the alias env names, canonical first when both agree", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_API_URL: "https://calendar.example.test",
      CALENDAR_API_URL: "https://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "key",
      CALENDAR_API_KEY: "key",
    });
    expect(r.transport).toBe("http-api");
    expect(r.apiUrlSource).toBe("HASNA_CALENDAR_API_URL");
    expect(r.apiKeySource).toBe("HASNA_CALENDAR_API_KEY");
  });

  test("nothing configured reports unconfigured, misconfigured and an actionable warning", () => {
    const r = resolveClientTransport("calendar", {});
    expect(r.transport).toBe("unconfigured");
    expect(r.baseUrl).toBeNull();
    expect(r.apiKeyPresent).toBe(false);
    expect(r.apiKeySource).toBeNull();
    expect(r.apiKeyTier).toBeNull();
    expect(r.misconfigured).toBe(true);
    expect(r.warning).toContain("HASNA_CALENDAR_API_URL");
    expect(r.warning).toMatch(/no API key could be resolved/);
  });

  test("a URL without a key reports unconfigured and names the missing key", () => {
    const r = resolveClientTransport("calendar", { HASNA_CALENDAR_API_URL: "https://calendar.example.test" });
    expect(r.transport).toBe("unconfigured");
    expect(r.misconfigured).toBe(true);
    expect(r.warning).toContain("HASNA_CALENDAR_API_KEY");
  });

  test("a retired placement selector reports unconfigured with the ratchet warning, never a transport", () => {
    const r = resolveClientTransport("calendar", { HASNA_CALENDAR_STORAGE_MODE: "local" });
    expect(r.transport).toBe("unconfigured");
    expect(r.misconfigured).toBe(true);
    expect(r.warning).toMatch(/retired Calendar placement selector/);
  });

  test("an invalid URL reports unconfigured with the URL reason", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_API_URL: "ftp://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "key",
    });
    expect(r.transport).toBe("unconfigured");
    expect(r.misconfigured).toBe(true);
    expect(r.warning).not.toBeNull();
  });

  test("a strict resolution reports the true tier even when the value was handed back as tier 1", () => {
    // resolveStorageClient resolves the credential once and passes it down as
    // the tier-1 argument to avoid a second Keychain pass; the report must
    // still name the TRUE tier, never "argument".
    const resolved = resolveStorageClient("calendar", {
      HASNA_CALENDAR_API_URL: "https://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "key",
    });
    expect(resolved.resolution.transport).toBe("http-api");
    expect(resolved.resolution.apiKeyTier).toBe("env");
    expect(resolved.resolution.apiKeySource).toBe("HASNA_CALENDAR_API_KEY");
    expect(resolved.resolution.apiUrlSource).toBe("HASNA_CALENDAR_API_URL");
  });
});