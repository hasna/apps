/** Exact native references are metadata, never a secret-name lookup heuristic. */
export interface AwsSecretReference {
  secretId: string;
  account: string;
  region: string;
  jsonKey?: string;
  versionStage?: string;
  versionId?: string;
}

export class AwsSecretReferenceError extends Error {
  constructor(readonly code: "AWS_SECRET_REFERENCE_INVALID" | "AWS_SECRET_REFERENCE_VALUE_INVALID" | "AWS_SECRET_REFERENCE_READ_FAILED") {
    super(code);
    this.name = "AwsSecretReferenceError";
  }
}

function invalidReference(): never {
  throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_INVALID");
}

/** A complete ARN, optionally followed by the three ECS selector fields. */
export function parseAwsSecretReference(
  reference: string,
  expectedAccount: string,
  expectedRegion?: string,
): AwsSecretReference {
  if (typeof reference !== "string" || reference.length > 2048 ||
      reference !== reference.trim() || /[\u0000-\u001f\u007f]/u.test(reference) ||
      typeof expectedAccount !== "string" || !/^\d{12}$/.test(expectedAccount)) invalidReference();

  const parts = reference.split(":");
  if (parts.length !== 7 && parts.length !== 10) invalidReference();
  const [prefix, partition, service, region, account, resourceType, physicalName] = parts;
  if (prefix !== "arn" || !["aws", "aws-cn", "aws-us-gov"].includes(partition!) ||
      service !== "secretsmanager" || resourceType !== "secret" ||
      account !== expectedAccount || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region!) ||
      (expectedRegion !== undefined && expectedRegion !== region) ||
      (region!.startsWith("cn-") !== (partition === "aws-cn")) ||
      (region!.startsWith("us-gov-") !== (partition === "aws-us-gov")) ||
      !/^[A-Za-z0-9/_+=.@!-]{1,512}-[A-Za-z0-9]{6}$/.test(physicalName!)) invalidReference();

  const [, , , , , , , jsonKey, stage, versionId] = parts;
  if ((stage && versionId) || (stage && stage.length > 256) ||
      (versionId && (versionId.length < 32 || versionId.length > 64))) invalidReference();
  return {
    secretId: parts.slice(0, 7).join(":"),
    account: account!,
    region: region!,
    ...(jsonKey ? { jsonKey } : {}),
    ...(versionId ? { versionId } : { versionStage: stage || "AWSCURRENT" }),
  };
}

/** Only strings may cross the child-environment boundary; never expose parse errors. */
export function selectAwsSecretString(value: unknown, jsonKey?: string): string {
  const invalid = (): never => { throw new AwsSecretReferenceError("AWS_SECRET_REFERENCE_VALUE_INVALID"); };
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 65536 || value.includes("\0")) invalid();
  if (jsonKey === undefined) return value as string;
  let parsed: unknown;
  try { parsed = JSON.parse(value as string); } catch { return invalid(); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
      !Object.prototype.hasOwnProperty.call(parsed, jsonKey)) invalid();
  const selected = (parsed as Record<string, unknown>)[jsonKey];
  if (typeof selected !== "string" || selected.includes("\0")) invalid();
  return selected as string;
}
