import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addOtpEntry, generateOtpCode, getOtpStorePath, listOtpEntries, removeOtpEntry } from "../src/storage.js";
import { randomBase32Secret } from "./helpers.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "open-otp-test-"));
  process.env.HASNA_OTP_HOME = home;
});

afterEach(() => {
  delete process.env.HASNA_OTP_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("storage", () => {
  test("stores encrypted secrets and returns redacted entries", () => {
    const secret = randomBase32Secret();
    const entry = addOtpEntry({ issuer: "Example", account: "agent@example.com", secret });

    expect(entry).not.toHaveProperty("encrypted_secret");
    expect(listOtpEntries()[0]).not.toHaveProperty("encrypted_secret");

    const rawStore = readFileSync(getOtpStorePath(), "utf8");
    expect(rawStore).not.toContain(secret);
    expect(rawStore).toContain("enc:v1:");
  });

  test("generates codes without exposing seeds", () => {
    const secret = randomBase32Secret();
    addOtpEntry({ issuer: "Example", account: "agent@example.com", label: "example-agent", secret });

    const generated = generateOtpCode("example-agent", { at: 59_000 });

    expect(generated.code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(generated)).not.toContain(secret);
  });

  test("removes entries by label", () => {
    addOtpEntry({ issuer: "Example", account: "agent@example.com", label: "example-agent", secret: randomBase32Secret() });
    expect(removeOtpEntry("example-agent")?.label).toBe("example-agent");
    expect(listOtpEntries()).toHaveLength(0);
  });
});
