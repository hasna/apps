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
    expect(validateHasnaXyzSecretPath("hasna/xyz/opensource/files/prod/rds")).toEqual({
      valid: true,
      kind: "app",
    });
    expect(validateHasnaXyzSecretPath("hasna/xyz/internalapp/news/prod/env")).toEqual({
      valid: true,
      kind: "app",
    });
    expect(validateHasnaXyzSecretPath("hasna/xyz/project/aws-migration/pr-123/env")).toEqual({
      valid: true,
      kind: "app",
    });
  });

  it("accepts explicit legacy app aliases", () => {
    expect(validateHasnaXyzSecretPath("hasna/xyz/opensource/microservices/prod/rds/legacy-master")).toEqual({
      valid: true,
      kind: "app",
    });
  });

  it("accepts infra-owned canonical paths", () => {
    expect(validateHasnaXyzSecretPath("hasna/xyz/infra/apps/prod/postgres/master")).toEqual({
      valid: true,
      kind: "infra",
    });
    expect(validateHasnaXyzSecretPath("hasna/xyz/infra/tfstate/prod/aws")).toEqual({
      valid: true,
      kind: "infra",
    });
  });

  it("rejects deprecated app type taxonomy", () => {
    const result = validateHasnaXyzSecretPath("hasna/xyz/connector/google/prod/env");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Deprecated Hasna XYZ app type");
  });

  it("rejects repo prefixes in app tokens", () => {
    const result = validateHasnaXyzSecretPath("hasna/xyz/opensource/open-files/prod/rds");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("strip repo prefixes");
  });

  it("rejects invalid environments", () => {
    const result = validateHasnaXyzSecretPath("hasna/xyz/opensource/files/production/rds");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid Hasna XYZ environment");
  });
});
