import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import {
  coerceModelAction,
  getCachedSemanticAction,
  getSemanticActionCacheScope,
  observeSemanticActions,
  runSemanticAction,
  type SemanticAction,
  type SemanticPageMap,
} from "./semantic-actions.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

describe("semantic actions", () => {
  it("observes fields outside form elements", async () => {
    await page.setContent(`
      <main>
        <label for="email">Email Address</label>
        <input id="email" type="email" placeholder="user@example.com">
      </main>
    `);

    const observed = await observeSemanticActions(page, "semantic-test-loose", "find the email field", {
      useModel: false,
    });

    expect(observed.actions[0].kind).toBe("fill");
    expect(observed.actions[0].selector).toBe("#email");
  });

  it("fills the intended duplicate anonymous field with a unique selector", async () => {
    await page.setContent(`
      <main>
        <label>First <input></label>
        <label>Last <input></label>
      </main>
    `);

    const observed = await observeSemanticActions(page, "semantic-test-duplicates", "fill the last name", {
      useModel: false,
    });
    const action = observed.actions[0];

    expect(action.label).toContain("Last");
    expect(action.selector).not.toBe("input");

    await runSemanticAction(page, "semantic-test-duplicates", action, { value: "Smith" });
    const values = await page.$$eval("input", (inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(values).toEqual(["", "Smith"]);
  });

  it("ignores arbitrary model selectors when a valid ref target is present", () => {
    const pageMap: SemanticPageMap = {
      url: "https://example.test/account",
      title: "Account",
      text: "",
      interactive_count: 2,
      elements: [
        { ref: "@e1", role: "button", name: "Delete account", visible: true, enabled: true },
      ],
      forms: [
        {
          fields: [
            { tag: "input", type: "password", id: "password", label: "Password", selector: "#password" },
          ],
        },
      ],
    };

    const action = coerceModelAction({
      id: "model-picked-id",
      kind: "click",
      ref: "@e1",
      selector: "#password",
      risk: "none",
      requiresApproval: false,
      confidence: 0.9,
    }, pageMap, "delete account");

    expect(action?.id).toBe("act_click_e1");
    expect(action?.ref).toBe("@e1");
    expect(action?.selector).toBeUndefined();
    expect(action?.risk).toBe("sensitive");
    expect(action?.requiresApproval).toBe(true);
  });

  it("revalidates direct selector actions against page-map risk", async () => {
    await page.setContent(`
      <main>
        <button id="delete">Delete account</button>
        <label for="password">Password</label>
        <input id="password" type="password">
      </main>
    `);
    const { pageMap } = await getSemanticActionCacheScope(page, "semantic-test-direct");

    const action = coerceModelAction({
      id: "forged",
      kind: "fill",
      ref: "selector:#password",
      selector: "#password",
      label: "Delete account",
      risk: "none",
      requiresApproval: false,
      confidence: 1,
    }, pageMap, "delete account");

    expect(action?.id).toBe("act_fill_selector_password");
    expect(action?.selector).toBe("#password");
    expect(action?.risk).toBe("sensitive");
    expect(action?.requiresApproval).toBe(true);
  });

  it("rejects model invented selectors when ranking bounded candidates", () => {
    const pageMap: SemanticPageMap = {
      url: "https://example.test/signin",
      title: "Sign in",
      text: "",
      interactive_count: 1,
      elements: [
        { ref: "@e1", role: "button", name: "Continue", visible: true, enabled: true },
      ],
      forms: [
        {
          fields: [
            { tag: "input", type: "password", id: "password", label: "Password", selector: "#password" },
          ],
        },
      ],
    };
    const candidates: SemanticAction[] = [
      {
        id: "act_click_e1",
        kind: "click",
        ref: "@e1",
        label: "Continue",
        confidence: 0.7,
        risk: "navigation",
        requiresApproval: false,
      },
    ];

    const invented = coerceModelAction({
      id: "not-a-candidate",
      kind: "fill",
      ref: "selector:#password",
      selector: "#password",
      confidence: 1,
      risk: "none",
    }, pageMap, "click continue", candidates);
    expect(invented).toBeNull();

    const ranked = coerceModelAction({
      id: "act_click_e1",
      selector: "#password",
      confidence: 1,
      risk: "none",
    }, pageMap, "click continue", candidates);
    expect(ranked?.ref).toBe("@e1");
    expect(ranked?.selector).toBeUndefined();
    expect(ranked?.risk).toBe("navigation");
  });

  it("marks password, legal consent, and account submit actions as approval-gated", async () => {
    await page.setContent(`
      <main>
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="new-password">
        <label><input id="terms" type="checkbox"> I agree to the Terms and Privacy Policy</label>
        <button>Create account</button>
      </main>
    `);

    const password = await observeSemanticActions(page, "semantic-test-policy-password", "fill password", {
      useModel: false,
    });
    expect(password.actions[0].risk).toBe("sensitive");
    expect(password.actions[0].requiresApproval).toBe(true);
    expect(password.actions[0].policyTags).toContain("credential_entry");

    const terms = await observeSemanticActions(page, "semantic-test-policy-terms", "check terms", {
      useModel: false,
    });
    expect(terms.actions[0].risk).toBe("sensitive");
    expect(terms.actions[0].requiresApproval).toBe(true);
    expect(terms.actions[0].policyTags).toContain("legal_acceptance");

    const submit = await observeSemanticActions(page, "semantic-test-policy-submit", "click create account", {
      useModel: false,
    });
    expect(submit.actions[0].risk).toBe("sensitive");
    expect(submit.actions[0].requiresApproval).toBe(true);
    expect(submit.actions[0].policyTags).toContain("account_creation");
  });

  it("omits readonly fields from semantic form candidates", async () => {
    await page.setContent(`
      <main>
        <label for="readonly-email">Email</label>
        <input id="readonly-email" readonly value="locked@example.test">
        <label for="editable-email">Email</label>
        <input id="editable-email">
      </main>
    `);

    const observed = await observeSemanticActions(page, "semantic-test-readonly", "fill email", {
      useModel: false,
    });

    expect(observed.actions.some((action) => action.selector === "#readonly-email")).toBe(false);
    expect(observed.actions[0].selector).toBe("#editable-email");
  });

  it("rejects cached actions when the same URL page fingerprint changes", async () => {
    await page.setContent(`<button>Continue</button>`);
    const observed = await observeSemanticActions(page, "semantic-test-cache", "click continue", {
      useModel: false,
    });
    const first = await getSemanticActionCacheScope(page, "semantic-test-cache");

    expect(getCachedSemanticAction("semantic-test-cache", observed.actions[0].id, first.scope)).not.toBeNull();

    await page.setContent(`<button>Delete account</button>`);
    const second = await getSemanticActionCacheScope(page, "semantic-test-cache");

    expect(second.scope.url).toBe(first.scope.url);
    expect(second.scope.fingerprint).not.toBe(first.scope.fingerprint);
    expect(getCachedSemanticAction("semantic-test-cache", observed.actions[0].id, second.scope)).toBeNull();
  });

  it("rejects cached actions when the page URL changes", async () => {
    await page.goto("data:text/html,<button>Continue</button>");
    const observed = await observeSemanticActions(page, "semantic-test-cache-url", "click continue", {
      useModel: false,
    });
    const first = await getSemanticActionCacheScope(page, "semantic-test-cache-url");

    expect(getCachedSemanticAction("semantic-test-cache-url", observed.actions[0].id, first.scope)).not.toBeNull();
    expect(getCachedSemanticAction("semantic-test-cache-url", observed.actions[0].id, {
      url: "https://example.test/other",
      fingerprint: first.scope.fingerprint,
    })).toBeNull();
  });
});
