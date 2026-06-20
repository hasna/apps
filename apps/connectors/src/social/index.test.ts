import { describe, expect, test } from "bun:test";
import {
  ConnectorOperationNotSupported,
  getSocialOperations,
  listSocialConnectors,
  runSocialOperation,
} from "./index";

describe("social SDK dispatch", () => {
  test("listSocialConnectors returns all 12 supported connectors", () => {
    expect(listSocialConnectors().sort()).toEqual([
      "bluesky",
      "facebook",
      "googlebusinessprofile",
      "instagram",
      "linkedin",
      "mastodon",
      "pinterest",
      "reddit",
      "threads",
      "tiktok",
      "x",
      "youtube",
    ]);
  });

  test("getSocialOperations lists the full op set for the original 3", () => {
    for (const c of ["x", "mastodon", "bluesky"]) {
      const ops = getSocialOperations(c);
      expect(ops).toContain("account.me");
      expect(ops).toContain("post.create");
      expect(ops).toContain("post.delete");
      expect(ops).toContain("media.upload");
      expect(ops).toContain("mentions.list");
      expect(ops).toContain("analytics.post");
    }
  });

  test("every supported connector exposes account.me + post.create", () => {
    for (const c of listSocialConnectors()) {
      const ops = getSocialOperations(c);
      expect(ops).toContain("account.me");
      expect(ops).toContain("post.create");
    }
  });

  test("getSocialOperations reflects per-connector capability gaps", () => {
    expect(getSocialOperations("linkedin")).not.toContain("mentions.list");
    expect(getSocialOperations("linkedin")).not.toContain("analytics.post");
    expect(getSocialOperations("tiktok")).not.toContain("post.delete");
    expect(getSocialOperations("youtube")).not.toContain("mentions.list");
    expect(getSocialOperations("pinterest")).not.toContain("mentions.list");
    expect(getSocialOperations("reddit")).not.toContain("media.upload");
    expect(getSocialOperations("googlebusinessprofile")).not.toContain("analytics.post");
    expect(getSocialOperations("facebook")).not.toContain("mentions.list");
    expect(getSocialOperations("instagram")).not.toContain("post.delete");
    expect(getSocialOperations("instagram")).not.toContain("mentions.list");
    expect(getSocialOperations("threads")).toContain("mentions.list");
    expect(getSocialOperations("threads")).toContain("post.delete");
  });

  test("dispatch reaches each new adapter (constructor enforces accessToken)", async () => {
    for (const c of [
      "linkedin",
      "reddit",
      "tiktok",
      "youtube",
      "pinterest",
      "googlebusinessprofile",
      "facebook",
      "instagram",
      "threads",
    ]) {
      await expect(
        runSocialOperation({ connector: c, operation: "account.me", input: {}, credentials: {} }),
      ).rejects.toThrow(/accessToken/);
    }
  });

  test("operation a connector doesn't expose throws (e.g. linkedin mentions.list)", async () => {
    await expect(
      runSocialOperation({
        connector: "linkedin",
        operation: "mentions.list",
        input: {},
        credentials: { accessToken: "t" },
      }),
    ).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("getSocialOperations throws for unknown connector", () => {
    expect(() => getSocialOperations("myspace")).toThrow(ConnectorOperationNotSupported);
  });

  test("unknown connector throws ConnectorOperationNotSupported", async () => {
    await expect(
      runSocialOperation({ connector: "myspace", operation: "post.create", input: { text: "x" } }),
    ).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("unknown operation throws ConnectorOperationNotSupported", async () => {
    await expect(
      runSocialOperation({ connector: "x", operation: "post.boost", input: {}, credentials: {} }),
    ).rejects.toBeInstanceOf(ConnectorOperationNotSupported);
  });

  test("known connector + op builds the adapter (fails on bad creds, not on dispatch)", async () => {
    // x requires apiKey/apiSecret; with empty creds the adapter constructor throws,
    // proving dispatch reached the adapter rather than short-circuiting.
    await expect(
      runSocialOperation({ connector: "x", operation: "account.me", input: {}, credentials: {} }),
    ).rejects.toThrow(/apiKey/);
  });

  test("ConnectorOperationNotSupported carries connector + operation", () => {
    const err = new ConnectorOperationNotSupported("bluesky", "dm.send");
    expect(err.connector).toBe("bluesky");
    expect(err.operation).toBe("dm.send");
    expect(err).toBeInstanceOf(Error);
  });
});
