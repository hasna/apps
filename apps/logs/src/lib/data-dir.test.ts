/**
 * @hasna/logs — local data directory resolution (hasna/apps#1720 validation).
 *
 * The data dir follows the @hasna/contracts credential chain's notion of the
 * `~/.hasna` root: `HASNA_HOME` replaces it (absolute, non-blank only), an
 * explicit HASNA_LOGS_DATA_DIR / LOGS_DATA_DIR wins, and the value is read
 * fresh per call — never captured at module load.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getLogsDataDir, getLogsDbPath } from "../db/index.ts";
import {
  hasExplicitLogsDataDir,
  resolveHasnaHome,
  resolveLogsDataDir,
} from "./data-dir.ts";

const TOUCHED = [
  "HASNA_LOGS_DATA_DIR",
  "LOGS_DATA_DIR",
  "HASNA_LOGS_DB_PATH",
  "LOGS_DB_PATH",
  "HASNA_HOME",
  "HOME",
] as const;
const saved = new Map<string, string | undefined>(TOUCHED.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveLogsDataDir", () => {
  test("defaults to $HOME/.hasna/logs", () => {
    expect(resolveLogsDataDir({ HOME: "/h" })).toBe(join("/h", ".hasna", "logs"));
    expect(resolveHasnaHome({ HOME: "/h" })).toBe(join("/h", ".hasna"));
  });

  test("HASNA_HOME replaces the ~/.hasna root, like the credential chain", () => {
    expect(resolveLogsDataDir({ HOME: "/h", HASNA_HOME: "/moved" })).toBe(join("/moved", "logs"));
    expect(resolveHasnaHome({ HOME: "/h", HASNA_HOME: "/moved" })).toBe("/moved");
  });

  test("a blank or relative HASNA_HOME is unset", () => {
    expect(resolveLogsDataDir({ HOME: "/h", HASNA_HOME: "  " })).toBe(join("/h", ".hasna", "logs"));
    expect(resolveLogsDataDir({ HOME: "/h", HASNA_HOME: "rel/dir" })).toBe(join("/h", ".hasna", "logs"));
  });

  test("an explicit data dir wins over HASNA_HOME; the legacy alias is honoured; blanks are ignored", () => {
    expect(resolveLogsDataDir({ HOME: "/h", HASNA_HOME: "/moved", HASNA_LOGS_DATA_DIR: "/d" })).toBe("/d");
    expect(resolveLogsDataDir({ HOME: "/h", LOGS_DATA_DIR: "/legacy" })).toBe("/legacy");
    expect(resolveLogsDataDir({ HOME: "/h", HASNA_LOGS_DATA_DIR: " ", LOGS_DATA_DIR: "/legacy" })).toBe("/legacy");
    expect(hasExplicitLogsDataDir({ HASNA_LOGS_DATA_DIR: "/d" })).toBe(true);
    expect(hasExplicitLogsDataDir({ HASNA_LOGS_DATA_DIR: "" })).toBe(false);
  });
});

describe("db/index resolves the data dir per call, not at import", () => {
  test("getLogsDataDir / getLogsDbPath follow env changes made after module load", () => {
    delete process.env.HASNA_LOGS_DATA_DIR;
    delete process.env.LOGS_DATA_DIR;
    delete process.env.HASNA_LOGS_DB_PATH;
    delete process.env.LOGS_DB_PATH;

    process.env.HOME = "/late-home";
    process.env.HASNA_HOME = "/late-hasna";
    expect(getLogsDataDir()).toBe(join("/late-hasna", "logs"));
    expect(getLogsDbPath()).toBe(join("/late-hasna", "logs", "logs.db"));

    process.env.HASNA_LOGS_DATA_DIR = "/late-explicit";
    expect(getLogsDataDir()).toBe("/late-explicit");
    expect(getLogsDbPath()).toBe(join("/late-explicit", "logs.db"));

    process.env.HASNA_LOGS_DB_PATH = "/elsewhere/logs.db";
    expect(getLogsDbPath()).toBe("/elsewhere/logs.db");
  });
});
