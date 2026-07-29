import { describe, expect, test } from "bun:test";

import { AccountsError } from "../../src/errors";
import {
  CLIENT_STORES,
  RETIRED_DEPLOYMENT_MODE_VALUES,
  SERVER_DATA_BACKENDS,
  deploymentModeRetirementHint,
  isRetiredDeploymentModeValue,
  retiredDeploymentModeError,
} from "../../src/storage-selection";

describe("storage selection replaces the retired deployment-mode axis", () => {
  test("the client axis is sqlite-or-http and never offers Postgres", () => {
    expect([...CLIENT_STORES]).toEqual(["sqlite", "http"]);
    expect(CLIENT_STORES as readonly string[]).not.toContain("postgresql");
    expect(CLIENT_STORES as readonly string[]).not.toContain("postgres");
  });

  test("the server data backend axis is sqlite-or-postgresql", () => {
    expect([...SERVER_DATA_BACKENDS]).toEqual(["sqlite", "postgresql"]);
  });

  test("no axis value reintroduces deployment-mode vocabulary", () => {
    for (const value of [...CLIENT_STORES, ...SERVER_DATA_BACKENDS]) {
      expect(RETIRED_DEPLOYMENT_MODE_VALUES as readonly string[]).not.toContain(value);
    }
  });

  test("every retired spelling is recognised, including the hyphenated manifest form", () => {
    for (const retired of ["local", "self_hosted", "self-hosted", "cloud", "remote", "hybrid"]) {
      expect(isRetiredDeploymentModeValue(retired)).toBe(true);
    }
    for (const live of ["sqlite", "http", "postgresql", "", "SQLITE"]) {
      expect(isRetiredDeploymentModeValue(live)).toBe(false);
    }
  });

  test("a retired value produces a rejection, never a normalized fallback", () => {
    const error = retiredDeploymentModeError("store", "cloud", "sqlite");
    expect(error).toBeInstanceOf(AccountsError);
    expect(error.code).toBe("VALIDATION_FAILED");
    // `field` is the only detail channel that survives error redaction, so the
    // replacement has to travel in it.
    expect(error.details.field).toBe("store");
  });

  test("the remediation hint names the replacement and the retired input", () => {
    const hint = deploymentModeRetirementHint("HASNA_ACCOUNTS_DEPLOYMENT");
    expect(hint).toBeDefined();
    expect(hint).toContain("HASNA_ACCOUNTS_DEPLOYMENT");
    expect(hint).toContain("HASNA_ACCOUNTS_STORE");
    expect(hint).toContain("sqlite");
    expect(hint).toContain("http");
    expect(deploymentModeRetirementHint("unrelated.field")).toBeUndefined();
  });

  test("a retired value on the live variable is not told the wrong variable is at fault", () => {
    const hint = deploymentModeRetirementHint("HASNA_ACCOUNTS_STORE");
    expect(hint).toBeDefined();
    expect(hint).toContain("HASNA_ACCOUNTS_STORE");
    // The operator set the live variable, so claiming the retired one "is no
    // longer read" would point them at configuration they never wrote.
    expect(hint).not.toContain("HASNA_ACCOUNTS_DEPLOYMENT");
  });
});
