import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { loadTestersConfig, discoverScenariosFromFiles } from "./discovery.js";
import { resetDatabase, closeDatabase } from "../db/database.js";

const tmpDir = "/tmp/open-testers-discovery-test";

function writeFile(name: string, content: string) {
  mkdirSync(join(tmpDir, "tests", "scenarios"), { recursive: true });
  writeFileSync(join(tmpDir, name), content);
}

describe("discovery", () => {
  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  beforeAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("parseYamlLike", () => {
    test("parses scenario with steps", () => {
      const content = `url: http://example.com
model: quick
scenarios:
  - name: Login Test
    description: Test the login flow
    steps:
      - Navigate to /login
      - Click submit
    tags:
      - smoke
      - auth
`;
      writeFile(".testers.yml", content);
      const config = loadTestersConfig(join(tmpDir, ".testers.yml"));
      expect(config.url).toBe("http://example.com");
      expect(config.model).toBe("quick");
      expect(config.scenarios).toHaveLength(1);
      expect(config.scenarios![0].name).toBe("Login Test");
      expect(config.scenarios![0].steps).toHaveLength(2);
      expect(config.scenarios![0].steps![0]).toBe("Navigate to /login");
      expect(config.scenarios![0].tags).toEqual(["smoke", "auth"]);
    });

    test("parses inline array values", () => {
      const content = `scenarios:
  - name: Quick Test
    priority: high
    tags: ["critical", "smoke"]
`;
      writeFile("inline.testers.yml", content);
      const config = loadTestersConfig(join(tmpDir, "inline.testers.yml"));
      expect(config.scenarios![0].priority).toBe("high");
      expect(config.scenarios![0].tags).toEqual(["critical", "smoke"]);
    });
  });

  describe("discoverScenariosFromFiles", () => {
    test("returns zero when no config files exist", () => {
      const result = discoverScenariosFromFiles(tmpDir);
      expect(result.total).toBe(0);
    });

    test("discovers from .testers.yml", () => {
      const content = `scenarios:
  - name: File Discovery Test
    description: Tests file-based discovery
    steps:
      - Navigate to /
    tags:
      - smoke
`;
      writeFile(".testers.yml", content);
      const result = discoverScenariosFromFiles(tmpDir);
      expect(result.created).toBe(1);
      expect(result.total).toBe(1);

      // Second run should dedupe
      const result2 = discoverScenariosFromFiles(tmpDir);
      expect(result2.deduped).toBe(1);
      expect(result2.created).toBe(0);
    });

    test("discovers from tests/scenarios/*.yaml", () => {
      const content = `scenarios:
  - name: Scenario From File
    description: Auto-discovered
    steps:
      - Go to home
    tags:
      - auto
`;
      writeFile("tests/scenarios/home.yaml", content);
      const result = discoverScenariosFromFiles(tmpDir);
      expect(result.created).toBeGreaterThanOrEqual(1);
    });
  });
});
