/**
 * Regression tests for port coercion.
 *
 * The bug: `coercePort` used `Number.parseInt(raw, 10)`, which stops at the first
 * character it cannot read and returns what it got. That promoted garbage into a
 * number, and the worst cases landed on 0 — the one value with special meaning,
 * "ask the kernel for an ephemeral port". So `--port 0x10` silently bound a random
 * high port, which is the exact failure this module exists to prevent.
 *
 * Every case below was a real wrong answer at some point in this file's history,
 * so they are pinned rather than sampled.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_PORT, coercePort } from "./port.js";

describe("coercePort", () => {
  test("accepts plain integer ports", () => {
    expect(coercePort("1")).toBe(1);
    expect(coercePort("80")).toBe(80);
    expect(coercePort("8080")).toBe(8080);
    expect(coercePort("19427")).toBe(19427);
    expect(coercePort("65535")).toBe(65535);
  });

  test("accepts exactly \"0\" as the ephemeral request", () => {
    // 0 is meaningful: it asks the kernel for a free port. Coercing it with
    // `parseInt(...) || DEFAULT_PORT` used to rewrite it to the default, which made
    // an ephemeral port impossible to request.
    expect(coercePort("0")).toBe(0);
  });

  test("rejects other spellings of zero, which would silently mean ephemeral", () => {
    // `/^\d+$/` alone admits these, and they parse to 0. `--port 00` is far more
    // plausibly a typo than a deliberate request for an arbitrary port.
    expect(coercePort("00")).toBeUndefined();
    expect(coercePort("000")).toBeUndefined();
    expect(coercePort("0080")).toBeUndefined();
  });

  test("rejects values parseInt would truncate instead of reading", () => {
    // parseInt("0x10", 10) === 0  -> would have meant "ephemeral"
    expect(coercePort("0x10")).toBeUndefined();
    expect(coercePort("0X1F")).toBeUndefined();
    expect(coercePort("0b11")).toBeUndefined();
    // parseInt("1e3", 10) === 1, parseInt("12abc", 10) === 12
    expect(coercePort("1e3")).toBeUndefined();
    expect(coercePort("12abc")).toBeUndefined();
    expect(coercePort("8080abc")).toBeUndefined();
    expect(coercePort("8080.5")).toBeUndefined();
  });

  test("rejects signs, out-of-range values, and non-values", () => {
    expect(coercePort("-1")).toBeUndefined();
    expect(coercePort("-0")).toBeUndefined();
    expect(coercePort("+8080")).toBeUndefined();
    expect(coercePort("65536")).toBeUndefined();
    expect(coercePort("99999")).toBeUndefined();
    expect(coercePort("abc")).toBeUndefined();
    expect(coercePort("")).toBeUndefined();
    expect(coercePort("   ")).toBeUndefined();
    expect(coercePort(undefined)).toBeUndefined();
  });

  test("tolerates surrounding whitespace", () => {
    expect(coercePort(" 80")).toBe(80);
    expect(coercePort("80 ")).toBe(80);
    expect(coercePort(" 0 ")).toBe(0);
  });

  test("the advertised default is itself a valid port", () => {
    // The CLI passes String(DEFAULT_PORT) as commander's default, so a caller that
    // supplies no --port must not trip the invalid-port refusal.
    expect(coercePort(String(DEFAULT_PORT))).toBe(DEFAULT_PORT);
  });
});
