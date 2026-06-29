import { describe, expect, test } from "bun:test";
import { parseOtpAuthUri } from "../src/otpauth.js";
import { randomBase32Secret } from "./helpers.js";

describe("parseOtpAuthUri", () => {
  test("parses issuer and account labels", () => {
    const uri = `otpauth://totp/Example:agent%40example.com?secret=${randomBase32Secret()}&issuer=Example&algorithm=SHA256&digits=8&period=45`;
    const parsed = parseOtpAuthUri(uri);

    expect(parsed.issuer).toBe("Example");
    expect(parsed.account).toBe("agent@example.com");
    expect(parsed.label).toBe("Example:agent@example.com");
    expect(parsed.algorithm).toBe("SHA256");
    expect(parsed.digits).toBe(8);
    expect(parsed.period).toBe(45);
  });

  test("rejects non-TOTP URIs", () => {
    const uri = `otpauth://hotp/Example:agent?secret=${randomBase32Secret()}`;
    expect(() => parseOtpAuthUri(uri)).toThrow("Only otpauth://totp");
  });
});
