import { describe, expect, test } from "bun:test";
import {
  REDACTION_PLACEHOLDER,
  redactCredentialBearingText,
} from "./redaction.js";

describe("redactCredentialBearingText", () => {
  test("redacts sensitive assignments while preserving the key and quote shape", () => {
    const value = "synthetic-only-not-live-7a31";
    expect(redactCredentialBearingText(`const service_password = "${value}";`)).toBe(
      `const service_password = "${REDACTION_PLACEHOLDER}"`,
    );
  });

  test("leaves ordinary password-related prose unchanged", () => {
    const safe = "This guide documents password handling without assigning a value.";
    expect(redactCredentialBearingText(safe)).toBe(safe);
  });

  test("redacts camelCase credential assignments", () => {
    const value = "synthetic-only-not-live-review";
    expect(redactCredentialBearingText(`dbPassword = "${value}"`)).toBe(
      `dbPassword = "${REDACTION_PLACEHOLDER}"`,
    );
    expect(redactCredentialBearingText(`clientSecret: ${value}`)).toBe(
      `clientSecret: ${REDACTION_PLACEHOLDER}`,
    );
  });

  test("leaves comparisons and type annotations unchanged", () => {
    const safeLines = [
      'if (password === "") return;',
      'if (password !== "") return;',
      'const matches = password == "synthetic";',
      "password: string",
    ];

    for (const safe of safeLines) {
      expect(redactCredentialBearingText(safe)).toBe(safe);
    }
  });

  test("redacts bearer values and URL user-info passwords", () => {
    const value = "synthetic-only-not-live-7a31";
    const bearer = ["Bearer", value].join(" ");
    const url = ["postgres://unit:", value, "@example.invalid/db"].join("");
    expect(redactCredentialBearingText(bearer)).toBe(`Bearer ${REDACTION_PLACEHOLDER}`);
    expect(redactCredentialBearingText(url)).toBe(
      `postgres://unit:${REDACTION_PLACEHOLDER}@example.invalid/db`,
    );
  });

  test("redacts DB_PASS assignments and Basic authorization credentials", () => {
    const value = ["synthetic", "review", "value", "731"].join("-");

    expect(redactCredentialBearingText(`DB_PASS=${value}`)).toBe(
      `DB_PASS=${REDACTION_PLACEHOLDER}`,
    );
    expect(redactCredentialBearingText(`Authorization: Basic ${value}`)).toBe(
      `Authorization: Basic ${REDACTION_PLACEHOLDER}`,
    );
    expect(redactCredentialBearingText(`authorization: basic ${value}`)).toBe(
      `authorization: basic ${REDACTION_PLACEHOLDER}`,
    );
  });

  test("redacts common standalone credential token shapes", () => {
    const values = [
      ["sk-", "synthetic_token_123456789"].join(""),
      ["ghp_", "abcdefghijklmnopqrstuvwxyz123456"].join(""),
      ["github_pat_", "abcdefghijklmnopqrstuvwxyz_123456"].join(""),
      ["AKIA", "SYNTHETIC0000000"].join(""),
      ["eyJheader", "eyJpayload", "signature"].join("."),
    ];

    for (const value of values) {
      expect(redactCredentialBearingText(value)).toBe(REDACTION_PLACEHOLDER);
    }
  });
});
