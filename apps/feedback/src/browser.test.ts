import { afterEach, describe, expect, test } from "bun:test";
import { collectBrowserFeedbackContext } from "./browser.js";

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

describe("collectBrowserFeedbackContext", () => {
  test("collects browser context without framework dependencies", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        innerWidth: 1440,
        innerHeight: 900,
        location: {
          href: "https://example.test/reports?tab=activity",
          pathname: "/reports",
        },
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        language: "en-US",
        userAgent: "Test Browser",
      },
    });

    expect(collectBrowserFeedbackContext({ version: "1.2.3", environment: "test" })).toEqual({
      route: "/reports",
      screen: undefined,
      url: "https://example.test/reports?tab=activity",
      version: "1.2.3",
      commit: undefined,
      environment: "test",
      userAgent: "Test Browser",
      sessionId: undefined,
      locale: "en-US",
      viewport: "1440x900",
    });
  });
});
