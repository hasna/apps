// Sol-guided coverage — Priority 5: browser context collection.
//
// Two-sided: without window/navigator (SSR) every derived field is undefined;
// with a synthetic window/navigator the derived values appear, while explicit
// options always override the derived ones.
import { afterEach, describe, expect, test } from "bun:test";
import { collectBrowserFeedbackContext } from "./browser.js";

const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function withGlobals<T>(globals: Record<string, unknown>, fn: () => T): T {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    return fn();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

afterEach(() => {
  // Restore the bun-provided navigator if a test left it deleted.
  if (!Object.getOwnPropertyDescriptor(globalThis, "navigator") && savedNavigator) {
    Object.defineProperty(globalThis, "navigator", savedNavigator);
  }
});

describe("collectBrowserFeedbackContext", () => {
  test("with no window or navigator (SSR) the derived fields are undefined, and explicit options still pass through", () => {
    withGlobals({ window: undefined, navigator: undefined }, () => {
      const context = collectBrowserFeedbackContext();
      expect(context.route).toBeUndefined();
      expect(context.url).toBeUndefined();
      expect(context.viewport).toBeUndefined();
      expect(context.userAgent).toBeUndefined();
      expect(context.locale).toBeUndefined();
      expect(context.screen).toBeUndefined();

      const explicit = collectBrowserFeedbackContext({ route: "/ssr", screen: "loading", version: "1.0.0" });
      expect(explicit.route).toBe("/ssr");
      expect(explicit.screen).toBe("loading");
      expect(explicit.version).toBe("1.0.0");
      expect(explicit.url).toBeUndefined();
    });
  });

  test("a synthetic window/navigator supplies the derived fields", () => {
    withGlobals(
      {
        window: { location: { pathname: "/derived", href: "https://app.example.com/derived" }, innerWidth: 800, innerHeight: 600 },
        navigator: { userAgent: "test-ua", language: "en-US" },
      },
      () => {
        const context = collectBrowserFeedbackContext();
        expect(context.route).toBe("/derived");
        expect(context.url).toBe("https://app.example.com/derived");
        expect(context.viewport).toBe("800x600");
        expect(context.userAgent).toBe("test-ua");
        expect(context.locale).toBe("en-US");
      },
    );
  });

  test("explicit options override every derived value, and only the options actually set are used", () => {
    withGlobals(
      {
        window: { location: { pathname: "/derived", href: "https://app.example.com/derived" }, innerWidth: 800, innerHeight: 600 },
        navigator: { userAgent: "test-ua", language: "en-US" },
      },
      () => {
        const context = collectBrowserFeedbackContext({
          route: "/explicit",
          screen: "settings",
          version: "2.1.0",
          commit: "abc123",
          environment: "staging",
          sessionId: "sess-9",
        });
        expect(context.route).toBe("/explicit");
        expect(context.screen).toBe("settings");
        expect(context.version).toBe("2.1.0");
        expect(context.commit).toBe("abc123");
        expect(context.environment).toBe("staging");
        expect(context.sessionId).toBe("sess-9");
        // The derived fields the options do not cover still come from the window.
        expect(context.url).toBe("https://app.example.com/derived");
        expect(context.viewport).toBe("800x600");
        expect(context.userAgent).toBe("test-ua");
        expect(context.locale).toBe("en-US");
      },
    );
  });
});
