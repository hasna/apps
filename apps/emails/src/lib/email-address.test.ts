import { describe, it, expect } from "bun:test";
import { canonicalSender, senderDisplayName } from "./email-address.js";

describe("canonicalSender", () => {
  it("parses a bare address (lowercased)", () => {
    expect(canonicalSender("Ops@Example.com")).toBe("ops@example.com");
  });

  it("parses a single display-name angle-addr", () => {
    expect(canonicalSender("Ops Team <ops@example.com>")).toBe("ops@example.com");
  });

  it("REJECTS a double angle-addr spoof (the exploit)", () => {
    // Two angle-addrs: clients disagree on which is the real From, so deny.
    expect(canonicalSender("x <attacker@evil.com> <ceo@corp.com>")).toBeNull();
    expect(canonicalSender("<a@x.com><b@y.com>")).toBeNull();
  });

  it("a display name that looks like an email is cosmetic — real addr still parsed", () => {
    // The authorized address is the bracketed one (attacker's own); the display
    // text is not an address. This is inherent to email and not an auth bypass.
    expect(canonicalSender("ceo@corp.com <attacker@evil.com>")).toBe("attacker@evil.com");
  });

  it("rejects stray brackets / malformed", () => {
    expect(canonicalSender("a@x.com>")).toBeNull();
    expect(canonicalSender("<a@x.com")).toBeNull();
    expect(canonicalSender("a@b@c.com")).toBeNull();
    expect(canonicalSender("no-at-sign")).toBeNull();
    expect(canonicalSender("two addrs a@x.com")).toBeNull();
    expect(canonicalSender("a@x.com (comment)")).toBeNull();
    expect(canonicalSender("a@x.com, b@y.com")).toBeNull();
    expect(canonicalSender("a..b@example.com")).toBeNull();
    expect(canonicalSender("a@-bad.example")).toBeNull();
    expect(canonicalSender("")).toBeNull();
  });
});

describe("senderDisplayName", () => {
  it("returns the phrase from an unquoted `Name <addr>` form", () => {
    expect(senderDisplayName("Andrei Hasna <andrei@hasna.com>")).toBe("Andrei Hasna");
  });

  it("unquotes a quoted phrase for re-rendering", () => {
    expect(senderDisplayName('"Andrei Hasna" <andrei@hasna.com>')).toBe("Andrei Hasna");
    expect(senderDisplayName('"Augustus (CEO seat)" <ceo@example.com>')).toBe("Augustus (CEO seat)");
  });

  it("preserves diacritics verbatim", () => {
    expect(senderDisplayName("Andrei Hăsnaș <andrei@hasna.com>")).toBe("Andrei Hăsnaș");
  });

  it("returns null for a bare addr-spec (no display name to render)", () => {
    expect(senderDisplayName("andrei@hasna.com")).toBeNull();
  });

  it("returns null for an empty phrase or an ambiguous double angle-addr", () => {
    expect(senderDisplayName("<andrei@hasna.com>")).toBeNull();
    expect(senderDisplayName("x <a@x.com> <b@y.com>")).toBeNull();
    expect(senderDisplayName("  <andrei@hasna.com>")).toBeNull();
    expect(senderDisplayName("")).toBeNull();
  });

  it("does not filter control characters (the caller applies header safety)", () => {
    // Mirrors the address-record display_name contract: safety is enforced at
    // the provider-call boundary via the header-safety check, not here.
    expect(senderDisplayName("Evil\r\nBcc: a@b.c <sender@example.com>")).toBe("Evil\r\nBcc: a@b.c");
  });
});
