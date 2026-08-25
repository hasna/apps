import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";
import { useDefaultTestTimeout } from "./test-preload.js";

useDefaultTestTimeout();

const root = join(import.meta.dir, "..");

describe("server image build context", () => {
  test("locks every declared dependency in the standalone bun.lock (frozen-lockfile passes)", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const lockfile = readFileSync(join(root, "bun.lock"), "utf8");

    // The deps stage copies exactly package.json + bun.lock + bunfig.toml and
    // runs `bun install --ignore-scripts --frozen-lockfile`, so the STANDALONE
    // lockfile — never the root workspace lockfile, which masks per-app drift —
    // is what must satisfy this manifest. A dependency declared in package.json
    // without regenerating this lockfile fails every docker deploy at the deps
    // stage with "error: lockfile had changes, but lockfile is frozen"
    // (measured on apps/skills: yaml@^2.9.0 declared, absent from bun.lock —
    // blocked skills deploys, O15-00754).
    expect(dockerfile).toContain("COPY package.json bun.lock bunfig.toml ./");
    expect(dockerfile).toContain("bun install --ignore-scripts --frozen-lockfile");

    const declared = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);
    for (const name of declared) {
      expect(lockfile).toContain(`"${name}": ["${name}@`);
    }
  });
});
