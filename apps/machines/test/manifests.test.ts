import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  manifestAdd,
  manifestBootstrapCurrentMachine,
  manifestInit,
  manifestRemove,
  manifestValidate,
} from "../src/commands/manifest.js";
import { detectCurrentMachineManifest, readManifest } from "../src/manifests.js";

describe("manifest commands", () => {
  test("initializes and adds machines", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-manifest-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");

    const path = manifestInit();
    expect(path).toContain("machines.json");
    expect(readManifest().machines).toHaveLength(0);

    const updated = manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "~/workspace",
    });

    expect(updated.machines).toHaveLength(1);
    expect(updated.machines[0]?.id).toBe("spark01");
  });

  test("bootstraps and removes the current machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-bootstrap-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "apple03";

    manifestInit();
    const bootstrapped = manifestBootstrapCurrentMachine();
    expect(bootstrapped.machines).toHaveLength(1);
    expect(bootstrapped.machines[0]?.id).toBe("apple03");

    const trimmed = manifestRemove("apple03");
    expect(trimmed.machines).toHaveLength(0);
  });

  test("detects current machine defaults and validates manifest", () => {
    const detected = detectCurrentMachineManifest();
    expect(detected.id.length).toBeGreaterThan(0);
    expect(detected.workspacePath.length).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), "machines-validate-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    expect(manifestValidate().version).toBe(1);
  });
});
