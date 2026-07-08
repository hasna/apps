import { describe, test, expect, afterAll, mock, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "open-domains-dns-tools-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import { createDomain } from "./domains";
import { closeDatabase } from "./database";
import {
  extractRegistrantFromRdap,
  extractRegistrarFromRdap,
  extractExpiryFromRdap,
  extractNameserversFromRdap,
  checkDnsPropagation,
  checkSsl,
  exportZoneFile,
  importZoneFile,
  whoisLookup,
  validateDns,
  type RdapResponse,
} from "./dns-tools";
import { createDnsRecord, listDnsRecords } from "./dns-records";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// RDAP Data Extraction
// ============================================================

describe("RDAP Data Extraction", () => {
  test("extractRegistrantFromRdap with full vCard", async () => {
    // Code destructures as [prop, _params, type] so value is at index 2
    const rdap: RdapResponse = {
      entities: [
        {
          roles: ["registrant"],
          vcardArray: [
            "vcard",
            [
              ["fn", {}, "John Doe"],
              ["email", {}, "john@example.com"],
              ["tel", {}, "tel:+1.5551234567"],
              ["org", {}, "Example Corp"],
            ],
          ],
        },
      ],
    };

    const result = extractRegistrantFromRdap(rdap);
    expect(result.name).toBe("John Doe");
    expect(result.email).toBe("john@example.com");
    expect(result.phone).toBe("tel:+1.5551234567");
    expect(result.organization).toBe("Example Corp");
  });

  test("extractRegistrantFromRdap with nested entities", async () => {
    const rdap: RdapResponse = {
      entities: [
        {
          entities: [
            {
              roles: ["registrant"],
              vcardArray: [
                "vcard",
                [["fn", {}, "Jane Smith"]],
              ],
            },
          ],
        },
      ],
    };

    const result = extractRegistrantFromRdap(rdap);
    expect(result.name).toBe("Jane Smith");
  });

  test("extractRegistrantFromRdap with structured name (N)", async () => {
    const rdap: RdapResponse = {
      entities: [
        {
          roles: ["registrant"],
          vcardArray: [
            "vcard",
            [
              ["n", {}, ["Doe", "John", "A", "Mr"]],
              ["email", {}, "john@example.com"],
            ],
          ],
        },
      ],
    };

    const result = extractRegistrantFromRdap(rdap);
    // Code reverses array and joins with space: ["Mr", "A", "John", "Doe"]
    expect(result.name).toBe("Mr A John Doe");
  });

  test("extractRegistrantFromRdap falls back to handle", async () => {
    const rdap: RdapResponse = {
      entities: [
        {
          roles: ["registrant"],
          handle: "REG-123",
          vcardArray: ["vcard", []],
        },
      ],
    };

    const result = extractRegistrantFromRdap(rdap);
    expect(result.name).toBe("REG-123");
  });

  test("extractRegistrantFromRdap returns nulls for empty data", async () => {
    const rdap: RdapResponse = {};
    const result = extractRegistrantFromRdap(rdap);
    expect(result.name).toBeNull();
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.organization).toBeNull();
  });

  test("extractRegistrarFromRdap from vCard", async () => {
    const rdap: RdapResponse = {
      entities: [
        {
          roles: ["registrar"],
          vcardArray: [
            "vcard",
            [["fn", {}, "Example Registrar Inc"]],
          ],
        },
      ],
    };

    expect(extractRegistrarFromRdap(rdap)).toBe("Example Registrar Inc");
  });

  test("extractRegistrarFromRdap from remarks", async () => {
    const rdap: RdapResponse = {
      entities: [
        {
          roles: ["sponsor"],
          remarks: [
            {
              title: "Registrar Name",
              description: "GoDaddy LLC",
            },
          ],
        },
      ],
    };

    expect(extractRegistrarFromRdap(rdap)).toBe("GoDaddy LLC");
  });

  test("extractRegistrarFromRdap from handle fallback", async () => {
    const rdap: RdapResponse = {
      entities: [
        {
          roles: ["registrar"],
          handle: "REG-ABC",
        },
      ],
    };

    expect(extractRegistrarFromRdap(rdap)).toBe("REG-ABC");
  });

  test("extractRegistrarFromRdap returns null when no registrar entity", async () => {
    const rdap: RdapResponse = {
      entities: [{ roles: ["registrant"] }],
    };
    expect(extractRegistrarFromRdap(rdap)).toBeNull();
  });

  test("extractExpiryFromRdap finds expiration event", async () => {
    const rdap: RdapResponse = {
      events: [
        { eventAction: "registration", eventDate: "2020-01-01" },
        { eventAction: "expiration", eventDate: "2025-12-31T23:59:59Z" },
        { eventAction: "last changed", eventDate: "2024-06-01" },
      ],
    };

    expect(extractExpiryFromRdap(rdap)).toBe("2025-12-31T23:59:59Z");
  });

  test("extractExpiryFromRdap finds expiry event", async () => {
    const rdap: RdapResponse = {
      events: [{ eventAction: "expiry", eventDate: "2026-01-15" }],
    };
    expect(extractExpiryFromRdap(rdap)).toBe("2026-01-15");
  });

  test("extractExpiryFromRdap returns null for missing events", async () => {
    const rdap: RdapResponse = { events: [] };
    expect(extractExpiryFromRdap(rdap)).toBeNull();
    expect(extractExpiryFromRdap({})).toBeNull();
  });

  test("extractNameserversFromRdap", async () => {
    const rdap: RdapResponse = {
      nameservers: [
        { ldhName: "NS1.EXAMPLE.COM" },
        { ldhName: "ns2.example.com" },
        { unicodeName: "ns3.example.com" },
      ],
    };

    const result = extractNameserversFromRdap(rdap);
    expect(result).toEqual(["ns1.example.com", "ns2.example.com", "ns3.example.com"]);
  });

  test("extractNameserversFromRdap returns empty for missing nameservers", async () => {
    expect(extractNameserversFromRdap({})).toEqual([]);
  });
});

// ============================================================
// Command Injection Regression
// ============================================================

describe("DNS tool input validation", () => {
  test("whoisLookup rejects shell metacharacters before subprocess execution", async () => {
    const marker = join(tempDir, "whois-injected");

    await expect(whoisLookup(`example.com; touch ${marker} #`)).rejects.toThrow(/Invalid domain name/);
    expect(existsSync(marker)).toBe(false);
  });

  test("checkDnsPropagation rejects injected query names before dig execution", async () => {
    const marker = join(tempDir, "dns-domain-injected");

    expect(() => checkDnsPropagation(`example.com; touch ${marker} #`, "A")).toThrow(/Invalid domain name/);
    expect(existsSync(marker)).toBe(false);
  });

  test("checkDnsPropagation rejects injected record types before dig execution", async () => {
    const marker = join(tempDir, "dns-record-injected");

    expect(() => checkDnsPropagation("example.com", `A; touch ${marker} #`)).toThrow(/Invalid DNS record type/);
    expect(existsSync(marker)).toBe(false);
  });

  test("checkSsl rejects shell metacharacters before openssl execution", async () => {
    const marker = join(tempDir, "ssl-injected");

    await expect(checkSsl(`example.com; touch ${marker} #`)).rejects.toThrow(/Invalid domain name/);
    expect(existsSync(marker)).toBe(false);
  });
});

// ============================================================
// Zone File Export / Import
// ============================================================

describe("Zone File Export / Import", () => {
  let domainId: string;

  test("setup: create domain for zone tests", async () => {
    const domain = await createDomain({ name: "zone-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("exportZoneFile returns null for non-existent domain", async () => {
    expect(await exportZoneFile("nonexistent")).toBeNull();
  });

  test("exportZoneFile produces valid zone file header", async () => {
    const result = await exportZoneFile(domainId);
    expect(result).not.toBeNull();
    expect(result).toContain("; Zone file for zone-test.com");
    expect(result).toContain("$ORIGIN zone-test.com.");
    expect(result).toContain("$TTL 3600");
  });

  test("exportZoneFile includes DNS records", async () => {
    createDnsRecord({
      domain_id: domainId,
      type: "A",
      name: "@",
      value: "192.168.1.1",
      ttl: 300,
    });

    const result = await exportZoneFile(domainId);
    expect(result).toContain("zone-test.com.\t300\tIN\tA\t192.168.1.1");
  });

  test("exportZoneFile formats MX records with priority", async () => {
    createDnsRecord({
      domain_id: domainId,
      type: "MX",
      name: "@",
      value: "mail.zone-test.com.",
      ttl: 3600,
      priority: 10,
    });

    const result = await exportZoneFile(domainId);
    // exportZoneFile replaces "@" with domain name
    expect(result).toContain("zone-test.com.\t3600\tIN\tMX\t10\tmail.zone-test.com.");
  });

  test("importZoneFile returns null for non-existent domain", async () => {
    expect(await importZoneFile("nonexistent", "$ORIGIN test.com.")).toBeNull();
  });

  test("importZoneFile parses A records", async () => {
    const content = `; Test zone file
$ORIGIN import-test.com.
$TTL 3600
@ 3600 IN A 10.0.0.1
www 3600 IN A 10.0.0.2
`;
    const domain = await createDomain({ name: "import-a-test.com" });
    const result = await importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(2);
    expect(result!.skipped).toBe(0);
    expect(result!.errors.length).toBe(0);
    expect(result!.records.length).toBe(2);
  });

  test("importZoneFile skips comments and directives", async () => {
    const content = `; This is a comment
$ORIGIN import-comment.com.
$TTL 7200
`;
    const domain = await createDomain({ name: "import-comment-test.com" });
    const result = await importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(0);
    expect(result!.skipped).toBe(0);
  });

  test("importZoneFile handles short lines (less than 4 parts)", async () => {
    const content = `short line
one
`;
    const domain = await createDomain({ name: "import-bad-test.com" });
    const result = await importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.errors.length).toBe(2);
    expect(result!.skipped).toBe(2);
  });

  test("importZoneFile normalizes domain name to @", async () => {
    const content = `import-normalize.com. 3600 IN A 1.2.3.4
`;
    const domain = await createDomain({ name: "import-normalize.com" });
    const result = await importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.records[0]!.name).toBe("@");
  });

  test("importZoneFile strips trailing dot and normalizes domain name to @", async () => {
    const content = `import-dot-test.com. 3600 IN A 5.6.7.8
`;
    const domain = await createDomain({ name: "import-dot-test.com" });
    const result = await importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.records[0]!.name).toBe("@");
  });

  test("importZoneFile handles MX records with priority", async () => {
    const content = `@ 3600 IN MX 10 mail.import-mx-test.com.
`;
    const domain = await createDomain({ name: "import-mx-test.com" });
    const result = await importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.records[0]!.type).toBe("MX");
    expect(result!.records[0]!.priority).toBe(10);
  });

  test("importZoneFile reports errors for unknown record types", async () => {
    const content = `@ 3600 IN UNKNOWN value
`;
    const domain = await createDomain({ name: "import-unknown-test.com" });
    const result = await importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.skipped).toBe(1);
    expect(result!.errors[0]).toContain("Unknown record type");
  });
});

// ============================================================
// DNS Validation
// ============================================================

describe("DNS Validation", () => {
  let domainId: string;

  test("setup: create domain for validation tests", async () => {
    const domain = await createDomain({ name: "validate-test.com" });
    domainId = domain.id;
  });

  test("validateDns returns null for non-existent domain", async () => {
    expect(await validateDns("nonexistent")).toBeNull();
  });

  test("validateDns passes with no records", async () => {
    const result = await validateDns(domainId);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.length).toBe(0);
  });

  test("validateDns detects CNAME + A conflict", async () => {
    const domain = await createDomain({ name: "cname-conflict-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "CNAME",
      name: "www",
      value: "target.com",
      ttl: 3600,
    });
    createDnsRecord({
      domain_id: domain.id,
      type: "A",
      name: "www",
      value: "1.2.3.4",
      ttl: 3600,
    });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.type === "error" && i.message.includes("CNAME"))).toBe(true);
  });

  test("validateDns detects CNAME + MX conflict", async () => {
    const domain = await createDomain({ name: "cname-mx-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "CNAME",
      name: "mail",
      value: "mailserver.com",
      ttl: 3600,
    });
    createDnsRecord({
      domain_id: domain.id,
      type: "MX",
      name: "mail",
      value: "mailserver.com",
      ttl: 3600,
      priority: 10,
    });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  test("validateDns warns about missing MX at root", async () => {
    createDnsRecord({
      domain_id: domainId,
      type: "A",
      name: "@",
      value: "1.1.1.1",
      ttl: 3600,
    });

    const result = await validateDns(domainId);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("MX"))).toBe(true);
  });

  test("validateDns warns about CNAME pointing to nonexistent target", async () => {
    const domain = await createDomain({ name: "orphan-cname-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "CNAME",
      name: "www",
      value: "missing.orphan-cname-test.com",
      ttl: 3600,
    });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("has no records"))).toBe(true);
  });

  test("validateDns warns about MX without priority", async () => {
    const domain = await createDomain({ name: "mx-nopriority-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "MX",
      name: "@",
      value: "mail.mx-nopriority-test.com.",
      ttl: 3600,
    });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.message.includes("no priority"))).toBe(true);
  });

  test("validateDns detects multiple CNAMEs at same name", async () => {
    const domain = await createDomain({ name: "multi-cname-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "CNAME",
      name: "app",
      value: "target1.com",
      ttl: 3600,
    });
    createDnsRecord({
      domain_id: domain.id,
      type: "CNAME",
      name: "app",
      value: "target2.com",
      ttl: 3600,
    });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.message.includes("Multiple CNAME"))).toBe(true);
  });

  test("validateDns passes with clean records", async () => {
    const domain = await createDomain({ name: "clean-dns-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "A",
      name: "@",
      value: "1.2.3.4",
      ttl: 3600,
    });
    createDnsRecord({
      domain_id: domain.id,
      type: "CNAME",
      name: "www",
      value: "@",
      ttl: 3600,
    });
    createDnsRecord({
      domain_id: domain.id,
      type: "MX",
      name: "@",
      value: "mail.clean-dns-test.com.",
      ttl: 3600,
      priority: 10,
    });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.length).toBe(0);
  });
});
