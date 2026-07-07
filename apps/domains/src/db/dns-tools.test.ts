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
  test("extractRegistrantFromRdap with full vCard", () => {
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

  test("extractRegistrantFromRdap with nested entities", () => {
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

  test("extractRegistrantFromRdap with structured name (N)", () => {
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

  test("extractRegistrantFromRdap falls back to handle", () => {
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

  test("extractRegistrantFromRdap returns nulls for empty data", () => {
    const rdap: RdapResponse = {};
    const result = extractRegistrantFromRdap(rdap);
    expect(result.name).toBeNull();
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.organization).toBeNull();
  });

  test("extractRegistrarFromRdap from vCard", () => {
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

  test("extractRegistrarFromRdap from remarks", () => {
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

  test("extractRegistrarFromRdap from handle fallback", () => {
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

  test("extractRegistrarFromRdap returns null when no registrar entity", () => {
    const rdap: RdapResponse = {
      entities: [{ roles: ["registrant"] }],
    };
    expect(extractRegistrarFromRdap(rdap)).toBeNull();
  });

  test("extractExpiryFromRdap finds expiration event", () => {
    const rdap: RdapResponse = {
      events: [
        { eventAction: "registration", eventDate: "2020-01-01" },
        { eventAction: "expiration", eventDate: "2025-12-31T23:59:59Z" },
        { eventAction: "last changed", eventDate: "2024-06-01" },
      ],
    };

    expect(extractExpiryFromRdap(rdap)).toBe("2025-12-31T23:59:59Z");
  });

  test("extractExpiryFromRdap finds expiry event", () => {
    const rdap: RdapResponse = {
      events: [{ eventAction: "expiry", eventDate: "2026-01-15" }],
    };
    expect(extractExpiryFromRdap(rdap)).toBe("2026-01-15");
  });

  test("extractExpiryFromRdap returns null for missing events", () => {
    const rdap: RdapResponse = { events: [] };
    expect(extractExpiryFromRdap(rdap)).toBeNull();
    expect(extractExpiryFromRdap({})).toBeNull();
  });

  test("extractNameserversFromRdap", () => {
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

  test("extractNameserversFromRdap returns empty for missing nameservers", () => {
    expect(extractNameserversFromRdap({})).toEqual([]);
  });
});

// ============================================================
// Command Injection Regression
// ============================================================

describe("DNS tool input validation", () => {
  test("whoisLookup rejects shell metacharacters before subprocess execution", () => {
    const marker = join(tempDir, "whois-injected");

    expect(() => whoisLookup(`example.com; touch ${marker} #`)).toThrow(/Invalid domain name/);
    expect(existsSync(marker)).toBe(false);
  });

  test("checkDnsPropagation rejects injected query names before dig execution", () => {
    const marker = join(tempDir, "dns-domain-injected");

    expect(() => checkDnsPropagation(`example.com; touch ${marker} #`, "A")).toThrow(/Invalid domain name/);
    expect(existsSync(marker)).toBe(false);
  });

  test("checkDnsPropagation rejects injected record types before dig execution", () => {
    const marker = join(tempDir, "dns-record-injected");

    expect(() => checkDnsPropagation("example.com", `A; touch ${marker} #`)).toThrow(/Invalid DNS record type/);
    expect(existsSync(marker)).toBe(false);
  });

  test("checkSsl rejects shell metacharacters before openssl execution", () => {
    const marker = join(tempDir, "ssl-injected");

    expect(() => checkSsl(`example.com; touch ${marker} #`)).toThrow(/Invalid domain name/);
    expect(existsSync(marker)).toBe(false);
  });
});

// ============================================================
// Zone File Export / Import
// ============================================================

describe("Zone File Export / Import", () => {
  let domainId: string;

  test("setup: create domain for zone tests", () => {
    const domain = createDomain({ name: "zone-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("exportZoneFile returns null for non-existent domain", () => {
    expect(exportZoneFile("nonexistent")).toBeNull();
  });

  test("exportZoneFile produces valid zone file header", () => {
    const result = exportZoneFile(domainId);
    expect(result).not.toBeNull();
    expect(result).toContain("; Zone file for zone-test.com");
    expect(result).toContain("$ORIGIN zone-test.com.");
    expect(result).toContain("$TTL 3600");
  });

  test("exportZoneFile includes DNS records", () => {
    createDnsRecord({
      domain_id: domainId,
      type: "A",
      name: "@",
      value: "192.168.1.1",
      ttl: 300,
    });

    const result = exportZoneFile(domainId);
    expect(result).toContain("zone-test.com.\t300\tIN\tA\t192.168.1.1");
  });

  test("exportZoneFile formats MX records with priority", () => {
    createDnsRecord({
      domain_id: domainId,
      type: "MX",
      name: "@",
      value: "mail.zone-test.com.",
      ttl: 3600,
      priority: 10,
    });

    const result = exportZoneFile(domainId);
    // exportZoneFile replaces "@" with domain name
    expect(result).toContain("zone-test.com.\t3600\tIN\tMX\t10\tmail.zone-test.com.");
  });

  test("importZoneFile returns null for non-existent domain", () => {
    expect(importZoneFile("nonexistent", "$ORIGIN test.com.")).toBeNull();
  });

  test("importZoneFile parses A records", () => {
    const content = `; Test zone file
$ORIGIN import-test.com.
$TTL 3600
@ 3600 IN A 10.0.0.1
www 3600 IN A 10.0.0.2
`;
    const domain = createDomain({ name: "import-a-test.com" });
    const result = importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(2);
    expect(result!.skipped).toBe(0);
    expect(result!.errors.length).toBe(0);
    expect(result!.records.length).toBe(2);
  });

  test("importZoneFile skips comments and directives", () => {
    const content = `; This is a comment
$ORIGIN import-comment.com.
$TTL 7200
`;
    const domain = createDomain({ name: "import-comment-test.com" });
    const result = importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(0);
    expect(result!.skipped).toBe(0);
  });

  test("importZoneFile handles short lines (less than 4 parts)", () => {
    const content = `short line
one
`;
    const domain = createDomain({ name: "import-bad-test.com" });
    const result = importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.errors.length).toBe(2);
    expect(result!.skipped).toBe(2);
  });

  test("importZoneFile normalizes domain name to @", () => {
    const content = `import-normalize.com. 3600 IN A 1.2.3.4
`;
    const domain = createDomain({ name: "import-normalize.com" });
    const result = importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.records[0]!.name).toBe("@");
  });

  test("importZoneFile strips trailing dot and normalizes domain name to @", () => {
    const content = `import-dot-test.com. 3600 IN A 5.6.7.8
`;
    const domain = createDomain({ name: "import-dot-test.com" });
    const result = importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.records[0]!.name).toBe("@");
  });

  test("importZoneFile handles MX records with priority", () => {
    const content = `@ 3600 IN MX 10 mail.import-mx-test.com.
`;
    const domain = createDomain({ name: "import-mx-test.com" });
    const result = importZoneFile(domain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.records[0]!.type).toBe("MX");
    expect(result!.records[0]!.priority).toBe(10);
  });

  test("importZoneFile reports errors for unknown record types", () => {
    const content = `@ 3600 IN UNKNOWN value
`;
    const domain = createDomain({ name: "import-unknown-test.com" });
    const result = importZoneFile(domain.id, content);
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

  test("setup: create domain for validation tests", () => {
    const domain = createDomain({ name: "validate-test.com" });
    domainId = domain.id;
  });

  test("validateDns returns null for non-existent domain", () => {
    expect(validateDns("nonexistent")).toBeNull();
  });

  test("validateDns passes with no records", () => {
    const result = validateDns(domainId);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.length).toBe(0);
  });

  test("validateDns detects CNAME + A conflict", () => {
    const domain = createDomain({ name: "cname-conflict-test.com" });

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

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.type === "error" && i.message.includes("CNAME"))).toBe(true);
  });

  test("validateDns detects CNAME + MX conflict", () => {
    const domain = createDomain({ name: "cname-mx-test.com" });

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

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  test("validateDns warns about missing MX at root", () => {
    createDnsRecord({
      domain_id: domainId,
      type: "A",
      name: "@",
      value: "1.1.1.1",
      ttl: 3600,
    });

    const result = validateDns(domainId);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("MX"))).toBe(true);
  });

  test("validateDns warns about CNAME pointing to nonexistent target", () => {
    const domain = createDomain({ name: "orphan-cname-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "CNAME",
      name: "www",
      value: "missing.orphan-cname-test.com",
      ttl: 3600,
    });

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("has no records"))).toBe(true);
  });

  test("validateDns warns about MX without priority", () => {
    const domain = createDomain({ name: "mx-nopriority-test.com" });

    createDnsRecord({
      domain_id: domain.id,
      type: "MX",
      name: "@",
      value: "mail.mx-nopriority-test.com.",
      ttl: 3600,
    });

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.message.includes("no priority"))).toBe(true);
  });

  test("validateDns detects multiple CNAMEs at same name", () => {
    const domain = createDomain({ name: "multi-cname-test.com" });

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

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.message.includes("Multiple CNAME"))).toBe(true);
  });

  test("validateDns passes with clean records", () => {
    const domain = createDomain({ name: "clean-dns-test.com" });

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

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.length).toBe(0);
  });
});
