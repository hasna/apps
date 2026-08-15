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

  test("uses issuer from label when query issuer is absent", () => {
    const secret = randomBase32Secret();
    const parsed = parseOtpAuthUri(`otpauth://totp/Acme:user@host?secret=${secret}`);
    expect(parsed.issuer).toBe("Acme");
    expect(parsed.account).toBe("user@host");
    expect(parsed.label).toBe("Acme:user@host");
  });

  test("prefers query issuer over label issuer", () => {
    const secret = randomBase32Secret();
    const parsed = parseOtpAuthUri(`otpauth://totp/LabelIssuer:account?secret=${secret}&issuer=QueryIssuer`);
    expect(parsed.issuer).toBe("QueryIssuer");
    expect(parsed.label).toBe("QueryIssuer:account");
  });

  test("supports account-only labels without colon", () => {
    const secret = randomBase32Secret();
    const parsed = parseOtpAuthUri(`otpauth://totp/account-only?secret=${secret}`);
    expect(parsed.account).toBe("account-only");
    expect(parsed.label).toBe("account-only");
    expect(parsed.issuer).toBeUndefined();
  });

  test("normalizes algorithm casing from URI", () => {
    const secret = randomBase32Secret();
    const parsed = parseOtpAuthUri(`otpauth://totp/Example:acct?secret=${secret}&algorithm=sha512`);
    expect(parsed.algorithm).toBe("SHA512");
  });

  test("rejects invalid URIs and schemes", () => {
    expect(() => parseOtpAuthUri("not-a-url")).toThrow("Invalid otpauth URI");
    expect(() => parseOtpAuthUri(`https://totp/Example:acct?secret=${randomBase32Secret()}`)).toThrow("otpauth scheme");
  });

  test("rejects non-TOTP URIs", () => {
    const uri = `otpauth://hotp/Example:agent?secret=${randomBase32Secret()}`;
    expect(() => parseOtpAuthUri(uri)).toThrow("Only otpauth://totp");
  });

  test("rejects missing label, account, and secret", () => {
    const secret = randomBase32Secret();
    expect(() => parseOtpAuthUri(`otpauth://totp/?secret=${secret}`)).toThrow("label is required");
    expect(() => parseOtpAuthUri(`otpauth://totp/:?secret=${secret}`)).toThrow("account label is required");
    expect(() => parseOtpAuthUri("otpauth://totp/Example:acct")).toThrow("missing secret");
  });

  test("rejects non-integer digits and period query values", () => {
    const secret = randomBase32Secret();
    expect(() => parseOtpAuthUri(`otpauth://totp/Example:acct?secret=${secret}&digits=abc`)).toThrow("digits must be an integer");
    expect(() => parseOtpAuthUri(`otpauth://totp/Example:acct?secret=${secret}&period=abc`)).toThrow("period must be an integer");
  });
});
