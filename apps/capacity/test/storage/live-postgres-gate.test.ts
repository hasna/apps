import { describe, expect, test } from "bun:test";

import {
  LEGACY_LIVE_POSTGRES_URL_VARIABLE,
  LIVE_POSTGRES_URL_VARIABLE,
  resolveLivePostgresGate,
} from "../live-postgres-gate";

const LIVE_URL = "postgresql://127.0.0.1:5432/capacity_test?sslmode=disable";

describe("Live PostgreSQL gate", () => {
  test("runs the live suite whenever a connection URL is configured", () => {
    expect(resolveLivePostgresGate({ [LIVE_POSTGRES_URL_VARIABLE]: LIVE_URL })).toEqual({
      mode: "run",
      url: LIVE_URL,
    });

    expect(
      resolveLivePostgresGate({ CI: "true", [LIVE_POSTGRES_URL_VARIABLE]: LIVE_URL }),
    ).toEqual({ mode: "run", url: LIVE_URL });
  });

  test("accepts the legacy accounts connection URL for existing callers", () => {
    expect(
      resolveLivePostgresGate({ [LEGACY_LIVE_POSTGRES_URL_VARIABLE]: LIVE_URL }),
    ).toEqual({ mode: "run", url: LIVE_URL });
  });

  test("skips the live suite outside CI when no connection URL is configured", () => {
    const gate = resolveLivePostgresGate({});

    expect(gate.mode).toBe("skip");
    if (gate.mode === "run") throw new Error("expected the gate to skip");
    expect(gate.reason).toContain(LIVE_POSTGRES_URL_VARIABLE);
  });

  test("fails instead of skipping when CI drops the connection URL", () => {
    const gate = resolveLivePostgresGate({ CI: "true" });

    expect(gate.mode).toBe("fail");
    if (gate.mode === "run") throw new Error("expected the gate to fail");
    expect(gate.reason).toContain(LIVE_POSTGRES_URL_VARIABLE);
  });

  test.each(["true", "TRUE", "1", "yes"])(
    "treats CI=%s as continuous integration",
    (flag) => {
      expect(resolveLivePostgresGate({ CI: flag }).mode).toBe("fail");
    },
  );

  test.each(["", " ", "0", "false", "FALSE"])(
    "does not treat CI=%s as continuous integration",
    (flag) => {
      expect(resolveLivePostgresGate({ CI: flag }).mode).toBe("skip");
    },
  );

  test("treats a blank connection URL in CI as a missing one", () => {
    expect(
      resolveLivePostgresGate({ CI: "true", [LIVE_POSTGRES_URL_VARIABLE]: "   " }).mode,
    ).toBe("fail");
  });
});
