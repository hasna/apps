import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShortlinksHandler } from "./server.js";
import { ShortlinksStore } from "./store.js";

let tempHome = "";
let dbPath = "";

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-server-"));
  dbPath = join(tempHome, "shortlinks.db");
  process.env.SHORTLINKS_HOME = tempHome;
});

afterEach(() => {
  delete process.env.SHORTLINKS_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("redirect handler", () => {
  test("redirects and tracks a click for the request host", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com/landing", slug: "abc" });

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/abc?utm=test", {
      headers: {
        host: "has.na",
        referer: "https://source.example",
        "user-agent": "bun-test",
        "x-forwarded-for": "203.0.113.55",
      },
    }));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/landing");
    expect(store.getStats("has.na", "abc").clicks).toBe(1);

    store.close();
  });

  test("returns gone for disabled links", async () => {
    const store = new ShortlinksStore(dbPath);
    store.addDomain({ hostname: "has.na", defaultDomain: true });
    store.createLink({ destinationUrl: "https://example.com", slug: "off" });
    store.setLinkActive("has.na", "off", false);

    const handler = createShortlinksHandler({ store });
    const response = await handler(new Request("https://has.na/off", { headers: { host: "has.na" } }));

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "Shortlink is disabled.", slug: "off", host: "has.na" });

    store.close();
  });
});
