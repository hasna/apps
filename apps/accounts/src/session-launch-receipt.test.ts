import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bindSessionLaunchReceipt,
  prepareSessionLaunchReceipt,
  sessionLaunchProfileSha256,
  sessionLaunchSha256,
  type SessionLaunchReceiptRequest,
  type SessionLaunchRoute,
  type SessionLaunchTarget,
} from "./lib/session-launch-receipt.js";

let root = "";

function writeFixtureManifest(
  target: SessionLaunchTarget,
  options: { adapter?: string; fileContent?: string; blockers?: string[] } = {},
): void {
  const content = options.fileContent ?? "managed instructions\n";
  const relativePath = target.tool === "cursor" ? ".cursor/rules/hasna-global.mdc" : "AGENTS.md";
  const filePath = join(target.targetHome, relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
  mkdirSync(join(target.targetHome, ".hasna"), { recursive: true });
  writeFileSync(
    join(target.targetHome, ".hasna", "session-render-manifest.json"),
    JSON.stringify(
      {
        schema: "hasna.configs.session-render/v1",
        tool: target.tool,
        adapterMode: options.adapter ?? target.adapter,
        profile: target.profile,
        sessionId: `accounts:${target.tool}:${target.profile}`,
        targetHome: target.targetHome,
        targetKind: target.targetKind,
        writable: true,
        blocked: false,
        blockers: options.blockers ?? [],
        generatedAt: "2026-08-12T00:00:00.000Z",
        env: {},
        sourceHash: sessionLaunchSha256("source"),
        sources: [{ id: "global-source" }],
        skippedSources: [],
        files: [
          {
            path: filePath,
            relativePath,
            role: target.tool === "cursor" ? "rule" : "index",
            sha256: sessionLaunchSha256(content),
            sourceIds: ["global-source"],
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
}

function fixture(): { target: SessionLaunchTarget; request: SessionLaunchReceiptRequest; route: SessionLaunchRoute } {
  root = mkdtempSync(join(tmpdir(), "accounts-launch-receipt-"));
  const target: SessionLaunchTarget = {
    tool: "codewith",
    profile: "account001",
    targetHome: root,
    targetKind: "session-home",
    adapter: "native-imports",
  };
  writeFixtureManifest(target);
  const route: SessionLaunchRoute = {
    tool: target.tool,
    profile: target.profile,
    model: "gpt-5.5",
    provider: "openai",
    reasoningEffort: "high",
    serviceTier: null,
    profileIdentitySha256: sessionLaunchProfileSha256(target.profile),
    permissionProfileSha256: sessionLaunchSha256("default-permissions"),
  };
  return {
    target,
    route,
    request: {
      target,
      requested: route,
      runtime: {
        packageName: "@hasna/accounts",
        packageVersion: "0.2.43",
        runtime: "codewith",
      },
      capabilityRequests: [
        { name: "durable_launch_receipt_v1", required: true },
        { name: "restart_stable_account_binding", required: false },
        { name: "future_capability", required: false },
      ],
      availableCapabilities: ["durable_launch_receipt_v1"],
    },
  };
}

function cleanup(): void {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
}

describe("session launch receipt", () => {
  afterEach(cleanup);

  test("binds a typed requested/effective receipt to a verified manifest", () => {
    const { request, route } = fixture();
    const prepared = prepareSessionLaunchReceipt(request);
    const receipt = bindSessionLaunchReceipt(prepared, route);

    expect(receipt.schema).toBe("hasna.accounts.session-launch-receipt/v1");
    expect(receipt.requested).toEqual(receipt.effective);
    expect(receipt.mismatches).toEqual([]);
    expect(receipt.instructions.adapter).toBe("native-imports");
    expect(receipt.instructions.sourceIds).toEqual(["global-source"]);
    expect(receipt.capabilities).toEqual([
      { name: "durable_launch_receipt_v1", required: true, status: "supported" },
      {
        name: "restart_stable_account_binding",
        required: false,
        status: "unavailable",
        reason: "capability_unavailable_for_launch",
      },
      {
        name: "future_capability",
        required: false,
        status: "unsupported_unknown",
        reason: "unknown_optional_capability",
      },
    ]);
    expect(JSON.stringify(receipt)).not.toContain("token");
  });

  test("fails closed when the effective route changes", () => {
    const { request, route } = fixture();
    const prepared = prepareSessionLaunchReceipt(request);
    expect(() =>
      bindSessionLaunchReceipt(prepared, { ...route, model: "gpt-5.4" }),
    ).toThrow(/session_launch_receipt_mismatch/);
  });

  test("fails closed when the manifest adapter is not the requested adapter", () => {
    const { request } = fixture();
    writeFixtureManifest(request.target, { adapter: "flattened-markdown" });
    expect(() => prepareSessionLaunchReceipt(request)).toThrow(
      /adapter differs from requested target|not supported/,
    );
  });

  test("fails closed when a required capability is unavailable", () => {
    const { request } = fixture();
    expect(() =>
      prepareSessionLaunchReceipt({
        ...request,
        capabilityRequests: [{ name: "auth_profile_binding", required: true }],
      }),
    ).toThrow(/required capability "auth_profile_binding" is not supported/);
  });

  test("fails closed on manifest file drift and blockers", () => {
    const { request } = fixture();
    writeFixtureManifest(request.target, { blockers: ["missing canonical source"] });
    expect(() => prepareSessionLaunchReceipt(request)).toThrow(/contains blockers/);
  });
});
