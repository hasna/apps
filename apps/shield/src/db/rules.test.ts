import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDb } from "./test-helpers.js";
import {
  createRule,
  getRule,
  listRules,
  updateRule,
  toggleRule,
  seedBuiltinRules,
} from "./rules.js";
import { ScannerType, Severity } from "../types/index.js";

describe("rules", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setupTestDb();
  });

  afterEach(() => {
    cleanup();
  });

  test("createRule returns a rule with generated id", () => {
    const rule = createRule({
      name: "test-rule",
      description: "A test rule",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      pattern: "test.*pattern",
      enabled: true,
      builtin: false,
      metadata: { category: "test" },
    });

    expect(rule.id).toBeDefined();
    expect(rule.name).toBe("test-rule");
    expect(rule.description).toBe("A test rule");
    expect(rule.scanner_type).toBe(ScannerType.Secrets);
    expect(rule.severity).toBe(Severity.High);
    expect(rule.pattern).toBe("test.*pattern");
    expect(rule.enabled).toBe(true);
    expect(rule.builtin).toBe(false);
    expect(rule.metadata).toEqual({ category: "test" });
  });

  test("getRule retrieves a rule by id", () => {
    const created = createRule({
      name: "fetch-me",
      description: "Fetchable rule",
      scanner_type: ScannerType.Code,
      severity: Severity.Critical,
      pattern: null,
      enabled: true,
      builtin: true,
      metadata: {},
    });

    const fetched = getRule(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("fetch-me");
    expect(fetched!.builtin).toBe(true);
    expect(fetched!.metadata).toEqual({});
  });

  test("getRule returns null for unknown id", () => {
    expect(getRule("nonexistent")).toBeNull();
  });

  test("listRules returns all rules", () => {
    createRule({
      name: "rule-a",
      description: "",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });
    createRule({
      name: "rule-b",
      description: "",
      scanner_type: ScannerType.Code,
      severity: Severity.Medium,
      pattern: null,
      enabled: false,
      builtin: false,
      metadata: {},
    });

    const rules = listRules();
    expect(rules.length).toBe(2);
  });

  test("listRules filters by scanner_type", () => {
    createRule({
      name: "secrets-rule",
      description: "",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });
    createRule({
      name: "code-rule",
      description: "",
      scanner_type: ScannerType.Code,
      severity: Severity.Medium,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });

    const secretsRules = listRules(ScannerType.Secrets);
    expect(secretsRules.length).toBe(1);
    expect(secretsRules[0].name).toBe("secrets-rule");
  });

  test("listRules filters by enabled", () => {
    createRule({
      name: "enabled-rule",
      description: "",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });
    createRule({
      name: "disabled-rule",
      description: "",
      scanner_type: ScannerType.Secrets,
      severity: Severity.Medium,
      pattern: null,
      enabled: false,
      builtin: false,
      metadata: {},
    });

    const enabled = listRules(undefined, true);
    expect(enabled.length).toBe(1);
    expect(enabled[0].name).toBe("enabled-rule");

    const disabled = listRules(undefined, false);
    expect(disabled.length).toBe(1);
    expect(disabled[0].name).toBe("disabled-rule");
  });

  test("updateRule updates individual fields", () => {
    const rule = createRule({
      name: "original-name",
      description: "original",
      scanner_type: ScannerType.Secrets,
      severity: Severity.Low,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });

    updateRule(rule.id, { name: "updated-name", severity: Severity.Critical });

    const updated = getRule(rule.id);
    expect(updated!.name).toBe("updated-name");
    expect(updated!.severity).toBe(Severity.Critical);
    expect(updated!.description).toBe("original"); // unchanged
  });

  test("updateRule updates metadata", () => {
    const rule = createRule({
      name: "meta-rule",
      description: "",
      scanner_type: ScannerType.Code,
      severity: Severity.Medium,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: { old: true },
    });

    updateRule(rule.id, { metadata: { new: true, cwe: "CWE-79" } });

    const updated = getRule(rule.id);
    expect(updated!.metadata).toEqual({ new: true, cwe: "CWE-79" });
  });

  test("updateRule with no fields is a no-op", () => {
    const rule = createRule({
      name: "noop-rule",
      description: "",
      scanner_type: ScannerType.Secrets,
      severity: Severity.Low,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });

    updateRule(rule.id, {}); // should not throw
    const fetched = getRule(rule.id);
    expect(fetched!.name).toBe("noop-rule");
  });

  test("toggleRule enables/disables a rule", () => {
    const rule = createRule({
      name: "toggle-me",
      description: "",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });

    toggleRule(rule.id, false);
    expect(getRule(rule.id)!.enabled).toBe(false);

    toggleRule(rule.id, true);
    expect(getRule(rule.id)!.enabled).toBe(true);
  });

  test("seedBuiltinRules creates builtin rules", () => {
    seedBuiltinRules();
    const rules = listRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.builtin)).toBe(true);
  });

  test("seedBuiltinRules is idempotent (does not duplicate on second call)", () => {
    seedBuiltinRules();
    const count1 = listRules().length;

    seedBuiltinRules();
    const count2 = listRules().length;

    expect(count2).toBe(count1);
  });

  test("seedBuiltinRules creates rules for multiple scanner types", () => {
    seedBuiltinRules();
    const rules = listRules();
    const scannerTypes = new Set(rules.map((r) => r.scanner_type));
    expect(scannerTypes.size).toBeGreaterThanOrEqual(4);
  });
});
