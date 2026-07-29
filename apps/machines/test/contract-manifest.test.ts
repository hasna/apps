import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Deployment modes were removed (owner directive 2026-07-29): the contract
// manifest must not declare one. The client block stays declarative about
// TRANSPORT (which env vars point at the hosted API) — declaring a "mode"
// is what let the vocabulary propagate to every scaffolded consumer.
describe("hasna.contract.json", () => {
  const raw = readFileSync(join(import.meta.dir, "..", "hasna.contract.json"), "utf8");
  const manifest = JSON.parse(raw) as { metadata?: { client?: Record<string, unknown> } };

  test("carries no deployment-mode vocabulary", () => {
    // Positive control: the manifest is real and still declares the client
    // transport env vars, so an empty file cannot fake a pass.
    expect(manifest.metadata?.client?.apiUrlEnv).toBe("MACHINES_API_URL");
    expect(manifest.metadata?.client?.apiKeyEnv).toBe("MACHINES_API_KEY");
    expect(manifest.metadata?.client?.mode).toBeUndefined();
    expect(raw).not.toMatch(/self[-_]hosted|deploymentMode|DEPLOYMENT_MODE/i);
  });
});
