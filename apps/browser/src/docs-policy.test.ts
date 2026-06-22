import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const extensionSpec = readFileSync("EXTENSION_SPEC.md", "utf8");
const browseCli = readFileSync("src/cli/commands/browse.ts", "utf8");

describe("browser control documentation policy", () => {
  test("README documents lane selection and anti-abuse boundaries", () => {
    for (const required of [
      "## Choose The Control Lane",
      "Browser-native automation",
      "Extension engine",
      "Pixel computer control",
      "policy-gated",
      "never selected by `auto`",
      "Do not use browser automation, headed mode, CDP, stealth settings, or the",
      "bypass CAPTCHA, MFA, bot detection, rate limits, paywalls",
      "Prefer official APIs",
      "BROWSER_ALLOW_EXTENSION_SESSION",
      "Event.isTrusted` stays false",
    ]) {
      expect(readme).toContain(required);
    }
  });

  test("extension spec avoids evasion and trusted-input claims", () => {
    for (const required of [
      "operator-paired visible Chrome profile",
      "not a way to evade bot detection",
      "Event.isTrusted` remains false",
      "Operator authorization is required",
      "no hardware-trusted clicks/keys",
      "no cookie export by default",
    ]) {
      expect(extensionSpec).toContain(required);
    }
    for (const forbidden of [
      "defeating the bot-detection",
      "real residential IP",
      "real `isTrusted`",
      "no webdriver)",
    ]) {
      expect(extensionSpec).not.toContain(forbidden);
    }
  });

  test("navigate help lists all engine modes and the extension auto-selection boundary", () => {
    expect(browseCli).toContain("playwright|cdp|lightpanda|bun|tui|extension|kernel|auto");
    expect(browseCli).toContain("auto never selects extension or kernel");
  });
});
