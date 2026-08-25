/**
 * frontmatter-strict-yaml.test.ts — the oss-app-two-backend-storage legacy bug
 * as a standing regression.
 *
 * The installed mirror of the two-backend-storage recipe carried a `description`
 * whose plain-scalar value contained an unquoted colon+space ("storage contract:
 * client transport"). Strict YAML frontmatter loaders reject that — Codewith
 * 0.1.95 failed with "mapping values are not allowed in this context at line 2
 * column 63" on every startup — while `parseSkillFrontmatter` (a first-colon
 * splitter) reads it silently and cannot catch the class. This file pins the
 * STRICT parse so the failure mode has an instrument.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, YAMLParseError } from "yaml";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Locate the corpus (skills/) from the package root. */
function findSkillsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("Could not find skills/ directory");
}

const SKILLS_DIR = findSkillsDir();

/** The exact legacy frontmatter that Codewith 0.1.95 rejected on 2026-08-19. */
const LEGACY_INVALID_FRONTMATTER = `---
name: oss-app-two-backend-storage
description: Recipe for the Hasna two-backend storage contract: client transport + HTTP store, server PG/SQLite backend, pg-migrations + apply script, fail-closed URL-without-key, bun bins, contract manifest, Dockerfile. Use when building or extending an app whose client connects to an on-box store or a server HTTP API and whose server runs SQLite or PostgreSQL behind HASNA_<APP>_DATABASE_URL.
kind: instruction
version: 0.1.0
source: custom
category: Development Tools
tags:
  - custom
  - oss-app-two-backend-storage
  - storage
  - backend
  - postgresql
  - sqlite
  - two-backend
---`;

function frontmatterBlock(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

function corpusSkillNames(): string[] {
  return readdirSync(SKILLS_DIR).filter((entry) => {
    const full = join(SKILLS_DIR, entry);
    return entry !== "_common" && !entry.startsWith(".") && statSync(full).isDirectory();
  });
}

describe("strict frontmatter YAML regression", () => {
  test("instrument can fail: the legacy unquoted-colon form is rejected", () => {
    expect(() => parse(LEGACY_INVALID_FRONTMATTER)).toThrow(YAMLParseError);
  });

  test("every corpus SKILL.md with a frontmatter block strict-parses and carries a bounded description", () => {
    const failures: string[] = [];
    for (const name of corpusSkillNames()) {
      const skillMdPath = join(SKILLS_DIR, name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      const content = readFileSync(skillMdPath, "utf-8");
      const block = frontmatterBlock(content);
      if (!block) continue; // SKILL.md without frontmatter is a validation warning, not this guard
      let doc: unknown;
      try {
        doc = parse(block);
      } catch (error) {
        failures.push(`${name}: strict YAML parse failed: ${(error as Error).message.split("\n")[0]}`);
        continue;
      }
      const description = (doc as { description?: unknown } | null)?.description;
      if (typeof description !== "string") {
        failures.push(`${name}: frontmatter description is not a string`);
      } else if (description.length > 1024) {
        failures.push(`${name}: description exceeds the 1024-character agent-loader limit (${description.length})`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("oss-app-two-backend-storage frontmatter is schema-valid", () => {
    const content = readFileSync(join(SKILLS_DIR, "oss-app-two-backend-storage", "SKILL.md"), "utf-8");
    const block = frontmatterBlock(content);
    expect(block).not.toBeNull();
    const doc = parse(block as string) as {
      name?: unknown;
      description?: unknown;
      kind?: unknown;
    };
    expect(doc.name).toBe("oss-app-two-backend-storage");
    expect(typeof doc.description).toBe("string");
    expect((doc.description as string).length).toBeLessThanOrEqual(1024);
    expect(doc.kind).toBe("instruction");
  });
});
