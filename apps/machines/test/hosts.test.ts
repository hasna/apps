import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FleetManifest } from "../src/types.js";
import {
  HOSTS_BLOCK_BEGIN,
  HOSTS_BLOCK_END,
  applyFleetHosts,
  buildFleetHostEntries,
  collectPingTargets,
  mergeHostsContent,
  planFleetHosts,
  renderHostsBlock,
} from "../src/commands/hosts.js";

const manifest: FleetManifest = {
  version: 1,
  machines: [
    { id: "spark01", hostname: "spark01", platform: "linux", workspacePath: "/home/hasna/workspace", tailscaleName: "spark01", metadata: { lanAddress: "192.168.50.230" } },
    { id: "spark02", hostname: "spark02", platform: "linux", workspacePath: "/home/hasna/workspace", tailscaleName: "spark02", metadata: { lanAddress: "192.168.50.58" } },
    { id: "apple03", hostname: "apple03", platform: "macos", workspacePath: "/Users/hasna/Workspace", tailscaleName: "apple03", metadata: { lanAddress: "192.168.50.250" } },
    { id: "machine001", hostname: "machine001", platform: "macos", workspacePath: "/Users/hasna/Workspace", tailscaleName: "machine001" },
    { id: "apple01", hostname: "apple01", platform: "macos", workspacePath: "/Users/hasna/Workspace", tailscaleName: "apple01" },
  ],
};

// Synthetic `tailscale status --json` payload.
const tailscale = {
  Self: { HostName: "spark01", DNSName: "spark01.taild59be2.ts.net.", TailscaleIPs: ["100.71.123.34"], Online: true },
  Peer: {
    a: { HostName: "spark02", DNSName: "spark02.taild59be2.ts.net.", TailscaleIPs: ["100.85.234.92"], CurAddr: "192.168.50.58:41641", Online: true },
    b: { HostName: "apple03", DNSName: "apple03.taild59be2.ts.net.", TailscaleIPs: ["100.100.226.69"], CurAddr: "192.168.50.250:41641", Online: true },
    c: { HostName: "machine001", DNSName: "machine001.taild59be2.ts.net.", TailscaleIPs: ["100.69.215.63"], Online: true },
    d: { HostName: "apple01", DNSName: "apple01.taild59be2.ts.net.", TailscaleIPs: ["100.82.44.120"], Online: true },
  },
};

describe("buildFleetHostEntries", () => {
  const result = buildFleetHostEntries({
    manifest,
    tailscale,
    localSubnets: ["192.168.50"],
    localMachineId: "spark01",
  });
  const byId = new Map(result.entries.map((entry) => [entry.id, entry]));

  test("skips the local machine", () => {
    expect(byId.has("spark01")).toBe(false);
  });

  test("prefers a same-subnet LAN address from manifest metadata", () => {
    expect(byId.get("spark02")?.ip).toBe("192.168.50.58");
    expect(byId.get("spark02")?.source).toBe("manifest_lan");
    expect(byId.get("apple03")?.ip).toBe("192.168.50.250");
  });

  test("falls back to the tailnet IP when no LAN address is known", () => {
    expect(byId.get("machine001")?.ip).toBe("100.69.215.63");
    expect(byId.get("machine001")?.source).toBe("tailscale");
  });

  test("uses the tailnet IP for off-LAN peers even if they are online", () => {
    // apple01 has no CurAddr (relayed) and no manifest LAN address → tailnet IP.
    expect(byId.get("apple01")?.ip).toBe("100.82.44.120");
    expect(byId.get("apple01")?.source).toBe("tailscale");
  });

  test("includes short hostname aliases", () => {
    expect(byId.get("machine001")?.names).toContain("machine001");
  });
});

describe("LAN detection via tailscale CurAddr", () => {
  test("uses the direct LAN endpoint when the manifest has no lanAddress", () => {
    const noMeta: FleetManifest = {
      version: 1,
      machines: [
        { id: "spark01", platform: "linux", workspacePath: "/x", tailscaleName: "spark01" },
        { id: "spark02", platform: "linux", workspacePath: "/x", tailscaleName: "spark02" },
      ],
    };
    const result = buildFleetHostEntries({ manifest: noMeta, tailscale, localSubnets: ["192.168.50"], localMachineId: "spark01" });
    const spark02 = result.entries.find((entry) => entry.id === "spark02");
    expect(spark02?.ip).toBe("192.168.50.58");
    expect(spark02?.source).toBe("tailscale_lan");
  });
});

describe("collectPingTargets", () => {
  test("targets online peers without a same-subnet LAN endpoint", () => {
    const targets = collectPingTargets(tailscale, ["192.168.50"]);
    // machine001 (no CurAddr) and apple01 (relayed) need warming; spark02/apple03 already direct.
    expect(targets).toContain("100.69.215.63"); // machine001
    expect(targets).toContain("100.82.44.120"); // apple01
    expect(targets).not.toContain("100.85.234.92"); // spark02 already same-subnet
    expect(targets).not.toContain("100.100.226.69"); // apple03 already same-subnet
  });
});

describe("renderHostsBlock", () => {
  test("renders a delimited, sorted block", () => {
    const result = buildFleetHostEntries({ manifest, tailscale, localSubnets: ["192.168.50"], localMachineId: "spark01" });
    const block = renderHostsBlock(result.entries);
    expect(block.startsWith(HOSTS_BLOCK_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(HOSTS_BLOCK_END)).toBe(true);
    expect(block).toContain("192.168.50.58");
    expect(block).toContain("machine001");
    // apple01 sorts before machine001 and spark02
    expect(block.indexOf("apple01")).toBeLessThan(block.indexOf("machine001"));
  });
});

describe("mergeHostsContent", () => {
  const block = `${HOSTS_BLOCK_BEGIN}\n100.0.0.1\tfoo\n${HOSTS_BLOCK_END}`;

  test("appends the block when absent", () => {
    const merged = mergeHostsContent("127.0.0.1 localhost\n", block);
    expect(merged).toContain("127.0.0.1 localhost");
    expect(merged).toContain(block);
  });

  test("replaces an existing block without touching other lines", () => {
    const existing = `127.0.0.1 localhost\n${HOSTS_BLOCK_BEGIN}\n9.9.9.9\told\n${HOSTS_BLOCK_END}\n10.0.0.5 other\n`;
    const merged = mergeHostsContent(existing, block);
    expect(merged).toContain("127.0.0.1 localhost");
    expect(merged).toContain("10.0.0.5 other");
    expect(merged).toContain("100.0.0.1\tfoo");
    expect(merged).not.toContain("9.9.9.9");
    // Only one managed block remains.
    expect(merged.split(HOSTS_BLOCK_BEGIN).length).toBe(2);
  });
});

describe("planFleetHosts + applyFleetHosts", () => {
  test("writes the managed block to the configured hosts file", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-hosts-"));
    const manifestPath = join(dir, "machines.json");
    const hostsPath = join(dir, "hosts");
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
    writeFileSync(hostsPath, "127.0.0.1 localhost\n", "utf8");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = manifestPath;
    process.env["HASNA_MACHINES_HOSTS_PATH"] = hostsPath;

    const runner = (command: string) => {
      if (command.includes("command -v tailscale")) return { stdout: "", exitCode: 0 };
      if (command.includes("tailscale status")) return { stdout: JSON.stringify(tailscale), exitCode: 0 };
      return { stdout: "", exitCode: 0 };
    };

    const plan = planFleetHosts({ runner, localSubnets: ["192.168.50"], localMachineId: "spark01" });
    expect(plan.entries.length).toBeGreaterThan(0);

    const applied = applyFleetHosts({ runner, localSubnets: ["192.168.50"], localMachineId: "spark01" });
    expect(applied.written).toBe(true);

    const contents = readFileSync(hostsPath, "utf8");
    expect(contents).toContain("127.0.0.1 localhost");
    expect(contents).toContain(HOSTS_BLOCK_BEGIN);
    expect(contents).toContain("machine001");

    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_HOSTS_PATH"];
  });
});
