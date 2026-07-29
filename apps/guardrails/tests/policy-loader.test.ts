import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadGuardrailInput, loadPolicySet, parseGuardrailInput, validatePolicySet } from "../src";

const paths: string[] = [];

async function fixture(name: string, value: unknown): Promise<string> {
  const path = join(tmpdir(), `open-guardrails-${randomUUID()}-${name}.json`);
  paths.push(path);
  await Bun.write(path, JSON.stringify(value));
  return path;
}

afterAll(async () => {
  await Promise.all(paths.map((path) => rm(path, { force: true })));
});

describe("policy loading and validation", () => {
  test("loads JSON input and a validated policy set from files", async () => {
    const inputPath = await fixture("input", { operationType: "prompt", prompt: { text: "placeholder" } });
    const policyPath = await fixture("policy", {
      id: "file-policy",
      policies: [{ id: "warn", effect: "warn", reason: "Placeholder warning." }],
    });

    expect(await loadGuardrailInput(inputPath)).toEqual({
      operationType: "prompt",
      prompt: { text: "placeholder" },
    });
    expect((await loadPolicySet(policyPath)).id).toBe("file-policy");
  });

  test("reports schema errors without accepting malformed policies", () => {
    const valid = validatePolicySet({ id: "valid", policies: [] });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.policySet).toEqual({ id: "valid", policies: [] });

    const invalid = validatePolicySet({ id: "invalid", policies: [{ id: "missing-fields" }] });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors[0]).toContain("effect");
  });

  test("rejects invalid input and every policy regex location", () => {
    expect(() => parseGuardrailInput({ operationType: "unknown" })).toThrow("operationType");
    const invalid = validatePolicySet({
      id: "invalid-regexes",
      policies: [
        {
          id: "invalid",
          effect: "deny",
          reason: "Invalid placeholder patterns.",
          when: {
            textPatterns: ["(?i)["],
            command: { patterns: ["["] },
            source: { uriPatterns: ["["] },
            runtime: { pathPatterns: ["["] },
            browser: { urlPatterns: ["["] },
          },
          redactions: [{ pattern: "[" }],
        },
      ],
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors[0]).toContain("when.command.patterns");
      expect(invalid.errors[0]).toContain("when.source.uriPatterns");
      expect(invalid.errors[0]).toContain("when.runtime.pathPatterns");
      expect(invalid.errors[0]).toContain("when.browser.urlPatterns");
      expect(invalid.errors[0]).toContain("redactions.0.pattern");
    }
  });

  test("rejects invalid JSON and invalid policy files", async () => {
    const jsonPath = join(tmpdir(), `open-guardrails-${randomUUID()}-invalid.json`);
    paths.push(jsonPath);
    await Bun.write(jsonPath, "not json");
    await expect(loadGuardrailInput(jsonPath)).rejects.toThrow();

    const policyPath = await fixture("invalid-policy", { id: "invalid", policies: "not-an-array" });
    await expect(loadPolicySet(policyPath)).rejects.toThrow("policies");
  });
});
