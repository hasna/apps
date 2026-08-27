import { afterEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCloudflareProvider } from "../../lib/cloudflare.js";
import type { DnsProvider, ProviderDnsRecord } from "../../lib/registrar.js";
import { registerDnsCommands } from "./dns.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("dns apply provider contract", () => {
  it("passes the complete desired zone to a full-replacement provider when one record changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-dns-apply-"));
    tempDirs.push(dir);
    const file = join(dir, "desired.json");
    const desired: ProviderDnsRecord[] = [
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300 },
      { type: "CNAME", name: "www", value: "example.com", ttl: 300 },
    ];
    const current: ProviderDnsRecord[] = [
      desired[0]!,
      { ...desired[1]!, ttl: 60 },
    ];
    writeFileSync(file, JSON.stringify({ domain: "example.com", records: desired }));

    let reads = 0;
    let applied: ProviderDnsRecord[] | undefined;
    const provider: DnsProvider = {
      name: "full-zone-fixture",
      getDnsRecords: async () => reads++ === 0 ? current : desired,
      setDnsRecords: async (_domain, records) => {
        applied = records;
        return true;
      },
    };
    const program = new Command();
    program.exitOverride();
    registerDnsCommands(program, { getDnsProvider: () => provider });

    await program.parseAsync([
      "node",
      "domains",
      "dns",
      "apply",
      "example.com",
      "--file",
      file,
      "--provider",
      provider.name,
      "--yes",
      "--json",
    ]);

    expect(applied).toEqual(desired);
  });

  it("passes Cloudflare every desired sibling in changed groups while omitting unchanged groups", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-dns-apply-"));
    tempDirs.push(dir);
    const file = join(dir, "desired.json");
    const desired: ProviderDnsRecord[] = [
      { type: "TXT", name: "unchanged", value: "keep", ttl: 300 },
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300 },
      { type: "A", name: "@", value: "192.0.2.11", ttl: 300 },
    ];
    const current: ProviderDnsRecord[] = [
      desired[0]!,
      { ...desired[1]!, ttl: 60 },
      desired[2]!,
    ];
    writeFileSync(file, JSON.stringify({ domain: "example.com", records: desired }));

    let reads = 0;
    let applied: ProviderDnsRecord[] | undefined;
    const provider: DnsProvider = {
      ...createCloudflareProvider({}),
      getDnsRecords: async () => reads++ === 0 ? current : desired,
      setDnsRecords: async (_domain, records) => {
        applied = records;
        return true;
      },
    };
    const program = new Command();
    program.exitOverride();
    registerDnsCommands(program, { getDnsProvider: () => provider });

    await program.parseAsync([
      "node",
      "domains",
      "dns",
      "apply",
      "example.com",
      "--file",
      file,
      "--provider",
      provider.name,
      "--yes",
      "--json",
    ]);

    expect(applied).toEqual([desired[1]!, desired[2]!]);
  });

  it("routes delete plans through a provider delete capability and converges (regression PLA23-00589)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-dns-apply-"));
    tempDirs.push(dir);
    const file = join(dir, "desired.json");
    const desired: ProviderDnsRecord[] = [
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300 },
      { type: "CNAME", name: "www", value: "target.example.com", ttl: 300 },
    ];
    const current: ProviderDnsRecord[] = [
      { type: "TXT", name: "@", value: "old", ttl: 300 },
      { type: "A", name: "@", value: "192.0.2.10", ttl: 60 },
      desired[1]!,
    ];
    writeFileSync(file, JSON.stringify({ domain: "example.com", records: desired }));

    let reads = 0;
    let deleted: ProviderDnsRecord[] | undefined;
    let applied: ProviderDnsRecord[] | undefined;
    const provider: DnsProvider = {
      name: "changed-groups-delete-fixture",
      dnsWriteScope: "changed-groups",
      getDnsRecords: async () => reads++ === 0 ? current : desired,
      setDnsRecords: async (_domain, records) => {
        applied = records;
        return true;
      },
      deleteDnsRecords: async (_domain, records) => {
        deleted = records;
        return true;
      },
    };
    const program = new Command();
    program.exitOverride();
    registerDnsCommands(program, { getDnsProvider: () => provider });

    await program.parseAsync([
      "node",
      "domains",
      "dns",
      "apply",
      "example.com",
      "--file",
      file,
      "--provider",
      provider.name,
      "--yes",
      "--allow-delete",
      "--json",
    ]);

    expect(deleted).toEqual([{ type: "TXT", name: "@", value: "old", ttl: 300, priority: undefined }]);
    // The delete-only TXT group is handled by the delete route; setDnsRecords receives
    // only the desired siblings of change-bearing groups (A update group), never the
    // unchanged CNAME group.
    expect(applied).toEqual([desired[0]!]);
  });
});
