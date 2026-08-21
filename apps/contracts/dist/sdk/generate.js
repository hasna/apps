// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/sdk/generate.ts
var HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head"];
function refName(ref) {
  const parts = ref.split("/");
  return sanitizeTypeName(parts[parts.length - 1] ?? "Unknown");
}
function sanitizeTypeName(name) {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(cleaned) ? cleaned : `T_${cleaned}`;
  return prefixed.charAt(0).toUpperCase() + prefixed.slice(1);
}
function camelCase(input) {
  const parts = input.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0)
    return "op";
  const head = parts[0].charAt(0).toLowerCase() + parts[0].slice(1);
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const name = [head, ...rest].join("");
  return /^[A-Za-z_]/.test(name) ? name : `op${name}`;
}

class TypeEmitter {
  warnings = [];
  tsType(schema) {
    if (!schema)
      return "unknown";
    if (schema.$ref)
      return refName(schema.$ref);
    if (schema.allOf && schema.allOf.length > 0) {
      return schema.allOf.map((s) => this.tsType(s)).join(" & ");
    }
    if (schema.oneOf && schema.oneOf.length > 0) {
      return schema.oneOf.map((s) => this.tsType(s)).join(" | ");
    }
    if (schema.anyOf && schema.anyOf.length > 0) {
      return schema.anyOf.map((s) => this.tsType(s)).join(" | ");
    }
    if (schema.enum && schema.enum.length > 0) {
      return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
    }
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    let base;
    switch (type) {
      case "string":
        base = "string";
        break;
      case "integer":
      case "number":
        base = "number";
        break;
      case "boolean":
        base = "boolean";
        break;
      case "null":
        base = "null";
        break;
      case "array":
        base = `Array<${this.tsType(schema.items)}>`;
        break;
      case "object":
        base = this.objectType(schema);
        break;
      default:
        if (schema.properties) {
          base = this.objectType(schema);
        } else {
          base = "unknown";
        }
    }
    if (schema.nullable)
      base = `${base} | null`;
    return base;
  }
  objectType(schema) {
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const entries = Object.entries(props).map(([key, value]) => {
      const optional = required.has(key) ? "" : "?";
      return `${JSON.stringify(key)}${optional}: ${this.tsType(value)}`;
    });
    if (entries.length === 0) {
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `Record<string, ${this.tsType(schema.additionalProperties)}>`;
      }
      return "Record<string, unknown>";
    }
    let body = `{ ${entries.join("; ")} }`;
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      body = `${body} & Record<string, ${this.tsType(schema.additionalProperties)}>`;
    }
    return body;
  }
  interfaceFor(name, schema) {
    const typeName = sanitizeTypeName(name);
    if (schema.type === "object" || schema.properties) {
      return `export interface ${typeName} ${this.objectType(schema)}
`;
    }
    return `export type ${typeName} = ${this.tsType(schema)};
`;
  }
}
function pickResponseSchema(op) {
  const responses = op.responses ?? {};
  const order = ["200", "201", "202", "2XX", "default"];
  for (const code of order) {
    const res = responses[code];
    const schema = res?.content?.["application/json"]?.schema;
    if (schema)
      return schema;
  }
  for (const code of Object.keys(responses)) {
    if (code.startsWith("2")) {
      const schema = responses[code]?.content?.["application/json"]?.schema;
      if (schema)
        return schema;
    }
  }
  return;
}
function requestBodySchema(op) {
  return op.requestBody?.content?.["application/json"]?.schema;
}
function isOperation(value) {
  return typeof value === "object" && value !== null;
}
function generateSdkFromOpenApi(spec, options = {}) {
  if (!spec || typeof spec !== "object") {
    throw new Error("generateSdkFromOpenApi requires an OpenAPI document object.");
  }
  const emitter = new TypeEmitter;
  const apiKeyHeader = options.apiKeyHeader ?? "x-api-key";
  const className = sanitizeTypeName(options.className ?? spec.info?.title ?? "ApiClient");
  const schemas = spec.components?.schemas ?? {};
  const typeLines = [];
  for (const [name, schema] of Object.entries(schemas)) {
    typeLines.push(emitter.interfaceFor(name, schema));
  }
  const operations = [];
  const methodLines = [];
  const usedNames = new Set;
  const paths = spec.paths ?? {};
  for (const rawPath of Object.keys(paths).sort()) {
    const pathItem = paths[rawPath];
    if (!pathItem || typeof pathItem !== "object")
      continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isOperation(op))
        continue;
      const derived = op.operationId ?? `${method}_${rawPath}`;
      let fnName = camelCase(derived);
      while (usedNames.has(fnName))
        fnName = `${fnName}_`;
      usedNames.add(fnName);
      const params = op.parameters ?? [];
      const pathParams = params.filter((p) => p.in === "path");
      const queryParams = params.filter((p) => p.in === "query");
      const bodySchema = requestBodySchema(op);
      const responseSchema = pickResponseSchema(op);
      const returnType = responseSchema ? emitter.tsType(responseSchema) : "void";
      const args = [];
      for (const p of pathParams) {
        args.push(`${camelCase(p.name)}: ${emitter.tsType(p.schema) || "string"}`);
      }
      if (bodySchema) {
        const bodyRequired = op.requestBody?.required !== false;
        args.push(`body${bodyRequired ? "" : "?"}: ${emitter.tsType(bodySchema)}`);
      }
      if (queryParams.length > 0) {
        const queryType = queryParams.map((p) => `${JSON.stringify(p.name)}${p.required ? "" : "?"}: ${emitter.tsType(p.schema) || "string | number | boolean"}`).join("; ");
        args.push(`query?: { ${queryType} }`);
      }
      args.push("init?: RequestInit");
      let pathExpr = "`" + rawPath.replace(/\{([^}]+)\}/g, (_m, name) => "${encodeURIComponent(String(" + camelCase(name) + "))}") + "`";
      const hasBody = Boolean(bodySchema);
      const hasQuery = queryParams.length > 0;
      const doc = op.summary || op.description ? `    /** ${(op.summary ?? op.description ?? "").replace(/\*\//g, "*\\/")} */
` : "";
      methodLines.push(`${doc}    async ${fnName}(${args.join(", ")}): Promise<${returnType}> {
` + `      return this.request(${JSON.stringify(method.toUpperCase())}, ${pathExpr}, {
` + `        ${hasBody ? "body," : "body: undefined,"}
` + `        ${hasQuery ? "query," : "query: undefined,"}
` + `        init,
` + `      });
` + `    }`);
      operations.push({ method, path: rawPath, operationId: derived, functionName: fnName });
    }
  }
  const header = `// @generated from OpenAPI by @hasna/contracts SDK generator \u2014 DO NOT EDIT.
` + `// Source: ${spec.info?.title ?? "service"} ${spec.info?.version ?? ""}

`;
  const runtime = `export interface ${className}Options {
` + `  /** Base URL, e.g. process.env.APP_API_URL. */
` + `  baseUrl: string;
` + `  /** API key, e.g. process.env.APP_API_KEY. Sent as the '${apiKeyHeader}' header. */
` + `  apiKey?: string;
` + `  /** Custom fetch (defaults to global fetch). */
` + `  fetch?: typeof fetch;
` + `  /** Extra headers merged into every request. */
` + `  headers?: Record<string, string>;
` + `}

` + `export class ApiError extends Error {
` + `  constructor(readonly status: number, message: string, readonly body: unknown) {
` + `    super(message);
` + `    this.name = "ApiError";
` + `  }
` + `}

` + `export class ${className} {
` + `  private readonly baseUrl: string;
` + `  private readonly apiKey: string | undefined;
` + `  private readonly fetchImpl: typeof fetch;
` + `  private readonly baseHeaders: Record<string, string>;

` + `  constructor(options: ${className}Options) {
` + `    if (!options.baseUrl) throw new Error("${className} requires a baseUrl.");
` + `    this.baseUrl = options.baseUrl.replace(/\\/$/, "");
` + `    this.apiKey = options.apiKey;
` + `    this.fetchImpl = options.fetch ?? globalThis.fetch;
` + `    this.baseHeaders = options.headers ?? {};
` + `  }

` + `  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
` + `    const url = new URL(this.baseUrl + path);
` + `    if (opts.query) {
` + `      for (const [key, value] of Object.entries(opts.query)) {
` + `        if (value === undefined || value === null) continue;
` + `        if (Array.isArray(value)) {
` + `          for (const item of value) {
` + `            if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
` + `          }
` + `        } else {
` + `          url.searchParams.set(key, String(value));
` + `        }
` + `      }
` + `    }
` + `    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
` + `    if (this.apiKey) headers[${JSON.stringify(apiKeyHeader)}] = this.apiKey;
` + `    let payload: BodyInit | undefined;
` + `    if (opts.body !== undefined) {
` + `      headers["Content-Type"] = "application/json";
` + `      payload = JSON.stringify(opts.body);
` + `    }
` + `    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
` + `    const text = await response.text();
` + `    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
` + `    if (!response.ok) {
` + `      throw new ApiError(response.status, \`\${method} \${path} failed: \${response.status}\`, data);
` + `    }
` + `    return data as T;
` + `  }

` + methodLines.join(`

`) + `
}
`;
  const code = header + (typeLines.length > 0 ? typeLines.join(`
`) + `
` : "") + runtime;
  return { code, operations, warnings: emitter.warnings };
}
export {
  generateSdkFromOpenApi
};
