// Site-parsing tests for the Secrets Vault extension.
// Covers the owner requirement "it detects the website too":
//   - the popup displays the active tab's origin (fullOrigin)
//   - matching/searching and per-site labels use the bare hostname (normalizeHost)
// TDD: written before ../site.js existed; must fail on a missing module.
import { describe, expect, test } from "bun:test";

import { fullOrigin, normalizeHost } from "../site.js";

describe("fullOrigin", () => {
  test("keeps scheme and host for display", () => {
    expect(fullOrigin("https://github.com/foo/bar")).toBe("https://github.com");
  });

  test("keeps a non-default port", () => {
    expect(fullOrigin("https://github.com:8443/x")).toBe("https://github.com:8443");
  });

  test("accepts http", () => {
    expect(fullOrigin("http://localhost:3000/x")).toBe("http://localhost:3000");
  });

  test("rejects non-web schemes", () => {
    expect(fullOrigin("chrome://settings")).toBeNull();
    expect(fullOrigin("file:///tmp/x")).toBeNull();
  });

  test("rejects unparseable input", () => {
    expect(fullOrigin("not a url")).toBeNull();
  });
});

describe("normalizeHost", () => {
  test("lowercases the hostname", () => {
    expect(normalizeHost("https://GitHub.com/foo")).toBe("github.com");
  });

  test("drops the port", () => {
    expect(normalizeHost("http://localhost:3000")).toBe("localhost");
  });

  test("keeps subdomains", () => {
    expect(normalizeHost("https://mail.google.com/inbox")).toBe("mail.google.com");
  });

  test("rejects non-web schemes", () => {
    expect(normalizeHost("file:///tmp/x")).toBeNull();
    expect(normalizeHost("chrome://settings")).toBeNull();
  });

  test("rejects unparseable input", () => {
    expect(normalizeHost("not a url")).toBeNull();
  });
});
