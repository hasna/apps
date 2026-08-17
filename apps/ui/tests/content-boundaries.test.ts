import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { CONTENT_DIR_ENV, resolveContentDir } from "../src/content.ts";

const originalContentDir = process.env[CONTENT_DIR_ENV];

afterEach(() => {
  if (originalContentDir === undefined) delete process.env[CONTENT_DIR_ENV];
  else process.env[CONTENT_DIR_ENV] = originalContentDir;
});

describe("content directory configuration boundaries", () => {
  test("falls back to the default content directory when the environment is empty", () => {
    process.env[CONTENT_DIR_ENV] = "";
    expect(resolveContentDir()).toBe(resolve(process.cwd(), "content"));
  });
});
