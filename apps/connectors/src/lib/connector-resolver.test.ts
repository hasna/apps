import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  connectorPackageDirNames,
  getConnectorConfigDir,
  getConnectorConfigReadDirs,
  getConnectorPackagePath,
  getExistingConnectorConfigDirs,
  isValidConnectorName,
  legacyConnectorName,
  listConfiguredConnectorNames,
  normalizeConnectorName,
  resolveConnectorConfigPaths,
  resolveConnectorName,
  resolveConnectorPackagePath,
} from "./connector-resolver.js";

const TEST_DIR = join(import.meta.dir, "..", "..", ".test-connector-resolver");
const PACKAGE_DIR = join(TEST_DIR, "connectors");
const CONFIG_DIR = join(TEST_DIR, "home");

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

beforeEach(() => {
  cleanup();
  mkdirSync(PACKAGE_DIR, { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
});

afterEach(() => {
  cleanup();
});

describe("connector resolver", () => {
  test("normalizes canonical and legacy connector names", () => {
    expect(normalizeConnectorName("github")).toBe("github");
    expect(normalizeConnectorName("connect-github")).toBe("github");
    expect(normalizeConnectorName(" CONNECT-GITHUB ")).toBe("github");
    expect(legacyConnectorName("github")).toBe("connect-github");
    expect(legacyConnectorName("connect-github")).toBe("connect-github");
  });

  test("resolves alumia twitter slug aliases to canonical x connector", () => {
    expect(normalizeConnectorName("twitter")).toBe("x");
    expect(normalizeConnectorName("x-twitter")).toBe("x");
    expect(normalizeConnectorName("connect-twitter")).toBe("x");
    expect(normalizeConnectorName("connect-x-twitter")).toBe("x");
    expect(normalizeConnectorName("x")).toBe("x");

    expect(resolveConnectorName("twitter")).toEqual({
      input: "twitter",
      canonicalName: "x",
      legacyName: "connect-x",
      aliases: ["x", "connect-x", "twitter", "x-twitter"],
      isLegacyInput: false,
    });
    expect(connectorPackageDirNames("twitter")).toEqual(["x", "connect-x"]);
  });

  test("resolves twitter alias to x package directory", () => {
    mkdirSync(join(PACKAGE_DIR, "x"));

    const resolution = resolveConnectorPackagePath(PACKAGE_DIR, "twitter");
    expect(resolution.canonicalName).toBe("x");
    expect(resolution.existingPath).toBe(join(PACKAGE_DIR, "x"));
    expect(getConnectorPackagePath(PACKAGE_DIR, "twitter")).toBe(join(PACKAGE_DIR, "x"));
    expect(getConnectorConfigDir("twitter", CONFIG_DIR)).toBe(join(CONFIG_DIR, "x"));
  });

  test("resolves aliases with prefixless canonical name", () => {
    expect(resolveConnectorName("connect-googledrive")).toEqual({
      input: "connect-googledrive",
      canonicalName: "googledrive",
      legacyName: "connect-googledrive",
      aliases: ["googledrive", "connect-googledrive"],
      isLegacyInput: true,
    });
  });

  test("validates against canonical connector ids", () => {
    expect(isValidConnectorName("github")).toBe(true);
    expect(isValidConnectorName("connect-github")).toBe(true);
    expect(isValidConnectorName("GitHub")).toBe(false);
    expect(isValidConnectorName("../github")).toBe(false);
    expect(isValidConnectorName("github!")).toBe(false);
  });

  test("prefers prefixless package directories when both exist", () => {
    mkdirSync(join(PACKAGE_DIR, "github"));
    mkdirSync(join(PACKAGE_DIR, "connect-github"));

    const resolution = resolveConnectorPackagePath(PACKAGE_DIR, "connect-github");
    expect(resolution.canonicalName).toBe("github");
    expect(resolution.preferredDirName).toBe("github");
    expect(resolution.existingDirName).toBe("github");
    expect(resolution.existingPath).toBe(join(PACKAGE_DIR, "github"));
    expect(getConnectorPackagePath(PACKAGE_DIR, "github")).toBe(join(PACKAGE_DIR, "github"));
  });

  test("falls back to legacy package directories during migration", () => {
    mkdirSync(join(PACKAGE_DIR, "connect-stripe"));

    const resolution = resolveConnectorPackagePath(PACKAGE_DIR, "stripe");
    expect(resolution.canonicalName).toBe("stripe");
    expect(resolution.existingDirName).toBe("connect-stripe");
    expect(resolution.existingPath).toBe(join(PACKAGE_DIR, "connect-stripe"));
    expect(getConnectorPackagePath(PACKAGE_DIR, "connect-stripe")).toBe(join(PACKAGE_DIR, "connect-stripe"));
    expect(connectorPackageDirNames("connect-stripe")).toEqual(["stripe", "connect-stripe"]);
  });

  test("returns prefixless package path when no directory exists", () => {
    const resolution = resolveConnectorPackagePath(PACKAGE_DIR, "missing");
    expect(resolution.existingPath).toBeNull();
    expect(resolution.preferredPath).toBe(join(PACKAGE_DIR, "missing"));
    expect(getConnectorPackagePath(PACKAGE_DIR, "missing")).toBe(join(PACKAGE_DIR, "missing"));
  });

  test("prefers prefixless config dirs for writes and reads legacy dirs", () => {
    mkdirSync(join(CONFIG_DIR, "connect-gmail"));

    expect(getConnectorConfigDir("connect-gmail", CONFIG_DIR)).toBe(join(CONFIG_DIR, "gmail"));
    expect(getExistingConnectorConfigDirs("gmail", CONFIG_DIR)).toEqual([
      join(CONFIG_DIR, "connect-gmail"),
    ]);
    expect(getConnectorConfigReadDirs("gmail", CONFIG_DIR)).toEqual([
      join(CONFIG_DIR, "gmail"),
      join(CONFIG_DIR, "connect-gmail"),
    ]);
  });

  test("reports config path metadata", () => {
    const resolution = resolveConnectorConfigPaths("connect-googledrive", CONFIG_DIR);
    expect(resolution).toMatchObject({
      canonicalName: "googledrive",
      legacyName: "connect-googledrive",
      preferredDirName: "googledrive",
      preferredPath: join(CONFIG_DIR, "googledrive"),
      legacyPath: join(CONFIG_DIR, "connect-googledrive"),
      existingPaths: [],
      readPaths: [
        join(CONFIG_DIR, "googledrive"),
        join(CONFIG_DIR, "connect-googledrive"),
      ],
    });
  });

  test("lists configured connector names from prefixless and legacy dirs", () => {
    mkdirSync(join(CONFIG_DIR, "gmail"));
    mkdirSync(join(CONFIG_DIR, "connect-googledrive"));
    mkdirSync(join(CONFIG_DIR, "not a connector"));

    expect(listConfiguredConnectorNames(CONFIG_DIR)).toEqual(["gmail", "googledrive"]);
  });
});
