import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instanceId, loadPreviewManifest, previewKey, selectPreviewApps, workerName } from "./config.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(apps: unknown[]) { const root = mkdtempSync(join(tmpdir(), "preview-manifest-")); roots.push(root); writeFileSync(join(root, "servers.config.json"), JSON.stringify({ version: 1, product: "studio", apps })); return root; }
const web = { name: "web", command: "bun run dev", port: 3000 };
describe("portable preview identities", () => {
  it("names remain stable across machines and long product/app combinations cannot collide", () => {
    const key = previewKey({ product: "studio", app: "web", environment: "dev", name: "main" });
    expect(workerName(key)).toBe(workerName(key));
    expect(workerName(`${"a".repeat(63)}/web/dev/main`).length).toBeLessThanOrEqual(63);
    expect(workerName(`${"a".repeat(63)}/web/dev/main`)).not.toBe(workerName(`${"a".repeat(63)}/web/dev/other`));
    const first = fixture([web]); const second = fixture([web]);
    expect(instanceId(key, first, "laptop")).not.toBe(instanceId(key, second, "laptop"));
    expect(instanceId(key, first, "laptop")).not.toBe(instanceId(key, first, "desktop"));
  });
  it("requires explicit product scope, topologically orders groups and detects cycles", () => {
    const root = fixture([{ ...web, dependencies: ["api"] }, { ...web, name: "api", port: 4000 }]);
    const manifest = loadPreviewManifest(root);
    expect(selectPreviewApps(manifest, { app: "studio/web" }).map((app) => app.name)).toEqual(["api", "web"]);
    expect(() => selectPreviewApps(manifest, { app: "web" })).toThrow();
    expect(() => selectPreviewApps(manifest, { product: "commerce" })).toThrow();
    expect(() => selectPreviewApps(manifest, { product: "studio", environment: "production" })).toThrow();
    manifest.manifest.apps[1]!.dependencies = ["web"];
    expect(() => selectPreviewApps(manifest, { product: "studio" })).toThrow("cycle");
  });
  it("rejects inline env credentials, unknown fields and directories outside repository including symlinks", () => {
    expect(() => loadPreviewManifest(fixture([{ ...web, env: { PASSWORD: "inline" } }]))).toThrow("Invalid");
    expect(() => loadPreviewManifest(fixture([{ ...web, envRefs: { PASSWORD: "inline-value" } }]))).toThrow("Invalid");
    expect(() => loadPreviewManifest(fixture([{ ...web, directory: ".." }]))).toThrow("inside");
    const root = fixture([{ ...web, directory: "outside" }]); const elsewhere = fixture([web]);
    symlinkSync(elsewhere, join(root, "outside"));
    expect(() => loadPreviewManifest(root)).toThrow("inside");
  });
  it("finds a manifest from a nested app and only accepts local callback paths", () => {
    const root = fixture([{ ...web, oauth: { callbackPaths: ["/api/auth/callback/google"] } }]);
    mkdirSync(join(root, "nested"));
    expect(loadPreviewManifest(join(root, "nested")).root).toBe(root);
    expect(() => loadPreviewManifest(fixture([{ ...web, oauth: { callbackPaths: ["//other.example/callback"] } }]))).toThrow();
  });
});
