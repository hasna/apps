import Ajv, {
  type AnySchemaObject,
  type ValidateFunction,
} from "ajv";
import addFormats from "ajv-formats";
import type {
  TodosAiJsonObject,
  TodosAiJsonValue,
} from "@hasna/todos";
import { TodosAiSchemaError } from "./types";

export type TodosAiStructuredDataValidator = (
  value: TodosAiJsonValue,
) => void;

export function compileTodosAiOutputSchema(
  schema: TodosAiJsonObject,
): TodosAiStructuredDataValidator {
  if (schema["$async"] === true) {
    throw new TodosAiSchemaError();
  }

  const ajv = new Ajv({
    allErrors: false,
    allowUnionTypes: true,
    coerceTypes: false,
    removeAdditional: false,
    strict: true,
    useDefaults: false,
  });
  addFormats(ajv);

  let validate: ValidateFunction<TodosAiJsonValue>;
  try {
    validate = ajv.compile<TodosAiJsonValue>(
      schema as AnySchemaObject,
    ) as ValidateFunction<TodosAiJsonValue>;
  } catch (error) {
    throw new TodosAiSchemaError({ cause: error });
  }

  return (value) => {
    let valid: boolean;
    try {
      valid = validate(value);
    } catch (error) {
      throw new TodosAiSchemaError({ cause: error });
    }
    if (!valid) {
      throw new TodosAiSchemaError();
    }
  };
}
