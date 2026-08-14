import { describe, expect, it } from "bun:test";
import {
  BROWSER_ALLOWED_DOMAINS_ENV,
  BROWSER_ALLOW_RISKY_CAPABILITIES_ENV,
  BROWSER_CAPABILITY_TOKEN_ENV,
  assertBrowserCapability,
  assertBrowserNavigationAllowed,
  classifyBrowserActionRisk,
  isBrowserCapabilityApproved,
} from "./policy.js";

describe("browser capability policy", () => {
  it("denies risky capabilities by default", () => {
    expect(isBrowserCapabilityApproved("cdp_attach", { env: {} })).toBe(false);
    expect(() => assertBrowserCapability("cdp_attach", { env: {} })).toThrow(/requires operator approval/);
  });

  it("allows explicit trusted local opt-in", () => {
    expect(isBrowserCapabilityApproved("tui_launch", {
      env: { [BROWSER_ALLOW_RISKY_CAPABILITIES_ENV]: "1" },
    })).toBe(true);
  });

  it("requires matching approval token when token mode is configured", () => {
    const env = {
      [BROWSER_ALLOW_RISKY_CAPABILITIES_ENV]: "1",
      [BROWSER_CAPABILITY_TOKEN_ENV]: "secret",
    };

    expect(isBrowserCapabilityApproved("storage_state", { env })).toBe(false);
    expect(isBrowserCapabilityApproved("storage_state", { env, approvalToken: "wrong" })).toBe(false);
    expect(isBrowserCapabilityApproved("storage_state", { env, approvalToken: "secret" })).toBe(true);
  });

  it("blocks non-allowlisted domains when an allowlist is configured", () => {
    const env = { [BROWSER_ALLOWED_DOMAINS_ENV]: "example.test,localhost" };

    expect(() => assertBrowserNavigationAllowed("https://app.example.test/path", { env })).not.toThrow();
    expect(() => assertBrowserNavigationAllowed("http://localhost:7030", { env })).not.toThrow();
    expect(() => assertBrowserNavigationAllowed("https://evil.test", { env })).toThrow(/not in BROWSER_ALLOWED_DOMAINS/);
  });

  it("classifies credential entry and account submit as approval-gated", () => {
    const password = classifyBrowserActionRisk({
      kind: "fill",
      label: "Password",
      fieldType: "password",
      instruction: "enter the account password",
    });
    expect(password.risk).toBe("sensitive");
    expect(password.requiresApproval).toBe(true);
    expect(password.tags).toContain("credential_entry");

    const submit = classifyBrowserActionRisk({
      kind: "click",
      label: "Continue",
      role: "button",
      instruction: "create account",
    });
    expect(submit.risk).toBe("sensitive");
    expect(submit.requiresApproval).toBe(true);
    expect(submit.tags).toContain("account_creation");
  });

  it("classifies legal, CAPTCHA, MFA, and external mutations without domain rules", () => {
    expect(classifyBrowserActionRisk({
      kind: "check",
      label: "I agree to the Terms and Privacy Policy",
      role: "checkbox",
    }).tags).toContain("legal_acceptance");

    expect(classifyBrowserActionRisk({
      kind: "click",
      label: "hCaptcha verify you are human",
      role: "button",
    }).tags).toContain("captcha");

    expect(classifyBrowserActionRisk({
      kind: "fill",
      label: "One-time verification code",
      role: "textbox",
    }).tags).toContain("mfa");

    const mutation = classifyBrowserActionRisk({
      kind: "click",
      label: "Add to cart",
      role: "button",
    });
    expect(mutation.risk).toBe("external_mutation");
    expect(mutation.requiresApproval).toBe(true);
  });

  it("approval-gates generic mutating verbs without site-specific rules", () => {
    for (const label of ["Confirm appointment", "Book reservation", "Update profile", "Create project"]) {
      const result = classifyBrowserActionRisk({
        kind: "click",
        label,
        role: "button",
        instruction: label.toLowerCase(),
      });
      expect(result.risk).toBe("external_mutation");
      expect(result.requiresApproval).toBe(true);
      expect(result.tags).toContain("external_mutation");
    }
  });

  it("approval-gates sensitive synonyms without site-specific rules", () => {
    const cases: Array<{ label: string; kind?: string; tags: string[]; risk?: string }> = [
      { label: "Destroy workspace", tags: ["delete", "irreversible_mutation"], risk: "sensitive" },
      { label: "SMS code", kind: "fill", tags: ["mfa"], risk: "sensitive" },
      { label: "Cloudflare Turnstile", tags: ["captcha"], risk: "sensitive" },
      { label: "I am not a robot", kind: "check", tags: ["captcha"], risk: "sensitive" },
      { label: "Passphrase", kind: "fill", tags: ["credential_entry"], risk: "sensitive" },
      { label: "PIN", kind: "fill", tags: ["credential_entry"], risk: "sensitive" },
      { label: "Authenticate", tags: ["credential_submit"], risk: "sensitive" },
      { label: "Deactivate account", tags: ["delete", "irreversible_mutation"], risk: "sensitive" },
      { label: "Erase all data", tags: ["delete", "irreversible_mutation"], risk: "sensitive" },
      { label: "Subscribe to paid plan", tags: ["payment"], risk: "sensitive" },
      { label: "Subscribe", tags: ["payment"], risk: "sensitive" },
      { label: "Donate", tags: ["payment"], risk: "sensitive" },
      { label: "Routing number", kind: "fill", tags: ["payment"], risk: "sensitive" },
      { label: "Agree and continue", kind: "check", tags: ["legal_acceptance"], risk: "sensitive" },
      { label: "Accept conditions", tags: ["legal_acceptance"], risk: "sensitive" },
      { label: "Save PDF", tags: ["file_download"], risk: "external_mutation" },
      { label: "Print invoice", tags: ["file_download"], risk: "external_mutation" },
      { label: "Import CSV", tags: ["file_upload"], risk: "sensitive" },
      { label: "Archive project", tags: ["delete", "irreversible_mutation"], risk: "sensitive" },
      { label: "Restore backup", tags: ["file_upload"], risk: "sensitive" },
      { label: "Enable integration", tags: ["external_mutation"], risk: "external_mutation" },
    ];

    for (const testCase of cases) {
      const result = classifyBrowserActionRisk({
        kind: testCase.kind ?? "click",
        label: testCase.label,
        role: testCase.kind === "fill" ? "textbox" : "button",
        instruction: testCase.label.toLowerCase(),
      });
      expect(result.risk).toBe(testCase.risk);
      expect(result.requiresApproval).toBe(true);
      for (const tag of testCase.tags) expect(result.tags).toContain(tag as any);
    }
  });

  it("approval-gates sensitive intent from the instruction, not only the label", () => {
    const cases = [
      {
        input: { kind: "fill", label: "Code", role: "textbox", instruction: "enter the account password" },
        tag: "credential_entry",
        risk: "sensitive",
      },
      {
        input: { kind: "fill", label: "Code", role: "textbox", instruction: "enter the PIN" },
        tag: "credential_entry",
        risk: "sensitive",
      },
      {
        input: { kind: "click", label: "Report", role: "button", instruction: "download report" },
        tag: "file_download",
        risk: "external_mutation",
      },
      {
        input: { kind: "click", label: "Archive", role: "button", instruction: "archive" },
        tag: "delete",
        risk: "sensitive",
      },
    ] as const;

    for (const testCase of cases) {
      const result = classifyBrowserActionRisk(testCase.input);
      expect(result.risk).toBe(testCase.risk);
      expect(result.requiresApproval).toBe(true);
      expect(result.tags).toContain(testCase.tag);
    }
  });

  it("does not gate obvious non-mutating view/filter labels as external mutations", () => {
    for (const label of ["Apply filter", "Confirm view", "Request demo details"]) {
      const result = classifyBrowserActionRisk({
        kind: "click",
        label,
        role: "button",
        instruction: label.toLowerCase(),
      });
      expect(result.risk).not.toBe("external_mutation");
      expect(result.requiresApproval).toBe(false);
    }
  });
});
