import { readFileSync } from "fs";
import type { CreateScenarioInput, ScenarioPriority } from "../types/index.js";
import { createScenario } from "../db/scenarios.js";

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string };
  paths?: Record<string, Record<string, PathItem>>;
  security?: Array<Record<string, string[]>>;
}

interface PathItem {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: { type?: string } }>;
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, { description?: string }>;
}

function parseSpec(content: string): OpenAPISpec {
  // Try JSON first, then YAML-like parsing
  try {
    return JSON.parse(content);
  } catch {
    // Simple YAML-ish parsing for basic cases
    // For real YAML, users should convert to JSON first
    throw new Error("Only JSON specs are supported. Convert YAML to JSON first: `cat spec.yaml | python -c 'import sys,yaml,json; json.dump(yaml.safe_load(sys.stdin),sys.stdout)' > spec.json`");
  }
}

function methodPriority(method: string): ScenarioPriority {
  switch (method.toUpperCase()) {
    case "GET": return "medium";
    case "POST": return "high";
    case "PUT": return "high";
    case "DELETE": return "critical";
    case "PATCH": return "medium";
    default: return "low";
  }
}

export function parseOpenAPISpec(filePathOrUrl: string): CreateScenarioInput[] {
  let content: string;

  if (filePathOrUrl.startsWith("http")) {
    throw new Error("URL fetching not supported yet. Download the spec file first.");
  }

  content = readFileSync(filePathOrUrl, "utf-8");
  const spec = parseSpec(content);

  const isOpenAPI3 = !!spec.openapi;
  const isSwagger2 = !!spec.swagger;

  if (!isOpenAPI3 && !isSwagger2) {
    throw new Error("Not a valid OpenAPI 3.x or Swagger 2.0 spec");
  }

  const scenarios: CreateScenarioInput[] = [];
  const paths = spec.paths ?? {};

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (["get", "post", "put", "delete", "patch"].indexOf(method.toLowerCase()) === -1) continue;

      const op = operation as PathItem;
      const name = op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`;
      const tags = op.tags ?? [];
      const requiresAuth = !!(op.security?.length ?? spec.security?.length);

      // Build steps
      const steps: string[] = [];
      steps.push(`Navigate to the API endpoint: ${method.toUpperCase()} ${path}`);

      if (op.parameters?.length) {
        const required = op.parameters.filter((p) => p.required);
        if (required.length > 0) {
          steps.push(`Fill required parameters: ${required.map((p) => p.name).join(", ")}`);
        }
      }

      if (["post", "put", "patch"].includes(method.toLowerCase())) {
        steps.push("Fill the request body with valid test data");
      }

      steps.push("Submit the request");

      const responses = op.responses ?? {};
      const successCodes = Object.keys(responses).filter((c) => c.startsWith("2"));
      if (successCodes.length > 0) {
        steps.push(`Verify response status is ${successCodes.join(" or ")}`);
      } else {
        steps.push("Verify the response is successful");
      }

      const description = [
        op.description ?? `Test the ${method.toUpperCase()} ${path} endpoint.`,
        requiresAuth ? "This endpoint requires authentication." : "",
      ].filter(Boolean).join(" ");

      scenarios.push({
        name,
        description,
        steps,
        tags: [...tags, "api", method.toLowerCase()],
        priority: methodPriority(method),
        targetPath: path,
        requiresAuth,
      });
    }
  }

  return scenarios;
}

export function importFromOpenAPI(
  filePathOrUrl: string,
  projectId?: string,
): { imported: number; scenarios: ReturnType<typeof createScenario>[] } {
  const inputs = parseOpenAPISpec(filePathOrUrl);
  const scenarios = inputs.map((input) =>
    createScenario({ ...input, projectId })
  );
  return { imported: scenarios.length, scenarios };
}
