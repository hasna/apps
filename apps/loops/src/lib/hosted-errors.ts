export class HostedResponseShapeError extends Error {
  readonly code = "HOSTED_RESPONSE_MALFORMED";
  constructor(expectation: string, legacyArrayKey = false) {
    super(
      legacyArrayKey
        ? `hosted Loops API response is malformed: expected '${expectation}' to be an array`
        : `hosted Loops API response is malformed: expected ${expectation}`,
    );
    this.name = "HostedResponseShapeError";
  }
}
