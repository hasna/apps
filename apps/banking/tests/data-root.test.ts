import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bankingDataRoot, createSqliteDevStore, defaultDevStorePath } from "../src/index.ts";

describe("canonical data root (~/.hasna/banking)", () => {
  let originalHome: string | undefined;
  let originalBankingHome: string | undefined;
  let tempRoot: string;

  beforeEach(() => {
    originalHome = process.env["HOME"];
    originalBankingHome = process.env["HASNA_BANKING_HOME"];
    tempRoot = mkdtempSync(join(tmpdir(), "banking-data-root-"));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = originalHome;
    if (originalBankingHome === undefined) delete process.env["HASNA_BANKING_HOME"];
    else process.env["HASNA_BANKING_HOME"] = originalBankingHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("default path resolves to ~/.hasna/banking/banking.db under a fake HOME", () => {
    const home = join(tempRoot, "home");
    process.env["HOME"] = home;

    expect(bankingDataRoot()).toBe(join(home, ".hasna", "banking"));
    expect(defaultDevStorePath()).toBe(join(home, ".hasna", "banking", "banking.db"));

    const store = createSqliteDevStore();
    expect(existsSync(join(home, ".hasna", "banking", "banking.db"))).toBe(true);
    void store;
  });

  test("HASNA_BANKING_HOME override wins over the canonical default", () => {
    const home = join(tempRoot, "home");
    const override = join(tempRoot, "override-root");
    process.env["HOME"] = home;
    process.env["HASNA_BANKING_HOME"] = override;

    expect(bankingDataRoot()).toBe(override);
    expect(defaultDevStorePath()).toBe(join(override, "banking.db"));

    const store = createSqliteDevStore();
    expect(existsSync(join(override, "banking.db"))).toBe(true);
    expect(existsSync(join(home, ".hasna", "banking", "banking.db"))).toBe(false);
    void store;
  });

  test("explicit path option wins over the env override and the default", () => {
    const explicit = join(tempRoot, "explicit", "banking.db");
    process.env["HOME"] = join(tempRoot, "home");
    process.env["HASNA_BANKING_HOME"] = join(tempRoot, "override-root");

    const store = createSqliteDevStore({ path: explicit });
    expect(existsSync(explicit)).toBe(true);
    void store;
  });
});
