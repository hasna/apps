import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APPS_DIR, conformanceCommand, runConformance } from "./census";

const manifest = JSON.parse(readFileSync(join(APPS_DIR, "contracts/package.json"), "utf8"));

test("the in-tree release candidate validates real manifests before registry publication", () => {
  const valid = runConformance("apps/switcher", manifest.version);
  expect(valid.verdict, valid.raw).toBe("ok");
  const scratch = join(homedir(), "Workspace/scratch/contracts-candidate-test");
  mkdirSync(scratch, {recursive: true});
  const fixture = mkdtempSync(join(scratch, "invalid-"));
  try {
    writeFileSync(join(fixture, "package.json"), JSON.stringify({name: "@hasna/invalid-candidate", version: "0.0.0"}));
    writeFileSync(join(fixture, "hasna.contract.json"), JSON.stringify({schema: "invalid-schema"}));
    const invalid = runConformance(fixture, manifest.version);
    expect(invalid.verdict, invalid.raw).toBe("fail");
    expect(invalid.fails.join(" ")).toContain("manifest_valid");
  } finally {rmSync(fixture, {recursive: true, force: true});}
}, 30_000);

test("older pins, ranges and latest cannot silently use the in-tree validator", () => {
  for (const requested of ["0.11.1", `^${manifest.version}`, "latest"])
    expect(conformanceCommand(requested)).toEqual({executable: "bunx", args: ["--bun", `@hasna/contracts@${requested}`]});
});
