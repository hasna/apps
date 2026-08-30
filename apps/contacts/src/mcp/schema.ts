import { z, type ZodTypeAny } from "zod";

type JsonScalar = string | number | boolean;
type JsonSchema = {
  description?: string;
  enum?: readonly JsonScalar[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  type?: "array" | "boolean" | "number" | "object" | "string";
};

function describeSchema<T extends ZodTypeAny>(schema: T, description?: string): T {
  return description ? (schema.describe(description) as T) : schema;
}

function enumToZod(values: readonly JsonScalar[]): ZodTypeAny {
  if (values.length === 0) {
    return z.never();
  }

  if (values.length === 1) {
    return z.literal(values[0]);
  }

  const [first, second, ...rest] = values;
  return z.union([z.literal(first), z.literal(second), ...rest.map((value) => z.literal(value))]);
}

function jsonSchemaToZodType(schema?: JsonSchema): ZodTypeAny {
  if (!schema) {
    return z.unknown();
  }

  let zodSchema: ZodTypeAny;

  if (schema.enum?.length) {
    zodSchema = enumToZod(schema.enum);
  } else {
    switch (schema.type) {
      case "array":
        zodSchema = z.array(jsonSchemaToZodType(schema.items));
        break;
      case "boolean":
        zodSchema = z.boolean();
        break;
      case "number":
        zodSchema = z.number();
        break;
      case "object":
        zodSchema = jsonSchemaToZodObject(schema);
        break;
      case "string":
        zodSchema = z.string();
        break;
      default:
        zodSchema = z.unknown();
        break;
    }
  }

  return describeSchema(zodSchema, schema.description);
}

export function jsonSchemaToZodObject(schema: unknown) {
  const objectSchema = (schema && typeof schema === "object" ? schema : {}) as JsonSchema;
  const required = new Set(objectSchema.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, value] of Object.entries(objectSchema.properties ?? {})) {
    const propertySchema = jsonSchemaToZodType(value);
    shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
  }

  return describeSchema(z.object(shape).passthrough(), objectSchema.description);
}
