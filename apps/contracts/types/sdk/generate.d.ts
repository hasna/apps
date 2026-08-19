export interface OpenApiDocument {
    openapi?: string;
    info?: {
        title?: string;
        version?: string;
    };
    paths?: Record<string, PathItem>;
    components?: {
        schemas?: Record<string, JsonSchema>;
    };
}
type PathItem = Record<string, Operation | unknown>;
interface Operation {
    operationId?: string;
    summary?: string;
    description?: string;
    parameters?: Parameter[];
    requestBody?: RequestBody;
    responses?: Record<string, ResponseObject>;
}
interface Parameter {
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required?: boolean;
    schema?: JsonSchema;
}
interface RequestBody {
    required?: boolean;
    content?: Record<string, {
        schema?: JsonSchema;
    }>;
}
interface ResponseObject {
    content?: Record<string, {
        schema?: JsonSchema;
    }>;
}
export interface JsonSchema {
    $ref?: string;
    type?: string | string[];
    format?: string;
    enum?: unknown[];
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean | JsonSchema;
    allOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    nullable?: boolean;
    description?: string;
}
declare const HTTP_METHODS: readonly ["get", "put", "post", "delete", "patch", "options", "head"];
type HttpMethod = (typeof HTTP_METHODS)[number];
export interface GenerateSdkOptions {
    /** Exported client class name. Default derived from `info.title` or `ApiClient`. */
    className?: string;
    /** Header used to send the API key. Default `x-api-key`. */
    apiKeyHeader?: string;
}
export interface GeneratedOperation {
    method: HttpMethod;
    path: string;
    operationId: string;
    functionName: string;
}
export interface GeneratedSdk {
    code: string;
    operations: GeneratedOperation[];
    warnings: string[];
}
/** Generate a typed fetch client + interfaces from an OpenAPI 3 document. */
export declare function generateSdkFromOpenApi(spec: OpenApiDocument, options?: GenerateSdkOptions): GeneratedSdk;
export {};
