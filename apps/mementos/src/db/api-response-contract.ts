/**
 * Strict decoders for hosted 2xx responses.
 *
 * The synchronous HTTP transport only proves that the response was JSON. These
 * helpers prove the small shape each caller relies on so a proxy/server drift
 * can never be converted into an authoritative empty list, zero count, or
 * successful mutation receipt.
 */

export class MementosApiProtocolError extends Error {
  readonly code = "MEMENTOS_API_PROTOCOL";

  constructor(operation: string, detail: string) {
    super(`mementos cloud ${operation} returned a malformed 2xx response: ${detail}`);
    this.name = "MementosApiProtocolError";
  }
}

export type JsonObject = Record<string, unknown>;

export function expectObject(value: unknown, operation: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MementosApiProtocolError(operation, "expected a JSON object");
  }
  return value as JsonObject;
}

export function expectArray(value: unknown, operation: string, field?: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MementosApiProtocolError(
      operation,
      field ? `expected '${field}' to be an array` : "expected a JSON array",
    );
  }
  return value;
}

export function expectString(
  object: JsonObject,
  field: string,
  operation: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = object[field];
  if (typeof value !== "string" || (!options.allowEmpty && value.length === 0)) {
    throw new MementosApiProtocolError(
      operation,
      `expected '${field}' to be ${options.allowEmpty ? "a string" : "a non-empty string"}`,
    );
  }
  return value;
}

export function expectNullableString(
  object: JsonObject,
  field: string,
  operation: string,
): string | null {
  const value = object[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new MementosApiProtocolError(operation, `expected '${field}' to be a string or null`);
  }
  return value.length === 0 ? null : value;
}

export function expectBoolean(object: JsonObject, field: string, operation: string): boolean {
  const value = object[field];
  if (typeof value !== "boolean") {
    throw new MementosApiProtocolError(operation, `expected '${field}' to be a boolean`);
  }
  return value;
}

export function expectNonNegativeInteger(
  object: JsonObject,
  field: string,
  operation: string,
): number {
  const value = object[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MementosApiProtocolError(
      operation,
      `expected '${field}' to be a non-negative safe integer`,
    );
  }
  return value as number;
}

export function expectRecord(
  object: JsonObject,
  field: string,
  operation: string,
): JsonObject {
  try {
    return expectObject(object[field], operation);
  } catch (error) {
    if (error instanceof MementosApiProtocolError) {
      throw new MementosApiProtocolError(operation, `expected '${field}' to be a JSON object`);
    }
    throw error;
  }
}
