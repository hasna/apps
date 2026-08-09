import { afterEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
