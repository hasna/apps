import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import {
  coerceModelAction,
  observeSemanticActions,
  runSemanticAction,
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
});
