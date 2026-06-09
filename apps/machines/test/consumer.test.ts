import { describe, expect, test } from "bun:test";
import {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  checkMachineCompatibility,
  discoverMachineTopology,
  resolveMachineRoute,
  resolveMachineWorkspace,
} from "../src/consumer.js";

describe("machines consumer SDK", () => {
  test("exports lightweight consumer contracts", () => {
    expect(MACHINES_CONSUMER_CONTRACT_VERSION).toBe(1);
    expect(typeof discoverMachineTopology).toBe("function");
    expect(typeof checkMachineCompatibility).toBe("function");
    expect(typeof resolveMachineRoute).toBe("function");
    expect(typeof resolveMachineWorkspace).toBe("function");
  });
});
