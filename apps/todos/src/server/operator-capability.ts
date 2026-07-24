/** Stage-A type compatibility only; no runtime issuer or loader is exported. */
export type TodosOperatorOperation = "migrate" | "redact-comments";

declare const operatorCapabilityBrand: unique symbol;

export interface TodosOperatorCapability {
  readonly [operatorCapabilityBrand]: true;
}

export class TodosOperatorCapabilityError extends Error {
  constructor() {
    super("A valid Todos operator capability is required");
    this.name = "TodosOperatorCapabilityError";
  }
}
