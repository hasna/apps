import { describe, expect, test } from "bun:test";
import { liveGateStatus } from "./outbox-timestamp-pg.verify.js";

describe("liveGateStatus", () => {
  test("declines when only the regular database URL is present", () => {
    const status = liveGateStatus({
      HASNA_CONVERSATIONS_DATABASE_URL: "postgres://runtime-user:pw@db.example.invalid/app",
      HASNA_CONVERSATIONS_API_SIGNING_KEY: "signing-key",
    } as NodeJS.ProcessEnv);

    expect(status.available).toBe(false);
    expect(status.missingGate).toContain("DATABASE_URL_OWNER");
  });

  test("accepts only an isolated owner DSN plus signing key", () => {
    const status = liveGateStatus({
      HASNA_CONVERSATIONS_DATABASE_URL_OWNER: "postgres://owner-user:pw@db.example.invalid/postgres",
      HASNA_CONVERSATIONS_API_SIGNING_KEY: "signing-key",
    } as NodeJS.ProcessEnv);

    expect(status.available).toBe(true);
    expect(status.missingGate).toBeNull();
  });
});
