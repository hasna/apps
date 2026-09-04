import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir } from "@hasna/contracts/paths";

import {
  PROJECTS_HOME_ENV,
  getProjectsHome,
  legacyHomeDir,
  projectDataStorePath,
  projectWorkspaceStorePath,
  resolverHome,
} from "./project-store-paths.js";

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// this machine's real home.
const testHome = join(tmpdir(), `projects-home-test-${Date.now()}`);
const savedHome = process.env.HOME;
process.env.HOME = testHome;

beforeAll(() => {
  mkdtempSync(testHome);
});

afterAll(() => {
  process.env.HOME = savedHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe("projects home resolution (single resolver in @hasna/contracts, ruling #1668)", () => {
  it("the legacy root is spelled under ~/.hasna/projects", () => {
    expect(legacyHomeDir()).toBe(join(testHome, ".hasna", "projects"));
  });

  it("the effective home is the resolver data root", () => {
    expect(resolverHome()).toBe(dataDir({ app: "projects", home: testHome, env: process.env }));
    expect(getProjectsHome()).toBe(resolverHome());
  });

  it("honors the HASNA_PROJECTS_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "projects-home-"));
    try {
      process.env[PROJECTS_HOME_ENV] = join(base, "custom-home");
      expect(getProjectsHome()).toBe(join(base, "custom-home"));
      expect(projectWorkspaceStorePath("wks_abc")).toBe(join(base, "custom-home", "workspaces", "wks_abc"));
      expect(projectDataStorePath("wks_abc")).toBe(join(base, "custom-home", "data", "wks_abc"));
    } finally {
      delete process.env[PROJECTS_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("HASNA_DATA_HOME kind override moves the resolver root (app segment kept)", () => {
    const base = mkdtempSync(join(tmpdir(), "projects-xdg-"));
    try {
      process.env.HASNA_DATA_HOME = base;
      const expected = dataDir({ app: "projects", home: testHome, env: { HASNA_DATA_HOME: base } });
      expect(resolverHome()).toBe(expected);
      expect(getProjectsHome()).toBe(expected);
      expect(projectWorkspaceStorePath("wks_abc")).toBe(join(expected, "workspaces", "wks_abc"));
    } finally {
      delete process.env.HASNA_DATA_HOME;
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("workspace and data store paths nest under the effective root", () => {
    const root = resolverHome();
    expect(projectWorkspaceStorePath("wks_abc")).toBe(join(root, "workspaces", "wks_abc"));
    expect(projectDataStorePath("wks_abc")).toBe(join(root, "data", "wks_abc"));
  });
});