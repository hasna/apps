import { expect, test } from "bun:test";
import { assertNoNumeratorKeys } from "../../src/core/fraction";

test("deliberate break: numerator leak guard reddens", () => {
  expect(() => assertNoNumeratorKeys({ fraction: "1/1", numerator: 1 })).not.toThrow();
});
