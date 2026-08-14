import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parseAssertionString, evaluateAssertions } from "./assertions.js";

describe("cookie and localStorage assertions (OPE9-00226)", () => {
  describe("parseAssertionString", () => {
    test("parses cookie:exists assertion", () => {
      const a = parseAssertionString("cookie:exists:session_id");
      expect(a.type).toBe("cookie_exists");
      expect(a.expected).toBe("session_id");
      expect(a.description).toBe('Cookie "session_id" exists');
    });

    test("parses cookie:not-exists assertion", () => {
      const a = parseAssertionString("cookie:not-exists:tracking_id");
      expect(a.type).toBe("cookie_not_exists");
      expect(a.expected).toBe("tracking_id");
    });

    test("parses cookie:value assertion", () => {
      const a = parseAssertionString("cookie:value:session_id=abc123");
      expect(a.type).toBe("cookie_value");
      expect(a.expected).toBe("session_id=abc123");
    });

    test("parses local:exists assertion", () => {
      const a = parseAssertionString("local:exists:userId");
      expect(a.type).toBe("local_storage_exists");
      expect(a.expected).toBe("userId");
    });

    test("parses local:not-exists assertion", () => {
      const a = parseAssertionString("local:not-exists:tempData");
      expect(a.type).toBe("local_storage_not_exists");
      expect(a.expected).toBe("tempData");
    });

    test("parses local:value assertion", () => {
      const a = parseAssertionString("local:value:userId=42");
      expect(a.type).toBe("local_storage_value");
      expect(a.expected).toBe("userId=42");
    });

    test("parses session:value assertion", () => {
      const a = parseAssertionString("session:value:cart=items-3");
      expect(a.type).toBe("session_storage_value");
      expect(a.expected).toBe("cart=items-3");
    });

    test("parses session:not-exists assertion", () => {
      const a = parseAssertionString("session:not-exists:checkoutToken");
      expect(a.type).toBe("session_storage_not_exists");
      expect(a.expected).toBe("checkoutToken");
    });
  });

  test("rejects unknown assertion formats", () => {
    expect(() => parseAssertionString("unknown:thing:blah")).toThrow(/Cannot parse assertion/);
  });
});
