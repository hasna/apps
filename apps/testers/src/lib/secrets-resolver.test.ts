import { afterEach, describe, expect, test } from "bun:test";

import { isCredentialReference, resolveCredential } from "./secrets-resolver.js";

const ENV_KEY = "TESTERS_SECRET_RESOLVER_VALUE";
const previousValue = process.env[ENV_KEY];

afterEach(() => {
  if (previousValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = previousValue;
  }
});

describe("secrets resolver", () => {
  test("resolves braced environment references", () => {
    process.env[ENV_KEY] = "resolved-from-env";

    expect(resolveCredential(`\${${ENV_KEY}}`)).toBe("resolved-from-env");
    expect(isCredentialReference(`\${${ENV_KEY}}`)).toBe(true);
  });

  test("returns null for empty braced environment references", () => {
    expect(resolveCredential("${}")).toBeNull();
  });
});
