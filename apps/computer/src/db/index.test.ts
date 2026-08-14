import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir } from "./index.js";

let oldHome: string | undefined;
let oldUserProfile: string | undefined;
let oldDataDir: string | undefined;
let tempHome: string | null = null;

afterEach(() => {
  restoreEnv("HOME", oldHome);
  restoreEnv("USERPROFILE", oldUserProfile);
  restoreEnv("COMPUTER_DATA_DIR", oldDataDir);
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
});

function isolateHome(): string {
  oldHome = process.env["HOME"];
  oldUserProfile = process.env["USERPROFILE"];
  oldDataDir = process.env["COMPUTER_DATA_DIR"];
  tempHome = mkdtempSync(join(tmpdir(), "computer-home-"));
  process.env["HOME"] = tempHome;
  delete process.env["USERPROFILE"];
  delete process.env["COMPUTER_DATA_DIR"];
  return tempHome;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("computer data dir", () => {
  test("migrates legacy ~/.open-computer into ~/.hasna/computer", () => {
    const home = isolateHome();
    mkdirSync(join(home, ".open-computer", "screenshots"), { recursive: true });
    writeFileSync(join(home, ".open-computer", "computer.db"), "legacy-db");
    writeFileSync(join(home, ".open-computer", "screenshots", "one.txt"), "shot");

    const dir = getDataDir();

    expect(dir).toBe(join(home, ".hasna", "computer"));
    expect(readFileSync(join(dir, "computer.db"), "utf8")).toBe("legacy-db");
    expect(readFileSync(join(dir, "screenshots", "one.txt"), "utf8")).toBe("shot");
  });

  test("migrates legacy ~/.computer when ~/.open-computer is absent", () => {
    const home = isolateHome();
    mkdirSync(join(home, ".computer"), { recursive: true });
    writeFileSync(join(home, ".computer", "computer.db"), "legacy-db");

    const dir = getDataDir();

    expect(readFileSync(join(dir, "computer.db"), "utf8")).toBe("legacy-db");
  });

  test("does not copy legacy data over an existing canonical directory", () => {
    const home = isolateHome();
    mkdirSync(join(home, ".open-computer"), { recursive: true });
    mkdirSync(join(home, ".hasna", "computer"), { recursive: true });
    writeFileSync(join(home, ".open-computer", "legacy.txt"), "legacy");
    writeFileSync(join(home, ".hasna", "computer", "current.txt"), "current");

    const dir = getDataDir();

    expect(readFileSync(join(dir, "current.txt"), "utf8")).toBe("current");
    expect(existsSync(join(dir, "legacy.txt"))).toBe(false);
  });
});
