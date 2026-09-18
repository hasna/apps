import { describe, expect, it } from "bun:test";
import { parseAwsSecretReference, selectAwsSecretString } from "../src/aws-reference.js";

const account = "0".repeat(12);
const region = "us-east-1";
const physicalName = "synthetic/test-secret-aB12cD";
const versionId = "a".repeat(32);
const arn = (overrides: { partition?: string; region?: string; account?: string; resource?: string; service?: string; type?: string } = {}) => [
  "arn", overrides.partition ?? "aws", overrides.service ?? "secretsmanager",
  overrides.region ?? region, overrides.account ?? account,
  overrides.type ?? "secret", overrides.resource ?? physicalName,
].join(":");
const reference = (...suffix: string[]) => [arn(), ...suffix].join(":");

function safeError(run: () => unknown, forbidden: string[] = []): string {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  const error = caught as Error;
  expect(error.message.length).toBeGreaterThan(0);
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  for (const value of forbidden) expect(error.message).not.toContain(value);
  return error.message;
}

describe("exact AWS secret references", () => {
  it("preserves the full physical identifier and defaults only to AWSCURRENT", () => {
    const parsed = parseAwsSecretReference(arn(), account);
    expect(parsed).toMatchObject({ secretId: arn(), account, region, versionStage: "AWSCURRENT" });
    expect(parsed.jsonKey).toBeUndefined();
    expect(parsed.versionId).toBeUndefined();
  });

  it("accepts an explicit matching region and empty ECS selector fields", () => {
    const parsed = parseAwsSecretReference(reference("", "", ""), account, region);
    expect(parsed).toMatchObject({ secretId: arn(), account, region, versionStage: "AWSCURRENT" });
    expect(parsed.jsonKey).toBeUndefined();
    expect(parsed.versionId).toBeUndefined();
  });

  it("keeps JSON keys and explicit version stages as separate selectors", () => {
    expect(parseAwsSecretReference(reference("field", "", ""), account)).toMatchObject({
      secretId: arn(), jsonKey: "field", versionStage: "AWSCURRENT",
    });
    expect(parseAwsSecretReference(reference("field", "AWSPREVIOUS", ""), account)).toMatchObject({
      secretId: arn(), jsonKey: "field", versionStage: "AWSPREVIOUS",
    });
    expect(parseAwsSecretReference(reference("", "custom-stage", ""), account)).toMatchObject({
      secretId: arn(), versionStage: "custom-stage",
    });
  });

  it("does not add AWSCURRENT to a version-id selector", () => {
    for (const jsonKey of ["", "field"]) {
      const parsed = parseAwsSecretReference(reference(jsonKey, "", versionId), account);
      expect(parsed.secretId).toBe(arn());
      expect(parsed.versionId).toBe(versionId);
      expect(parsed.versionStage).toBeUndefined();
      expect(parsed.jsonKey).toBe(jsonKey || undefined);
    }
  });

  it.each([
    ["aws", "eu-west-1"], ["aws-cn", "cn-north-1"], ["aws-us-gov", "us-gov-west-1"],
  ])("accepts partition %s with region %s", (partition, awsRegion) => {
    const secretId = arn({ partition, region: awsRegion });
    expect(parseAwsSecretReference(secretId, account, awsRegion)).toMatchObject({
      secretId, account, region: awsRegion, versionStage: "AWSCURRENT",
    });
  });

  it("rejects mismatched expected account or region before resolution", () => {
    safeError(() => parseAwsSecretReference(arn(), "1".repeat(12)), [physicalName]);
    safeError(() => parseAwsSecretReference(arn(), account, "eu-west-1"), [physicalName]);
  });

  it("refuses malformed expected account and region constraints", () => {
    for (const expected of ["", "0".repeat(11), "0".repeat(13), "a".repeat(12), `${account}\n`]) {
      safeError(() => parseAwsSecretReference(arn(), expected));
    }
    for (const expected of ["", "not-a-region", `${region}\n`]) {
      safeError(() => parseAwsSecretReference(arn(), account, expected));
    }
  });

  it("accepts a 512-character base name and refuses a 513-character name", () => {
    const atLimit = arn({ resource: `${"n".repeat(512)}-aB12cD` });
    expect(parseAwsSecretReference(atLimit, account).secretId).toBe(atLimit);
    safeError(() => parseAwsSecretReference(arn({ resource: `${"n".repeat(513)}-aB12cD` }), account));
  });

  it("enforces the complete reference limit without a shorter JSON-key limit", () => {
    const keyLength = 2048 - reference("", "", "").length;
    const key = "k".repeat(keyLength);
    expect(parseAwsSecretReference(reference(key, "", ""), account).jsonKey?.length).toBe(keyLength);
    safeError(() => parseAwsSecretReference(reference(`${key}k`, "", ""), account));
    expect(parseAwsSecretReference(reference("clé.字段", "", ""), account).jsonKey).toBe("clé.字段");
  });

  it("enforces stage and version-id bounds without requiring a UUID", () => {
    const stage = "s".repeat(256);
    expect(parseAwsSecretReference(reference("", stage, ""), account).versionStage).toBe(stage);
    safeError(() => parseAwsSecretReference(reference("", `${stage}s`, ""), account));
    for (const length of [32, 64]) {
      const id = "v".repeat(length);
      const parsed = parseAwsSecretReference(reference("", "", id), account);
      expect(parsed.versionId).toBe(id);
      expect(parsed.versionStage).toBeUndefined();
    }
    for (const length of [1, 31, 65]) {
      safeError(() => parseAwsSecretReference(reference("", "", "v".repeat(length)), account));
    }
  });

  it.each([
    "", "synthetic-name", "/synthetic/path", "https://example.invalid/secret",
    arn({ service: "ssm" }), arn({ type: "parameter" }), arn({ partition: "unsupported" }),
    arn({ resource: "synthetic/partial-name" }), arn({ resource: "synthetic/name-abcde" }),
    arn({ resource: "synthetic/name-abcdefg" }), arn({ resource: "synthetic/name-abcde_" }),
    arn({ resource: "" }), arn({ account: "0".repeat(11) }), arn({ account: "0".repeat(13) }),
    arn({ account: "a".repeat(12) }), arn({ region: "" }), arn({ region: "US-EAST-1" }),
    arn({ region: "not-a-region" }), arn({ region: "us-east-1.example.invalid" }),
    arn({ resource: "synthetic/space name-aB12cD" }), arn({ resource: "synthetic/name%2F-aB12cD" }),
    ` ${arn()}`, `${arn()} `, `${arn()}\n`, `${arn()}\r`, `${arn()}\t`, `${arn()}\0`,
    reference("field"), reference("field", "stage"), reference("field", "", "", "extra"),
    reference("field", "AWSCURRENT", versionId),
  ])("refuses malformed or ambiguous input %#", (input) => {
    safeError(() => parseAwsSecretReference(input, account), [physicalName]);
  });

  it.each([
    ["aws", "cn-north-1"], ["aws", "us-gov-west-1"],
    ["aws-cn", "us-east-1"], ["aws-cn", "us-gov-west-1"],
    ["aws-us-gov", "us-east-1"], ["aws-us-gov", "cn-north-1"],
  ])("refuses inconsistent partition %s and region %s", (partition, awsRegion) => {
    safeError(() => parseAwsSecretReference(arn({ partition, region: awsRegion }), account));
  });

  it("refuses control characters in all selector positions", () => {
    for (const control of ["\0", "\n", "\r", "\t", "\u001f", "\u007f"]) {
      for (const suffix of [[`field${control}`, "", ""], ["", `stage${control}`, ""], ["", "", `${versionId}${control}`]]) {
        safeError(() => parseAwsSecretReference(reference(...suffix), account));
      }
    }
  });

  it("keeps malformed-reference errors constant without source snippets", () => {
    const first = "synthetic-invalid-marker-alpha";
    const second = "synthetic-invalid-marker-beta";
    expect(safeError(() => parseAwsSecretReference(first, account), [first])).toBe(
      safeError(() => parseAwsSecretReference(second, account), [second]),
    );
  });
});

describe("AWS SecretString selection", () => {
  it("returns a plain SecretString without trimming or parsing it", () => {
    for (const value of ["", "synthetic-value", "  synthetic value\n", '{"field":"synthetic"}']) {
      expect(selectAwsSecretString(value)).toBe(value);
    }
  });

  it("selects one exact own JSON string field without coercion", () => {
    expect(selectAwsSecretString(JSON.stringify({ field: "  synthetic value\n", other: "different" }), "field")).toBe("  synthetic value\n");
    expect(selectAwsSecretString(JSON.stringify({ "field.with.dots": "synthetic" }), "field.with.dots")).toBe("synthetic");
    expect(selectAwsSecretString('{"__proto__":"synthetic-own-field"}', "__proto__")).toBe("synthetic-own-field");
    expect(selectAwsSecretString('{"field":""}', "field")).toBe("");
    expect(selectAwsSecretString(JSON.stringify({ "clé.字段": "synthetic" }), "clé.字段")).toBe("synthetic");
  });

  it.each([undefined, null, false, 12, {}, [], ["synthetic"], new Uint8Array([1, 2, 3]), Buffer.from("synthetic-binary")].map((value) => [value]))(
    "refuses a non-string provider response %#", (value) => { safeError(() => selectAwsSecretString(value)); },
  );

  it.each([
    "not-json", "{", "null", "[]", '["synthetic"]', '"synthetic"', "1", "true",
    "{}", '{"other":"synthetic"}', '{"field":null}', '{"field":123}',
    '{"field":true}', '{"field":{}}', '{"field":[]}',
  ])("refuses JSON selection that cannot yield a string %#", (value) => {
    safeError(() => selectAwsSecretString(value, "field"), ["synthetic"]);
  });

  it("refuses inherited properties", () => {
    for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      safeError(() => selectAwsSecretString("{}", key));
    }
  });

  it("refuses NUL in plain text and selected JSON strings", () => {
    safeError(() => selectAwsSecretString("synthetic\0value"), ["synthetic"]);
    safeError(() => selectAwsSecretString(JSON.stringify({ field: "synthetic\0value" }), "field"), ["synthetic"]);
  });

  it("enforces a 65536-byte plain-string bound using UTF-8 bytes", () => {
    expect(selectAwsSecretString("v".repeat(65536)).length).toBe(65536);
    safeError(() => selectAwsSecretString("v".repeat(65537)));
    expect(selectAwsSecretString("é".repeat(32768)).length).toBe(32768);
    safeError(() => selectAwsSecretString("é".repeat(32769)));
  });

  it("enforces the provider-string bound before JSON selection", () => {
    const selected = "v".repeat(65536 - Buffer.byteLength(JSON.stringify({ field: "" }), "utf8"));
    const atLimit = JSON.stringify({ field: selected });
    expect(Buffer.byteLength(atLimit, "utf8")).toBe(65536);
    expect(selectAwsSecretString(atLimit, "field").length).toBe(selected.length);
    safeError(() => selectAwsSecretString(JSON.stringify({ field: `${selected}v` }), "field"));
    safeError(() => selectAwsSecretString(JSON.stringify({ field: "small", other: "é".repeat(32768) }), "field"));
  });

  it("does not expose JSON parser source snippets or causes", () => {
    const first = '{"synthetic-marker-alpha"';
    const second = '{"synthetic-marker-beta"';
    expect(safeError(() => selectAwsSecretString(first, "field"), ["synthetic-marker-alpha"])).toBe(
      safeError(() => selectAwsSecretString(second, "field"), ["synthetic-marker-beta"]),
    );
  });
});
