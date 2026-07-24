import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addOtpEntry,
  bootstrapOtpStorage,
  generateOtpCode,
  getOtpEntry,
  getOtpStorageStatus,
  getOtpStorePath,
  importOtpAuthUri,
  listOtpEntries,
  removeOtpEntry,
} from "../src/storage.js";
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

  test("bootstraps storage and reports status fields", () => {
    const status = bootstrapOtpStorage({ home });
    expect(status.home).toBe(home);
    expect(status.store_path).toBe(getOtpStorePath({ home }));
    expect(status.key_exists).toBe(true);
    expect(status.store_exists).toBe(true);
    expect(status.entries).toBe(0);
    expect(status.storage).toBe("local-encrypted");
    expect(status.encrypted_at_rest).toBe(true);

    const readStatus = getOtpStorageStatus({ home });
    expect(readStatus.entries).toBe(0);
    expect(readStatus.key_path).toBe(status.key_path);
  });

  test("looks up entries by id, label, account, and issuer:account", () => {
    const secret = randomBase32Secret();
    const created = addOtpEntry({
      id: "entry-123",
      issuer: "Example",
      account: "agent@example.com",
      label: "example-agent",
      secret,
    });

    expect(getOtpEntry("entry-123", { home })?.id).toBe(created.id);
    expect(getOtpEntry("example-agent", { home })?.label).toBe("example-agent");
    expect(getOtpEntry("agent@example.com", { home })?.account).toBe("agent@example.com");
    expect(getOtpEntry("Example:agent@example.com", { home })?.issuer).toBe("Example");
    expect(getOtpEntry("missing", { home })).toBeUndefined();
  });

  test("rejects duplicate ids and labels", () => {
    const secret = randomBase32Secret();
    addOtpEntry({ id: "dup-id", issuer: "Example", account: "one@example.com", label: "label-one", secret });
    expect(() => addOtpEntry({ id: "dup-id", issuer: "Example", account: "two@example.com", label: "label-two", secret: randomBase32Secret() }))
      .toThrow('id "dup-id" already exists');
    expect(() => addOtpEntry({ issuer: "Example", account: "three@example.com", label: "label-one", secret: randomBase32Secret() }))
      .toThrow('label "label-one" already exists');
  });

  test("throws when lookup target is ambiguous", () => {
    const secret = randomBase32Secret();
    addOtpEntry({ issuer: "Example", account: "shared", label: "shared", secret });
    addOtpEntry({ issuer: "Other", account: "shared", label: "other-shared", secret: randomBase32Secret() });
    expect(() => generateOtpCode("shared", { home })).toThrow('target "shared" is ambiguous');
  });

  test("imports otpauth URIs end-to-end", () => {
    const secret = randomBase32Secret();
    const uri = `otpauth://totp/Example:imported@example.com?secret=${secret}&issuer=Example&algorithm=SHA256&digits=8&period=45`;
    const imported = importOtpAuthUri({ uri, id: "imported-id", label: "imported-label" }, { home });

    expect(imported.id).toBe("imported-id");
    expect(imported.label).toBe("imported-label");
    expect(imported.algorithm).toBe("SHA256");
    expect(imported.digits).toBe(8);
    expect(imported.period).toBe(45);
  });

  test("rejects malformed entries.json", () => {
    writeFileSync(getOtpStorePath({ home }), "null\n", { mode: 0o600 });
    expect(() => listOtpEntries({ home })).toThrow("malformed");

    writeFileSync(getOtpStorePath({ home }), JSON.stringify({ schema: "wrong", entries: [] }), { mode: 0o600 });
    expect(() => listOtpEntries({ home })).toThrow("unsupported");

    writeFileSync(getOtpStorePath({ home }), JSON.stringify({ schema: "open-otp.store.v1", entries: "not-array" }), { mode: 0o600 });
    expect(() => listOtpEntries({ home })).toThrow("unsupported");
  });

  test("throws when generating code for missing entry", () => {
    expect(() => generateOtpCode("missing-entry", { home })).toThrow('entry "missing-entry" was not found');
  });

  test("defaults label to issuer:account when label omitted", () => {
    const secret = randomBase32Secret();
    const entry = addOtpEntry({ issuer: "Example", account: "agent@example.com", secret });
    expect(entry.label).toBe("Example:agent@example.com");
  });
});
