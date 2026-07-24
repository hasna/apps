import { describe, expect, it } from "bun:test";
import { validateHasnaXyzSecretPath } from "../src/hasna-xyz-paths.js";

describe("Hasna XYZ secret path validation", () => {
  it("preserves generic non-Hasna keys", () => {
    expect(validateHasnaXyzSecretPath("openai/api_key")).toEqual({
      valid: true,
      kind: "generic",
    });
  });

  it("accepts app-owned canonical runtime paths", () => {
    expect(validateHasnaXyzSecretPath("hasna/xyz/opensource/example-app/prod/rds")).toEqual({
      valid: true,
      kind: "app",
    });
    expect(validateHasnaXyzSecretPath("hasna/xyz/internalapp/example-app/prod/env")).toEqual({
      valid: true,
      kind: "app",
    });
    expect(validateHasnaXyzSecretPath("hasna/xyz/project/example-project/pr-123/env")).toEqual({
      valid: true,
      kind: "app",
    });
  });

  it("accepts explicit legacy app aliases", () => {
    expect(validateHasnaXyzSecretPath("hasna/xyz/opensource/example-service/prod/rds/legacy-master")).toEqual({
      valid: true,
      kind: "app",
    });
  });

  it("accepts infra-owned canonical paths", () => {
    expect(validateHasnaXyzSecretPath("hasna/xyz/infra/example-group/prod/postgres/master")).toEqual({
      valid: true,
      kind: "infra",
    });
    expect(validateHasnaXyzSecretPath("hasna/xyz/infra/example-state/prod/aws")).toEqual({
      valid: true,
      kind: "infra",
    });
  });

  it("rejects deprecated app type taxonomy", () => {
    const result = validateHasnaXyzSecretPath("hasna/xyz/connector/example-app/prod/env");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Deprecated Hasna XYZ app type");
  });

  it("rejects repo prefixes in app tokens", () => {
    const result = validateHasnaXyzSecretPath("hasna/xyz/opensource/open-example/prod/rds");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("strip repo prefixes");
  });

  it("rejects invalid environments", () => {
    const result = validateHasnaXyzSecretPath("hasna/xyz/opensource/example-app/production/rds");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid Hasna XYZ environment");
  });
});
