import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeRepositoryUrl, readProjectInfo } from "./project.js";

describe("normalizeRepositoryUrl", () => {
  test("returns undefined for empty input", () => {
    expect(normalizeRepositoryUrl(undefined)).toBeUndefined();
    expect(normalizeRepositoryUrl("")).toBeUndefined();
  });

  test("strips git+ scheme and .git suffix", () => {
    expect(normalizeRepositoryUrl("git+https://github.com/hasna/changelog.git")).toBe(
      "https://github.com/hasna/changelog",
    );
  });

  test("converts ssh git@ form to https", () => {
    expect(normalizeRepositoryUrl("git@github.com:hasna/changelog.git")).toBe(
      "https://github.com/hasna/changelog",
    );
    expect(normalizeRepositoryUrl("git@github.com:hasna/changelog")).toBe(
      "https://github.com/hasna/changelog",
    );
  });

  test("leaves a plain https URL untouched", () => {
    expect(normalizeRepositoryUrl("https://github.com/hasna/changelog")).toBe(
      "https://github.com/hasna/changelog",
    );
  });

  test("only strips one trailing .git segment", () => {
    expect(normalizeRepositoryUrl("https://github.com/hasna/changelog.git.git")).toBe(
      "https://github.com/hasna/changelog.git",
    );
  });
});

describe("readProjectInfo", () => {
  test("derives appId from an npm-scoped name and normalizes a string repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-project-"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "@hasna/todos", repository: "git+https://github.com/hasna/todos.git" }),
      "utf8",
    );
    expect(await readProjectInfo(cwd)).toEqual({
      appId: "todos",
      repositoryUrl: "https://github.com/hasna/todos",
    });
  });

  test("reads an object-form repository url and a bare unscoped name", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-project-obj-"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "mercury-cli",
        repository: { type: "git", url: "git@github.com:hasna/mercury.git" },
      }),
      "utf8",
    );
    expect(await readProjectInfo(cwd)).toEqual({
      appId: "mercury-cli",
      repositoryUrl: "https://github.com/hasna/mercury",
    });
  });

  test("returns an empty object when package.json is missing or malformed", async () => {
    const empty = await mkdtemp(join(tmpdir(), "changelog-project-missing-"));
    expect(await readProjectInfo(empty)).toEqual({});

    const malformed = await mkdtemp(join(tmpdir(), "changelog-project-malformed-"));
    await writeFile(join(malformed, "package.json"), "{not json", "utf8");
    expect(await readProjectInfo(malformed)).toEqual({});
  });

  test("drops an appId when the name cannot derive a slug", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-project-slug-"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "@hasna/!!!", repository: "https://github.com/hasna/other.git" }),
      "utf8",
    );
    const info = await readProjectInfo(cwd);
    expect(info.appId).toBeUndefined();
    expect(info.repositoryUrl).toBe("https://github.com/hasna/other");
  });
});

describe("readProjectInfo malformed repository values", () => {
  test("returns undefined repositoryUrl for an object without a url and drops the appId for a name with no slash", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-project-nourl-"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "@hasna/todos", repository: { type: "git" } }),
      "utf8",
    );
    expect(await readProjectInfo(cwd)).toEqual({ appId: "todos", repositoryUrl: undefined });
  });

  test("repository object url is empty string and repository as number are treated as absent", async () => {
    const emptyUrl = await mkdtemp(join(tmpdir(), "changelog-project-emptyurl-"));
    await writeFile(
      join(emptyUrl, "package.json"),
      JSON.stringify({ name: "app", repository: { url: "" } }),
      "utf8",
    );
    expect(await readProjectInfo(emptyUrl)).toEqual({ appId: "app", repositoryUrl: undefined });

    const numeric = await mkdtemp(join(tmpdir(), "changelog-project-numeric-"));
    await writeFile(
      join(numeric, "package.json"),
      JSON.stringify({ name: "app", repository: 42 }),
      "utf8",
    );
    const info = await readProjectInfo(numeric);
    expect(info.repositoryUrl).toBeUndefined();
  });

  test("normalizeRepositoryUrl leaves malformed and non-URL values untouched", () => {
    expect(normalizeRepositoryUrl("not-a-url")).toBe("not-a-url");
    expect(normalizeRepositoryUrl("https://example.com/a b")).toBe("https://example.com/a b");
    expect(normalizeRepositoryUrl("ssh://git@github.com/hasna/x")).toBe("ssh://git@github.com/hasna/x");
  });
});
