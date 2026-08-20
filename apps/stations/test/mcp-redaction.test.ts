import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { closeDb, upsertHeartbeat } from "../src/db.js";
import { buildServer } from "../src/mcp/server.js";
import { PRIVATE_OUTPUT_DENIED_WARNING } from "../src/redaction.js";

const ENV_KEYS = [
  "HASNA_STATIONS_DB_PATH",
  "HASNA_STATIONS_MANIFEST_PATH",
  "HASNA_STATIONS_MACHINE_ID",
  "HASNA_STATIONS_ALLOW_PRIVATE_OUTPUT",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const server = buildServer("0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-redaction-test", version: "0.0.1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    return JSON.parse(text ?? "null") as unknown;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP public-safe redaction", () => {
  test("redacts private heartbeat and topology fields by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-mcp-redaction-"));
    process.env["HASNA_STATIONS_DB_PATH"] = join(dir, "stations.db");
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-01";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      hostname: "demo-node-01.private.example",
      sshAddress: "operator@demo-node-01.private.example",
      tailscaleName: "demo-node-01.tailnet.example",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });
    upsertHeartbeat("demo-node-01", 99, "online", {
      tailscale: { selfDnsName: "demo-node-01.tailnet.example", selfTailscaleIps: ["100.64.0.7"] },
      storageSyncLastError: "postgres://user:pass@10.0.0.5:5432/stations failed",
      privateMetadata: true,
    });

    const daemonStatus = await callTool("stations_daemon_status");
    const status = await callTool("stations_status");
    const deniedPrivateStatus = await callTool("stations_status", { private_metadata: true }) as { warnings?: string[] };
    const ssh = await callTool("stations_ssh_resolve", { machine_id: "demo-node-01" });
    const deniedPrivateSsh = await callTool("stations_ssh_resolve", { machine_id: "demo-node-01", private_metadata: true }) as { warnings?: string[] };
    const deniedPrivateDaemonStatus = await callTool("stations_daemon_status", { private_metadata: true }) as { warnings?: string[] };
    const topology = await callTool("stations_topology", { include_tailscale: false });
    const ungatedPrivateTopology = await callTool("stations_topology", { include_tailscale: false, private_metadata: true }) as { warnings?: string[] };
    process.env["HASNA_STATIONS_ALLOW_PRIVATE_OUTPUT"] = "1";
    const privateTopology = await callTool("stations_topology", { include_tailscale: false, private_metadata: true });

    expect(JSON.stringify(daemonStatus)).not.toContain("postgres://user:pass");
    expect(JSON.stringify(daemonStatus)).not.toContain("100.64.0.7");
    expect(JSON.stringify(status)).not.toContain("demo-node-01");
    expect(deniedPrivateStatus.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(JSON.stringify(ssh)).not.toContain("operator@demo-node-01.private.example");
    expect(deniedPrivateSsh.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(deniedPrivateDaemonStatus.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(JSON.stringify(topology)).not.toContain("demo-node-01.tailnet.example");
    expect(JSON.stringify(topology)).not.toContain("operator@demo-node-01.private.example");
    expect(JSON.stringify(ungatedPrivateTopology)).not.toContain("demo-node-01.tailnet.example");
    expect(ungatedPrivateTopology.warnings).toContain(PRIVATE_OUTPUT_DENIED_WARNING);
    expect(JSON.stringify(privateTopology)).toContain("demo-node-01.tailnet.example");
  });
});
