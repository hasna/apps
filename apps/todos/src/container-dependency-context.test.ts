import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";

const root = join(import.meta.dir, "..");

describe("container dependency context", () => {
  test("copies every workspace manifest before the frozen install", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const depsStage = dockerfile
      .split("FROM base AS deps")[1]
      ?.split("FROM base AS build")[0];

    expect(depsStage).toBeDefined();

    const installIndex = depsStage!.indexOf(
      "RUN bun install --frozen-lockfile --ignore-scripts",
    );
    expect(installIndex).toBeGreaterThan(-1);

    for (const workspace of packageJson.workspaces) {
      const manifest = `${workspace}/package.json`;

      expect(existsSync(join(root, manifest))).toBe(true);

      const copyIndex = depsStage!.indexOf(`COPY ${manifest} ./${manifest}`);
      expect(copyIndex).toBeGreaterThan(-1);
      expect(copyIndex).toBeLessThan(installIndex);
    }
  });
});
