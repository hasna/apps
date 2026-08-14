/**
 * Error thrown when a normalized social operation is not supported by a given
 * connector / network (e.g. Bluesky does not expose post analytics).
 */
export class ConnectorOperationNotSupported extends Error {
  public readonly connector: string;
  public readonly operation: string;

  constructor(connector: string, operation: string) {
    super(`Connector "${connector}" does not support operation "${operation}"`);
    this.name = "ConnectorOperationNotSupported";
    this.connector = connector;
    this.operation = operation;
  }
}
