import { describe, expect, test } from "bun:test";
import {
  ConnectorOperationNotSupported,
  getSocialOperations,
  listSocialConnectors,
  runSocialOperation,
} from "./index";

describe("social SDK dispatch", () => {
  test("listSocialConnectors returns x, mastodon, bluesky", () => {
    expect(listSocialConnectors().sort()).toEqual(["bluesky", "mastodon", "x"]);
  });

  test("getSocialOperations lists the normalized ops per connector", () => {
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

  test("getSocialOperations throws for unknown connector", () => {
    expect(() => getSocialOperations("facebook")).toThrow(ConnectorOperationNotSupported);
  });

  test("unknown connector throws ConnectorOperationNotSupported", async () => {
    await expect(
      runSocialOperation({ connector: "facebook", operation: "post.create", input: { text: "x" } }),
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
