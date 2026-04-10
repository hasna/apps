import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAgentStatus, markOffline, writeHeartbeat } from "../src/agent/runtime.js";

describe("agent runtime", () => {
  test("writes and reads heartbeat state", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-agent-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";

    const heartbeat = writeHeartbeat("online");
    expect(heartbeat.machineId).toBe("spark01");

    const statuses = getAgentStatus("spark01");
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0]?.status).toBe("online");
  });

  test("marks current process offline", () => {
    const offline = markOffline();
    expect(offline.status).toBe("offline");
  });
});
