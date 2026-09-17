/** Per-server MCP tool discovery registry used by search_tools/describe_tools. */
export interface ToolParamSchema {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  items?: { type: string; enum?: string[] };
}

export interface ToolSchema {
  name?: string;
  description: string;
  category: string;
  params: Record<string, ToolParamSchema>;
  example?: string;
}

export interface ToolEntry {
  name: string;
  description: string;
  category: string;
}

function unwrapZod(value: unknown): { schema: Record<string, unknown>; required: boolean } {
  let schema = value as Record<string, unknown>;
  let required = true;
  const seen = new Set<unknown>();
  while (schema && typeof schema === "object" && !seen.has(schema)) {
    seen.add(schema);
    const def = schema["_def"] as Record<string, unknown> | undefined;
    const typeName = String(def?.["typeName"] ?? schema.constructor?.name ?? "");
    if (/Optional|Default|Nullable/.test(typeName)) required = false;
    const inner = def?.["innerType"] ?? def?.["schema"] ?? def?.["type"];
    if (!inner || typeof inner !== "object") break;
    schema = inner as Record<string, unknown>;
  }
  return { schema, required };
}

function inferParam(value: unknown): ToolParamSchema {
  const original = value as Record<string, unknown>;
  const { schema, required } = unwrapZod(value);
  const def = schema["_def"] as Record<string, unknown> | undefined;
  const typeName = String(def?.["typeName"] ?? schema.constructor?.name ?? "unknown").replace(/^Zod/, "").toLowerCase();
  const values = def?.["values"];
  const description = String(
    original?.["description"] ??
    (original?.["_def"] as Record<string, unknown> | undefined)?.["description"] ??
    def?.["description"] ??
    "",
  );
  const param: ToolParamSchema = {
    type: typeName || "unknown",
    description,
    ...(required ? { required: true } : {}),
  };
  if (Array.isArray(values)) param.enum = values.map(String);
  return param;
}

export class ToolRegistry {
  private readonly registry = new Map<string, ToolSchema>();

  registerToolSchemas(schemas: Record<string, ToolSchema>): void {
    for (const [name, schema] of Object.entries(schemas)) {
      this.registry.set(name, { ...schema, name });
    }
  }

  registerDiscoveredTool(
    name: string,
    description: string,
    category: string,
    inputShape?: Record<string, unknown>,
  ): void {
    const existing = this.registry.get(name);
    if (existing && Object.keys(existing.params).length > 0) return;
    const params = inputShape
      ? Object.fromEntries(Object.entries(inputShape).map(([paramName, value]) => [paramName, inferParam(value)]))
      : {};
    this.registry.set(name, {
      name,
      description: existing?.description || description,
      category: existing?.category || category,
      params: existing?.params && Object.keys(existing.params).length > 0 ? existing.params : params,
      example: existing?.example,
    });
  }

  retain(names: ReadonlySet<string>): void {
    for (const name of this.registry.keys()) {
      if (!names.has(name)) this.registry.delete(name);
    }
  }

  getAllToolEntries(): ToolEntry[] {
    return Array.from(this.registry.entries())
      .map(([name, schema]) => ({ name, description: schema.description, category: schema.category }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getToolSchema(name: string): ToolSchema | undefined {
    return this.registry.get(name);
  }

  searchToolEntries(query: string, category?: string): ToolEntry[] {
    const q = query.trim().toLowerCase();
    return this.getAllToolEntries().filter((entry) => {
      const matchesQuery = entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q);
      return matchesQuery && (!category || entry.category === category);
    });
  }
}
