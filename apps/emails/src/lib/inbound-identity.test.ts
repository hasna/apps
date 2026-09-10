import { describe, expect, it } from "bun:test";
import {
  inboundMessageIdentity,
  mergeRecipientLists,
  normalizeRfcMessageId,
} from "./inbound-identity.js";

describe("normalizeRfcMessageId", () => {
  it("strips angle brackets, surrounding space and case", () => {
    expect(normalizeRfcMessageId("  <AM0P138MB0197CAD4@EURP138.PROD.OUTLOOK.COM> ")).toBe(
      "am0p138mb0197cad4@eurp138.prod.outlook.com",
    );
  });

  it("answers null for absence rather than inventing an identity", () => {
    expect(normalizeRfcMessageId(undefined)).toBeNull();
    expect(normalizeRfcMessageId(null)).toBeNull();
    expect(normalizeRfcMessageId("")).toBeNull();
    expect(normalizeRfcMessageId("<>")).toBeNull();
    expect(normalizeRfcMessageId("   ")).toBeNull();
    expect(normalizeRfcMessageId(1234)).toBeNull();
  });
});

describe("inboundMessageIdentity", () => {
  const headers = { "message-id": "<dupe@example.test>", subject: "ignored" };

  it("builds the identity the store's duplicate lookup compares", () => {
    expect(
      inboundMessageIdentity({
        headers,
        from_addr: '"Turlea, Alina" <alinaturlea@kpmg.com>',
        subject: "RE: Beep Media SRL",
        received_at: "2026-09-10T07:31:42.000Z",
      }),
    ).toEqual({
      rfcMessageId: "dupe@example.test",
      fromAddr: '"turlea, alina" <alinaturlea@kpmg.com>',
      subject: "RE: Beep Media SRL",
      receivedAt: "2026-09-10T07:31:42.000Z",
    });
  });

  it("reads a header Map and an absent subject/date without throwing", () => {
    const map = new Map<string, unknown>([["Message-ID", "<mapped@example.test>"]]);
    expect(inboundMessageIdentity({ headers: map, from_addr: "a@example.test" })).toEqual({
      rfcMessageId: "mapped@example.test",
      fromAddr: "a@example.test",
      subject: "",
      receivedAt: null,
    });
  });

  it("answers null when the mail carries no usable Message-ID", () => {
    expect(inboundMessageIdentity({ headers: {}, from_addr: "a@example.test" })).toBeNull();
    expect(inboundMessageIdentity({ from_addr: "a@example.test" })).toBeNull();
    expect(
      inboundMessageIdentity({ headers: { "message-id": "  " }, from_addr: "a@example.test" }),
    ).toBeNull();
  });
});

describe("mergeRecipientLists", () => {
  it("unions in first-seen order without repeating an address", () => {
    expect(
      mergeRecipientLists(
        ["accounting@example.test", "payroll@example.test"],
        ["andrei@example.test", "payroll@example.test"],
      ),
    ).toEqual(["accounting@example.test", "payroll@example.test", "andrei@example.test"]);
  });

  it("drops blanks and trims, so a padded spelling cannot become a second mailbox", () => {
    expect(mergeRecipientLists([" andrei@example.test "], ["andrei@example.test", "", "  "])).toEqual([
      "andrei@example.test",
    ]);
  });

  it("is a no-op when the incoming delivery adds nothing", () => {
    expect(mergeRecipientLists(["a@example.test"], ["a@example.test"])).toEqual(["a@example.test"]);
    expect(mergeRecipientLists([], [])).toEqual([]);
  });
});
