import { describe, expect, test } from "bun:test";
import {
  MACHINES_CONSUMER_CAPABILITIES,
  MACHINES_CONSUMER_CONTRACT,
  MACHINES_CONSUMER_ENTRYPOINT,
  MACHINES_CONSUMER_CONTRACT_VERSION,
  checkMachineCompatibility,
  discoverMachineTopology,
  getMachinesConsumerCapabilities,
  resolveMachineRoute,
  resolveMachineWorkspace,
} from "../src/consumer.js";

describe("machines consumer SDK", () => {
  test("exports lightweight consumer contracts", () => {
    expect(MACHINES_CONSUMER_CONTRACT_VERSION).toBe(1);
    expect(MACHINES_CONSUMER_ENTRYPOINT).toBe("@hasna/machines/consumer");
    expect(MACHINES_CONSUMER_CAPABILITIES.workspace_path_mapping).toBe(true);
    expect(getMachinesConsumerCapabilities()).toEqual(MACHINES_CONSUMER_CAPABILITIES);
    expect(MACHINES_CONSUMER_CONTRACT).toMatchObject({
      schema_version: 1,
      package_name: "@hasna/machines",
      entrypoint: "@hasna/machines/consumer",
      envelopes: ["topology", "route", "workspace", "compatibility"],
    });
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("resolveMachineWorkspace");
    expect(typeof discoverMachineTopology).toBe("function");
    expect(typeof checkMachineCompatibility).toBe("function");
    expect(typeof resolveMachineRoute).toBe("function");
    expect(typeof resolveMachineWorkspace).toBe("function");
  });
});
