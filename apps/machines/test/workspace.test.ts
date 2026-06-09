import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";

const ENV_KEYS = [
  "HASNA_MACHINES_MANIFEST_PATH",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("workspace resolver CLI", () => {
  test("prints machine workspace mapping as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-cli-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      manifestInit();
      manifestAdd({
        id: "spark01",
        platform: "linux",
        workspacePath: "/home/hasna/workspace",
        metadata: {
          workspace_paths: {
            "open-knowledge": "/srv/open-knowledge",
          },
          open_files_root: "/srv/open-files",
          trusted: true,
        },
      });

      const result = spawnSync(process.execPath, [
        "run",
        "src/cli/index.ts",
        "workspace",
        "resolve",
        "--machine",
        "spark01",
        "--project",
        "open-knowledge",
        "--repo",
        "open-knowledge",
        "--no-tailscale",
        "--json",
      ], {
        cwd: join(import.meta.dir, ".."),
        env: process.env,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.machine_id).toBe("spark01");
      expect(output.paths.project_root.path).toBe("/srv/open-knowledge");
      expect(output.paths.open_files_root.path).toBe("/srv/open-files");
      expect(output.machine.trust_status).toBe("trusted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
