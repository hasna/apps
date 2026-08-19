// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// s3ObjectUrl / parseS3ObjectUrl are the two ends of every S3 object
// reference passed between CLI output, config files and the sync engine. The
// parse must be STRICT in the directions that cost data and LENIENT in the
// one that costs nothing:
//   - an unparseable reference throws rather than returning a partial
//     {bucket, key} — a partial parse would make the engine read from the
//     wrong bucket and report success;
//   - surrounding whitespace is tolerated (config files get pasted);
//   - the key is everything after the FIRST slash, so keys containing
//     slashes survive round-trips, and a bucket-only `s3://bucket` has no key
//     and must fail.

import { describe, expect, it } from "bun:test";
import { parseS3ObjectUrl, s3ObjectUrl } from "./s3-object.js";

describe("s3ObjectUrl", () => {
  it("composes bucket and key into an s3:// url", () => {
    expect(s3ObjectUrl("my-bucket", "path/to/key")).toBe("s3://my-bucket/path/to/key");
    expect(s3ObjectUrl("b", "k")).toBe("s3://b/k");
  });
});

describe("parseS3ObjectUrl", () => {
  it("parses a plain object url", () => {
    expect(parseS3ObjectUrl("s3://my-bucket/path/to/key")).toEqual({
      bucket: "my-bucket",
      key: "path/to/key",
    });
  });

  it("round-trips s3ObjectUrl output", () => {
    expect(parseS3ObjectUrl(s3ObjectUrl("my-bucket", "a/b/c"))).toEqual({
      bucket: "my-bucket",
      key: "a/b/c",
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseS3ObjectUrl("  s3://b/k  ")).toEqual({ bucket: "b", key: "k" });
  });

  it("keeps slash-containing keys intact — key is everything after the first slash", () => {
    expect(parseS3ObjectUrl("s3://b/a/b/c")).toEqual({ bucket: "b", key: "a/b/c" });
  });

  it("throws on urls with no key", () => {
    expect(() => parseS3ObjectUrl("s3://bucket")).toThrow(/Invalid S3 object URL/);
    expect(() => parseS3ObjectUrl("s3://")).toThrow(/Invalid S3 object URL/);
  });

  it("throws on empty buckets and malformed schemes", () => {
    expect(() => parseS3ObjectUrl("s3:///k")).toThrow(/Invalid S3 object URL/);
    expect(() => parseS3ObjectUrl("s3:/b/k")).toThrow(/Invalid S3 object URL/);
    expect(() => parseS3ObjectUrl("http://b/k")).toThrow(/Invalid S3 object URL/);
    expect(() => parseS3ObjectUrl("b/k")).toThrow(/Invalid S3 object URL/);
    expect(() => parseS3ObjectUrl("")).toThrow(/Invalid S3 object URL/);
  });

  it("rejects url-unsafe schemes case-sensitively", () => {
    expect(() => parseS3ObjectUrl("S3://b/k")).toThrow(/Invalid S3 object URL/);
  });
});
