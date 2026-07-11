import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "../db/schema.js";
import { setKernelClientFactoryForTests, setKernelSecretsProviderForTests, type KernelSecretsProvider } from "../engines/kernel.js";
import { runWorkflowAction } from "./workflow-manifests.js";

let tmpDir: string;
let executeResult: Record<string, unknown> = { result: { result: { status: "ok" }, screenshots: [] } };
let executeError: Error | undefined;
let readFileError: Error | undefined;
let retrieveDeleted = true;

const provider: KernelSecretsProvider = {
  async getSecretValue(key) {
    return key === "hasna/xyz/opensource/browser/prod/kernel_api_key" ? "kernel-test-key" : undefined;
  },
  async matchVaultItemsForUrl() {
    return [];
  },
  async getVaultItem() {
    return undefined;
  },
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-workflow-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
  executeResult = { result: { result: { status: "ok" }, screenshots: [] } };
  executeError = undefined;
  readFileError = undefined;
  retrieveDeleted = true;
  setKernelSecretsProviderForTests(provider);
  setKernelClientFactoryForTests(() => ({
    browsers: {
      async create() {
        return { session_id: "kernel-workflow-session", cdp_ws_url: "wss://kernel.test/cdp" };
      },
      async deleteByID() {},
      async retrieve() {
        return {
          session_id: "kernel-workflow-session",
          status: retrieveDeleted ? "deleted" : "active",
          deleted_at: retrieveDeleted ? "2026-06-29T00:00:00.000Z" : null,
        };
      },
      playwright: {
        async execute() {
          if (executeError) throw executeError;
          return executeResult;
        },
      },
      fs: {
        async readFile() {
          if (readFileError) throw readFileError;
          return new Response(Buffer.from("fake-image"));
        },
      },
    },
  }));
  writeKernelWorkflow();
});

afterEach(() => {
  resetDatabase();
  setKernelClientFactoryForTests(undefined);
  setKernelSecretsProviderForTests(undefined);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("file-backed Kernel workflow runs", () => {
  it("marks evidence failed when Kernel execution returns success false", async () => {
    executeResult = { result: { success: false, error: "remote failed", stderr: "remote stack" } };

    const evidence = await runWorkflowAction("kernel-demo", { action: "smoke" });

    expect(evidence.ok).toBe(false);
    expect(evidence.error).toContain("remote failed");
    expect(evidence.cleanup).toMatchObject({ closeAttempted: true, closed: true, verified: true });
  });

  it("closes and verifies cleanup when Kernel execution throws", async () => {
    executeError = new Error("execution died at wss://kernel.test/cdp-token");

    const evidence = await runWorkflowAction("kernel-demo", { action: "smoke" });

    expect(evidence.ok).toBe(false);
    expect(evidence.error).toContain("Failed to execute Playwright code");
    expect(evidence.error).toContain("[redacted-kernel-websocket-url]");
    expect(evidence.cleanup).toMatchObject({ closeAttempted: true, closed: true, verified: true });
  });

  it("fails evidence but still verifies cleanup when screenshot download fails", async () => {
    executeResult = {
      result: {
        result: { status: "shot" },
        screenshots: [{ label: "shot", remotePath: "/tmp/shot.png", runId: "run", action: "smoke" }],
      },
    };
    readFileError = new Error("fs unavailable");

    const evidence = await runWorkflowAction("kernel-demo", { action: "smoke" });

    expect(evidence.ok).toBe(false);
    expect(evidence.error).toContain("Failed to download Kernel file");
    expect(evidence.cleanup).toMatchObject({ closeAttempted: true, closed: true, verified: true });
  });

  it("does not verify cleanup when Kernel retrieve still reports active after delete", async () => {
    retrieveDeleted = false;

    const evidence = await runWorkflowAction("kernel-demo", { action: "smoke" });

    expect(evidence.ok).toBe(false);
    expect(evidence.cleanup).toMatchObject({
      closeAttempted: true,
      closed: false,
      verified: false,
      statusAfterClose: "active",
    });
  });
});

function writeKernelWorkflow() {
  const workflowDir = join(tmpDir, "workflows", "kernel-demo", "actions");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(join(workflowDir, "smoke.js"), "return { status: \"local script not executed by test mock\" };\n");
  writeFileSync(join(tmpDir, "workflows", "kernel-demo", "manifest.json"), JSON.stringify({
    name: "kernel-demo",
    site: "example.test",
    runner: "kernel",
    startUrl: "https://example.test/",
    actions: {
      smoke: {
        description: "Kernel smoke test",
        scriptFile: "actions/smoke.js",
        mutatesExternalAccount: false,
      },
    },
    kernel: {
      closeAfterRun: true,
      timeoutSeconds: 60,
      stealth: false,
      authMode: "off",
    },
    stopConditions: ["interactive-captcha", "mfa", "payment", "purchase", "identity-verification"],
    secrets: {},
    evidence: {
      captureBeforeClose: true,
      verifySessionCleanup: true,
    },
    safety: {
      redactSecrets: true,
      stopBeforeSensitiveActions: true,
      allowCustomCaptchaSolving: false,
    },
  }, null, 2));
}
