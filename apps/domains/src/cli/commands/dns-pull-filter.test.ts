import { describe, expect, test } from "bun:test";
import { partitionPullableRecords, SUPPORTED_DNS_TYPES } from "./dns.js";

describe("partitionPullableRecords (dns pull)", () => {
  test("keeps supported types, skips provider-managed SOA/CAA", () => {
    // Mirrors a real Route53 zone (e.g. wobblyrobottaco.com) that always
    // carries an auto-created SOA plus apex NS, and often CAA.
    const records = [
      { type: "SOA", name: "@", value: "ns-1.awsdns-00.com. hostmaster. 1 7200 900 1209600 86400" },
      { type: "NS", name: "@", value: "ns-1.awsdns-00.com." },
      { type: "A", name: "@", value: "1.2.3.4" },
      { type: "CAA", name: "@", value: '0 issue "letsencrypt.org"' },
      { type: "TXT", name: "@", value: "v=spf1 -all" },
      { type: "MX", name: "@", value: "10 mail.example.com" },
    ];

    const { keep, skipped } = partitionPullableRecords(records);

    expect(keep.map((r) => r.type).sort()).toEqual(["A", "MX", "NS", "TXT"]);
    expect(skipped.get("SOA")).toBe(1);
    expect(skipped.get("CAA")).toBe(1);
    // No kept record may have a type outside the store's allowed set.
    expect(keep.every((r) => SUPPORTED_DNS_TYPES.has(r.type))).toBe(true);
  });

  test("empty input yields no keeps and no skips", () => {
    const { keep, skipped } = partitionPullableRecords([]);
    expect(keep).toHaveLength(0);
    expect(skipped.size).toBe(0);
  });
});
