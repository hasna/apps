import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const workflowPath = new URL("../.github/workflows/deploy.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

describe("production deploy workflow contract", () => {
  test("pins every third-party action to an approved commit SHA", () => {
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    expect(uses).toEqual([
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
      "aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a",
    ]);
  });
});
