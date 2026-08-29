/**
 * Generator for the context HTTP client SDK.
 *
 * The `package-sdk` surface of hasna.contract.json declares
 * `generatedFrom: /openapi.json`, so the claim must be true: this module
 * generates a typed HTTP client (src/sdk/generated-client.ts) directly from
 * the OpenAPI 3.1 document served by context-serve (src/server/openapi.ts).
 * The document is built from a route table that mirrors the server handlers,
 * so the client can invoke every route the contract declares.
 *
 * Run `bun run openapi:generate` (scripts/openapi-generate.ts) after any
 * change to the route table; src/sdk/generated-client.test.ts fails when the
 * committed generated client is stale.
 *
 * The client's default base URL is derived from the server's own defaults
 * (DEFAULT_HOST / DEFAULT_PORT in src/server/index.ts), so a default
 * `new ContextClient()` reaches a default `context-serve` instance.
 */

import { DEFAULT_HOST, DEFAULT_PORT } from "../server/index.js";

interface OpenApiDoc {
  paths: Record<string, Record<string, { operationId: string; summary: string }>>;
}

const DEFAULT_BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

const HEADER = `// DO NOT EDIT — generated from the context-serve OpenAPI document.
// Regenerate with: bun run openapi:generate
// Source of truth: src/server/openapi.ts (route table) -> buildOpenApiDocument().`;

/**
 * Emit the TypeScript source of the generated HTTP client for the given
 * OpenAPI document.
 */
export function generateClientSource(doc: OpenApiDoc): string {
  const lines: string[] = [
    HEADER,
    "",
    "/** Typed HTTP client for the context-serve API (generated). */",
    "export class ContextClient {",
    "  private readonly baseUrl: string;",
    "  private readonly token?: string;",
    "",
    "  constructor(options: { baseUrl?: string; token?: string } = {}) {",
    `    this.baseUrl = (options.baseUrl ?? ${JSON.stringify(DEFAULT_BASE_URL)}).replace(/\\/$/, "");`,
    "    this.token = options.token;",
    "  }",
    "",
    "  private async request(method: string, path: string, query?: Record<string, unknown>, body?: unknown): Promise<unknown> {",
    "    const url = new URL(this.baseUrl + path);",
    "    if (query) {",
    "      for (const [key, value] of Object.entries(query)) {",
    "        if (value !== undefined && value !== null && value !== \"\") url.searchParams.set(key, String(value));",
    "      }",
    "    }",
    "    const headers: Record<string, string> = { \"content-type\": \"application/json\" };",
    "    if (this.token) headers.authorization = `Bearer ${this.token}`;",
    "    const res = await fetch(url, {",
    "      method,",
    "      headers,",
    "      body: body === undefined ? undefined : JSON.stringify(body),",
    "    });",
    "    const text = await res.text();",
    "    if (!res.ok) {",
    "      let message = `HTTP ${res.status} ${method} ${path}`;",
    "      try {",
    "        const parsed = JSON.parse(text) as { error?: string };",
    "        if (parsed.error) message += `: ${parsed.error}`;",
    "      } catch {",
    "        if (text) message += `: ${text}`;",
    "      }",
    "      throw new Error(message);",
    "    }",
    "    return text ? (JSON.parse(text) as unknown) : undefined;",
    "  }",
    "",
  ];

  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(operations)) {
      const { operationId } = op;
      const methodName = operationId;
      const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
      const isGet = method === "get";
      const isDelete = method === "delete";

      const args: string[] = [];
      const queryArg = isGet ? "params" : undefined;
      if (pathParams.length > 0) {
        args.push(`${pathParams.map((p) => `${p}: string | number`).join(", ")}`);
      }
      if (queryArg) args.push(`params?: Record<string, string | number | boolean | undefined>`);
      else if (!isGet && !isDelete) args.push(`body?: unknown`);

      let urlExpr = `\`${path.replace(/\{([^}]+)\}/g, "${encodeURIComponent(String($1))}")}\``;
      if (pathParams.length === 0) urlExpr = `"${path}"`;
      const queryExpr = isGet ? `, params` : "";
      const bodyExpr = !isGet && !isDelete ? `, body` : "";
      // The request signature is (method, path, query?, body?) — a body must
      // occupy the fourth slot, so non-GET calls without a query argument
      // pass an explicit undefined for the query slot.
      const explicitQuery = !isGet && !isDelete ? `, undefined` : "";

      lines.push(`  /** ${op.summary ?? path} */`);
      lines.push(
        `  async ${methodName}(${args.join(", ")}): Promise<unknown> {`,
      );
      lines.push(`    return this.request("${method.toUpperCase()}", ${urlExpr}${queryExpr}${explicitQuery}${bodyExpr});`);
      lines.push("  }");
      lines.push("");
    }
  }

  lines.push("}");
  return lines.join("\n");
}
