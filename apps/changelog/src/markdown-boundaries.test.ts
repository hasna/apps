import { describe, expect, test } from "bun:test";
import { generateChangelogMarkdown, groupChangelogEntries } from "./markdown.js";
import type { ChangelogEntry, ChangelogKind } from "./types.js";

function entry(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  const kind: ChangelogKind = overrides.kind ?? "changed";
  return {
    id: overrides.id ?? "entry-1",
    appId: overrides.appId ?? "app",
    version: overrides.version ?? "Unreleased",
    kind,
    category: overrides.category ?? kind,
    title: overrides.title ?? "A change",
    date: overrides.date ?? "2026-08-17",
    tags: overrides.tags ?? [],
    links: overrides.links ?? [],
    commits: overrides.commits ?? [],
    tasks: overrides.tasks ?? [],
    createdAt: overrides.createdAt ?? "2026-08-17T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-17T12:00:00.000Z",
    source: overrides.source ?? "sdk",
    ...overrides,
  };
}

describe("markdown boundary behavior", () => {
  test("orders Unreleased, stable, prerelease, and non-semver groups deterministically", () => {
    const groups = groupChangelogEntries([
      entry({ id: "legacy-old", version: "legacy-a", date: "2026-01-01" }),
      entry({ id: "beta", version: "2.0.0-beta.10" }),
      entry({ id: "stable-old", version: "1.9.9" }),
      entry({ id: "stable", version: "2.0.0" }),
      entry({ id: "legacy-new", version: "legacy-b", date: "2026-02-01" }),
      entry({ id: "unreleased", version: "Unreleased" }),
    ]);

    expect(groups.map((group) => group.version)).toEqual([
      "Unreleased",
      "2.0.0",
      "2.0.0-beta.10",
      "1.9.9",
      "legacy-b",
      "legacy-a",
    ]);
  });

  test("sorts entries within a version by date and creation time without mutating input", () => {
    const entries = [
      entry({ id: "older", title: "Older", version: "1.0.0", createdAt: "2026-08-17T10:00:00.000Z" }),
      entry({ id: "newer", title: "Newer", version: "1.0.0", createdAt: "2026-08-17T11:00:00.000Z" }),
    ];

    expect(groupChangelogEntries(entries)[0]?.entries.map((item) => item.id)).toEqual(["newer", "older"]);
    expect(entries.map((item) => item.id)).toEqual(["older", "newer"]);
  });

  test("applies app, version, kind, and case-insensitive tag filters together", () => {
    const markdown = generateChangelogMarkdown([
      entry({ id: "match", appId: "target", version: "1.0.0", kind: "fixed", category: "fixed", tags: ["release"], title: "Matched" }),
      entry({ id: "wrong-app", appId: "other", version: "1.0.0", kind: "fixed", category: "fixed", tags: ["release"], title: "Wrong app" }),
      entry({ id: "wrong-kind", appId: "target", version: "1.0.0", kind: "added", category: "added", tags: ["release"], title: "Wrong kind" }),
      entry({ id: "wrong-tag", appId: "target", version: "1.0.0", kind: "fixed", category: "fixed", tags: ["other"], title: "Wrong tag" }),
    ], { appId: "target", version: "1.0.0", category: "fixed", tag: "RELEASE" });

    expect(markdown).toContain("Matched");
    expect(markdown).not.toContain("Wrong app");
    expect(markdown).not.toContain("Wrong kind");
    expect(markdown).not.toContain("Wrong tag");
  });

  test("clamps negative and oversized limits to the documented one-to-500 range", () => {
    const entries = Array.from({ length: 501 }, (_, index) => entry({
      id: `entry-${index}`,
      title: `Change ${index}`,
      createdAt: `2026-08-17T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));

    const minimum = generateChangelogMarkdown(entries, { limit: -4 });
    expect((minimum.match(/^- Change /gm) ?? []).length).toBe(1);

    const maximum = generateChangelogMarkdown(entries, { limit: 999 });
    expect((maximum.match(/^- Change /gm) ?? []).length).toBe(500);
  });

  test("normalizes inline whitespace, details, and references without inventing links", () => {
    const markdown = generateChangelogMarkdown([
      entry({
        title: "  Multi\n line   title  ",
        message: " extra\t context ",
        details: " first detail \n\n second detail ",
        tasks: ["42", "task-name"],
        commits: ["abcdef1", "not-a-hash"],
        links: [{ label: "Notes", url: "https://example.com/notes" }, { url: "https://example.com/raw" }],
        author: "Example Author",
      }),
    ], { repositoryUrl: "https://github.com/example/project" });

    expect(markdown).toContain("- Multi line title: extra context");
    expect(markdown).toContain("  first detail\n  second detail");
    expect(markdown).toContain("[task 42](https://github.com/example/project/issues/42)");
    expect(markdown).toContain("task task-name");
    expect(markdown).toContain("[commit abcdef1](https://github.com/example/project/commit/abcdef1)");
    expect(markdown).toContain("commit not-a-hash");
    expect(markdown).toContain("[Notes](https://example.com/notes), https://example.com/raw");
    expect(markdown).toContain("Author: Example Author");
  });

  test("renders an empty filtered result without the optional introduction", () => {
    const markdown = generateChangelogMarkdown([entry({ appId: "other" })], {
      appId: "missing",
      includeIntro: false,
      title: "Filtered",
    });

    expect(markdown).toBe("# Filtered\n\n## Unreleased\n\nNo changes recorded yet.\n");
    expect(markdown).not.toContain("All notable changes");
  });
});
