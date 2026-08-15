import { describe, expect, test } from "bun:test";
import {
  getConnectorCapability,
  getConnectorCapabilityManifest,
} from "./manifest.js";

describe("connector capability manifest", () => {
  test("returns prefixless connector capability with legacy alias", async () => {
    const capability = await getConnectorCapability("connect-stripe");

    expect(capability?.id).toBe("stripe");
    expect(capability?.name).toBe("stripe");
    expect(capability?.aliases).toEqual(["stripe", "connect-stripe"]);
    expect(capability?.runtime.packageName).toBe("@hasna/connectors");
    expect(capability?.runtime.configDirName).toBe("stripe");
    expect(capability?.runtime.legacyConfigDirName).toBe("connect-stripe");
    expect(capability?.auth.type).toBe("bearer");
  });

  test("can include operation descriptors for selected connectors", async () => {
    const manifest = await getConnectorCapabilityManifest({
      connectorNames: ["stripe"],
      includeOperations: true,
    });

    expect(manifest.version).toBe(1);
    expect(manifest.packageName).toBe("@hasna/connectors");
    expect(manifest.connectorCount).toBe(1);
    expect(manifest.connectors[0]?.id).toBe("stripe");
    expect(manifest.connectors[0]?.operations?.some((operation) => operation.name === "products")).toBe(true);
  });

  test("filters unknown connector names out of scoped manifests", async () => {
    const manifest = await getConnectorCapabilityManifest({
      connectorNames: ["connect-github", "does-not-exist"],
    });

    expect(manifest.connectorCount).toBe(1);
    expect(manifest.connectors[0]?.id).toBe("github");
  });

  test("includes twitter slug aliases on x connector capability", async () => {
    const capability = await getConnectorCapability("twitter");

    expect(capability?.id).toBe("x");
    expect(capability?.name).toBe("x");
    expect(capability?.aliases).toEqual(["x", "connect-x", "twitter", "x-twitter"]);
    expect(capability?.runtime.configDirName).toBe("x");
  });
});
