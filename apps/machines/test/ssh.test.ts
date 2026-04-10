import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildSshCommand, resolveSshTarget } from "../src/commands/ssh.js";

describe("smart ssh", () => {
  test("prefers LAN when reachable", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-ssh-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_REACHABLE_HOSTS"] = "hasna@spark01";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      sshAddress: "hasna@spark01",
      tailscaleName: "spark01.tailnet.ts.net",
    });

    const resolved = resolveSshTarget("spark01");
    expect(resolved.route).toBe("lan");
    expect(buildSshCommand("spark01")).toBe("ssh hasna@spark01");
  });

  test("falls back to tailscale when LAN is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-ssh-ts-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_REACHABLE_HOSTS"] = "other-host";
    process.env["HASNA_MACHINES_MACHINE_ID"] = "control";
    manifestInit();
    manifestAdd({
      id: "apple03",
      platform: "macos",
      workspacePath: "/Users/hasna/Workspace",
      sshAddress: "hasna@apple03",
      tailscaleName: "apple03.tailnet.ts.net",
    });

    const resolved = resolveSshTarget("apple03");
    expect(resolved.route).toBe("tailscale");
    expect(buildSshCommand("apple03", "uptime")).toBe(`ssh apple03.tailnet.ts.net ${JSON.stringify("uptime")}`);
  });
});
