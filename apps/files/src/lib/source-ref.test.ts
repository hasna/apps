import { describe, expect, test } from "bun:test";
import {
  buildOpenFilesAssetRef,
  buildOpenFilesAssetRevisionRef,
  buildOpenFilesFileRef,
  buildOpenFilesFileRevisionRef,
  buildOpenFilesSourcePathRef,
  isOpenFilesSourceRef,
  parseOpenFilesSourceRef,
} from "./source-ref.js";

describe("open-files source refs", () => {
  test("builds and parses stable file refs", () => {
    const uri = buildOpenFilesFileRef("f_123");

    expect(uri).toBe("open-files://file/f_123");
    expect(parseOpenFilesSourceRef(uri)).toEqual({
      kind: "file",
      uri,
      file_id: "f_123",
      revision_id: undefined,
    });
  });

  test("builds and parses future revision refs", () => {
    const uri = buildOpenFilesFileRevisionRef("f_123", "rev_456");

    expect(uri).toBe("open-files://file/f_123/revision/rev_456");
    expect(parseOpenFilesSourceRef(uri)).toMatchObject({
      kind: "file",
      file_id: "f_123",
      revision_id: "rev_456",
    });
  });

  test("builds and parses evidence asset refs", () => {
    const uri = buildOpenFilesAssetRef("asset_123");
    const revisionUri = buildOpenFilesAssetRevisionRef("asset_123", "assetrev_456");

    expect(uri).toBe("open-files://asset/asset_123");
    expect(revisionUri).toBe("open-files://asset/asset_123/revision/assetrev_456");
    expect(parseOpenFilesSourceRef(uri)).toEqual({
      kind: "asset",
      uri,
      asset_id: "asset_123",
      revision_id: undefined,
    });
    expect(parseOpenFilesSourceRef(revisionUri)).toMatchObject({
      kind: "asset",
      asset_id: "asset_123",
      revision_id: "assetrev_456",
    });
  });

  test("builds and parses source path refs with encoded paths", () => {
    const uri = buildOpenFilesSourcePathRef("src_abc", "Team Drive/Notes/Q2 plan.md");

    expect(uri).toBe("open-files://source/src_abc/path/Team%20Drive%2FNotes%2FQ2%20plan.md");
    expect(parseOpenFilesSourceRef(uri)).toMatchObject({
      kind: "source_path",
      source_id: "src_abc",
      path: "Team Drive/Notes/Q2 plan.md",
    });
  });

  test("rejects malformed refs", () => {
    expect(isOpenFilesSourceRef("open-files://file/f_123")).toBe(true);
    expect(isOpenFilesSourceRef("open-files://asset/asset_123")).toBe(true);
    expect(isOpenFilesSourceRef("s3://bucket/key")).toBe(false);
    expect(() => buildOpenFilesFileRef("bad/id")).toThrow("Invalid file id");
    expect(() => buildOpenFilesAssetRef("bad/id")).toThrow("Invalid asset id");
    expect(() => parseOpenFilesSourceRef("open-files://file")).toThrow("Missing file id");
    expect(() => parseOpenFilesSourceRef("open-files://asset")).toThrow("Missing asset id");
    expect(() => parseOpenFilesSourceRef("open-files://source/src_abc")).toThrow("Expected open-files://source");
  });
});
