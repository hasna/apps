import { describe, expect, test } from "bun:test";
import { compactAge, compactNum, money, compactDuration } from "../src/format";

describe("compactAge", () => {
  test("seconds", () => expect(compactAge(45)).toBe("45s"));
  test("minutes", () => expect(compactAge(120)).toBe("2m"));
  test("hours", () => expect(compactAge(7200)).toBe("2h"));
  test("days", () => expect(compactAge(172800)).toBe("2d"));
  test("weeks", () => expect(compactAge(1209600)).toBe("2w"));
  test("months", () => expect(compactAge(5184000)).toBe("2mo"));
  test("years", () => expect(compactAge(63072000)).toBe("2y"));
});

describe("compactNum", () => {
  test("small", () => expect(compactNum(999)).toBe("999"));
  test("thousands with decimal", () => expect(compactNum(1500)).toBe("1.5k"));
  test("thousands round", () => expect(compactNum(2000)).toBe("2k"));
  test("big thousands truncate", () => expect(compactNum(461234)).toBe("461k"));
  test("millions", () => expect(compactNum(1200000)).toBe("1.2m"));
  test("millions round", () => expect(compactNum(2000000)).toBe("2m"));
});

describe("money", () => {
  test("zero", () => expect(money(0)).toBe("$0.00"));
  test("cents", () => expect(money(0.04)).toBe("$0.04"));
  test("commas", () => expect(money(1234.5)).toBe("$1,234.50"));
  test("large", () => expect(money(1234567.891)).toBe("$1,234,567.89"));
});

describe("compactDuration", () => {
  test("seconds", () => expect(compactDuration(45000)).toBe("45s"));
  test("minutes", () => expect(compactDuration(150000)).toBe("2m30s"));
  test("hours", () => expect(compactDuration(5400000)).toBe("1h30m"));
  test("exact hour", () => expect(compactDuration(3600000)).toBe("1h"));
});
