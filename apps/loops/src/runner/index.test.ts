import { describe, expect, test } from "bun:test";
import { runnerStatus } from "./index.js";

describe("loops-runner foundation", () => {
  test("reports local daemon authority by default", () => {
    const status = runnerStatus();

    expect(status.ok).toBe(true);
    expect(status.service).toBe("loops-runner");
    expect(status.deployment.deploymentMode).toBe("local");
    expect(status.state).toBe("local_daemon_authoritative");
  });

  test("fails closed for configured self-hosted mode until the runner protocol exists", () => {
    const previousMode = process.env.LOOPS_MODE;
    const previousDatabaseUrl = process.env.LOOPS_DATABASE_URL;
    process.env.LOOPS_MODE = "self_hosted";
    process.env.LOOPS_DATABASE_URL = "postgres://loops.example.test/openloops";

    try {
      const status = runnerStatus("machine-test");

      expect(status.ok).toBe(false);
      expect(status.machineId).toBe("machine-test");
      expect(status.deployment.deploymentMode).toBe("self_hosted");
      expect(status.deployment.controlPlane.configured).toBe(true);
      expect(status.state).toBe("control_plane_protocol_pending");
    } finally {
      if (previousMode === undefined) delete process.env.LOOPS_MODE;
      else process.env.LOOPS_MODE = previousMode;
      if (previousDatabaseUrl === undefined) delete process.env.LOOPS_DATABASE_URL;
      else process.env.LOOPS_DATABASE_URL = previousDatabaseUrl;
    }
  });
});
