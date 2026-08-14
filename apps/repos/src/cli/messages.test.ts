import { describe, expect, test } from "bun:test";
import { formatRepoNotFoundMessage } from "./messages.js";

describe("formatRepoNotFoundMessage", () => {
  test("returns basic message when no suggestion exists", () => {
    expect(formatRepoNotFoundMessage("repo-x")).toBe("Repo not found: repo-x");
  });

  test("returns suggestion with path hint when available", () => {
    expect(
      formatRepoNotFoundMessage("rep", { name: "repos", path: "/tmp/repos" })
    ).toBe("Repo not found: rep. Did you mean 'repos' (/tmp/repos)?");
  });
});
