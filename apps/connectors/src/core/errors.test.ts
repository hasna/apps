import { describe, test, expect } from "bun:test";
import {
  ConnectorDefinitionError,
  ConnectorOperationNotFoundError,
} from "./errors.js";

describe("ConnectorDefinitionError", () => {
  test("uses default code and name", () => {
    const error = new ConnectorDefinitionError("invalid connector");
    expect(error.message).toBe("invalid connector");
    expect(error.name).toBe("ConnectorDefinitionError");
    expect(error.code).toBe("INVALID_CONNECTOR_DEFINITION");
  });

  test("accepts custom code", () => {
    const error = new ConnectorDefinitionError("duplicate operation", "DUPLICATE_OPERATION");
    expect(error.code).toBe("DUPLICATE_OPERATION");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("ConnectorOperationNotFoundError", () => {
  test("captures connector and operation names", () => {
    const error = new ConnectorOperationNotFoundError("stripe", "charges:list");
    expect(error.message).toBe("Operation 'charges:list' not found on connector 'stripe'");
    expect(error.name).toBe("ConnectorOperationNotFoundError");
    expect(error.connectorName).toBe("stripe");
    expect(error.operationName).toBe("charges:list");
  });
});
