import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { ArtifactStorage } from "./artifact-storage.js";
import { resolveServerConfig } from "./config.js";

test("ephemeral artifacts can expire without moving immutable bundle and version keys", () => {
  const storage = new ArtifactStorage({ prefix: "prod/artifacts", runPrefix: "prod/runs" });
  expect(storage.objectKeyFor("tenant", "run", "out.pdf")).toBe("prod/runs/tenant/run/out.pdf");
  expect(storage.quarantineKeyFor("tenant", "run", "output")).toBe("prod/runs/quarantine/tenant/run/output");
  expect(storage.versionKeyFor("tenant", "pdf-generate", "0.1.0", "bundle.tar.gz")).toBe("prod/artifacts/skills/tenant/pdf-generate/0.1.0/bundle.tar.gz");
  expect(resolveServerConfig({ HASNA_SKILLS_S3_RUN_PREFIX: "/prod/runs/" }).runArtifactPrefix).toBe("prod/runs");
});

test("existing installations preserve their run object prefix until configured", () => {
  expect(new ArtifactStorage({ prefix: "existing" }).objectKeyFor("tenant", "run", "out.pdf")).toBe("existing/tenant/run/out.pdf");
});
