import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  selfTestInstructionsDeploy,
  validateInstructionsDeploy,
} from "../../check-instructions-deploy";

const root = join(import.meta.dir, "../../../..");
const workflow = readFileSync(
  join(root, ".github/workflows/deploy-instructions.yml"),
  "utf8",
);

describe("standard-adherence: protected Instructions deployment lane", () => {
  test("the checked-in workflow satisfies the strict deployment contract", () => {
    expect(validateInstructionsDeploy(workflow, "ci", "1.3.14")).toEqual([]);
  });

  test("the checker proves a positive control and rejects its negative controls", () => {
    expect(selfTestInstructionsDeploy(root)).toEqual([]);
  });

  test("backs up the existing dataset to immutable S3 before migration", () => {
    expect(workflow.indexOf("Create immutable pre-deploy S3 backup")).toBeLessThan(
      workflow.indexOf("Run one-shot migration task on the digest"),
    );
    expect(workflow).toContain("storage backup push");
    expect(workflow).toContain("storage backup verify");
    expect(workflow).toContain("hasna-instructions-prod-backups-789877399345");
  });

  test("authenticated verification masks the key and proves existing rows", () => {
    expect(workflow).toContain('echo "::add-mask::${client_key}"');
    expect(workflow).toContain("hasna/oss/instructions/api-key");
    expect(workflow).toContain(".count | numbers | select(. >= 1");
    expect(workflow).not.toMatch(/echo[^\n]*client_key=/);
  });
});
