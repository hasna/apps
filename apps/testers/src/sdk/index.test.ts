import { describe, test, expect } from "bun:test";

describe("SDK/library API (OPE9-00273)", () => {
  test("re-exports scenario management functions", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.createScenario).toBe("function");
    expect(typeof sdk.getScenario).toBe("function");
    expect(typeof sdk.listScenarios).toBe("function");
    expect(typeof sdk.updateScenario).toBe("function");
    expect(typeof sdk.deleteScenario).toBe("function");
  });

  test("re-exports run management functions", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.getRun).toBe("function");
    expect(typeof sdk.listRuns).toBe("function");
    expect(typeof sdk.updateRun).toBe("function");
    expect(typeof sdk.getResult).toBe("function");
    expect(typeof sdk.getResultsByRun).toBe("function");
  });

  test("re-exports persona management functions", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.createPersona).toBe("function");
    expect(typeof sdk.getPersona).toBe("function");
    expect(typeof sdk.listPersonas).toBe("function");
    expect(typeof sdk.updatePersona).toBe("function");
    expect(typeof sdk.deletePersona).toBe("function");
  });

  test("re-exports templates", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.getTemplate).toBe("function");
    expect(typeof sdk.listTemplateNames).toBe("function");
    expect(sdk.SCENARIO_TEMPLATES).toBeDefined();
    expect(Array.isArray(sdk.listTemplateNames())).toBe(true);
  });

  test("re-exports reporting functions", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.generateHtmlReport).toBe("function");
    expect(typeof sdk.saveHtmlReport).toBe("function");
    expect(typeof sdk.toJUnitXml).toBe("function");
  });

  test("re-exports responsive testing", async () => {
    const sdk = await import("../sdk/index.js");
    expect(sdk.DEVICE_PRESETS).toBeDefined();
    expect(typeof sdk.setDevicePreset).toBe("function");
    expect(typeof sdk.listDevicePresets).toBe("function");
  });

  test("re-exports batch actions", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.batchActions).toBe("function");
    expect(typeof sdk.hasBatchFailures).toBe("function");
    expect(typeof sdk.formatBatchResults).toBe("function");
  });

  test("re-exports performance testing", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.collectPerformanceMetrics).toBe("function");
    expect(typeof sdk.checkBudget).toBe("function");
    expect(typeof sdk.DEFAULT_BUDGET).toBe("object");
  });

  test("re-exports accessibility audit", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.runA11yAudit).toBe("function");
    expect(typeof sdk.hasA11yIssues).toBe("function");
    expect(typeof sdk.formatA11yResults).toBe("function");
  });

  test("re-exports environment detection", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.detectEnvironment).toBe("function");
    expect(typeof sdk.getEnvInfo).toBe("function");
  });

  test("re-exports network mocking", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.setupNetworkMocks).toBe("function");
    expect(typeof sdk.MockPresets).toBe("object");
  });

  test("re-exports visual regression", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.setBaseline).toBe("function");
    expect(typeof sdk.getBaseline).toBe("function");
    expect(typeof sdk.compareImages).toBe("function");
  });

  test("re-exports runner functions", async () => {
    const sdk = await import("../sdk/index.js");
    expect(typeof sdk.startRunAsync).toBe("function");
    expect(typeof sdk.runSingleScenario).toBe("function");
    expect(typeof sdk.runBatch).toBe("function");
    expect(typeof sdk.runByFilter).toBe("function");
    expect(typeof sdk.onRunEvent).toBe("function");
  });
});
