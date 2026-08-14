export class ConnectorDefinitionError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_CONNECTOR_DEFINITION") {
    super(message);
    this.name = "ConnectorDefinitionError";
    this.code = code;
  }
}

export class ConnectorOperationNotFoundError extends Error {
  readonly connectorName: string;
  readonly operationName: string;

  constructor(connectorName: string, operationName: string) {
    super(`Operation '${operationName}' not found on connector '${connectorName}'`);
    this.name = "ConnectorOperationNotFoundError";
    this.connectorName = connectorName;
    this.operationName = operationName;
  }
}
