import type {
  AgentsJsonDocument,
  FlowDefinition,
  FlowInvokeResult,
  HttpMethod,
  OpenApiDocument,
  OpenApiOperation,
  ProviderAuthConfig,
  WildcardConfig,
} from '../types';
import {
  getByPath,
  optionalRecord,
  optionalString,
  parseJsonObject,
  requireString,
  setByPath,
} from '../utils/args';
import { normalizeBaseUrl, validateHttpsUrl } from '../utils/url';

const CONNECTOR = 'Wildcard';

async function fetchJsonUrl(url: string, label: string): Promise<Record<string, unknown>> {
  const safeUrl = validateHttpsUrl(url, label);
  const res = await fetch(safeUrl, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${CONNECTOR}: ${label} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return parseJsonObject(text, label);
}

export async function loadAgentsJson(args: Record<string, unknown>): Promise<AgentsJsonDocument> {
  const inline = optionalRecord(args.agentsJson ?? args.agents_json, 'agentsJson');
  const data = inline ?? await fetchJsonUrl(
    requireString(args.agents_json_url ?? args.agentsJsonUrl, 'agents_json_url'),
    'agents_json_url',
  );
  if (!Array.isArray(data.flows)) {
    throw new Error(`${CONNECTOR}: agentsJson must include a flows array`);
  }
  return data as AgentsJsonDocument;
}

export function findFlow(agentsJson: AgentsJsonDocument, args: Record<string, unknown>): FlowDefinition {
  const flowId = requireString(args.flow_id ?? args.flowId, 'flow_id');
  const flow = agentsJson.flows?.find((entry) => entry.id === flowId);
  if (!flow) throw new Error(`${CONNECTOR}: flow ${flowId} was not found`);
  return flow;
}

export function flowToOpenAiTool(flow: FlowDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (flow.fields?.parameters?.length) {
    properties.parameters = {
      type: 'object',
      properties: Object.fromEntries(flow.fields.parameters.map((field) => [
        field.name,
        {
          type: field.type ?? 'string',
          description: field.description ?? '',
        },
      ])),
      required: flow.fields.parameters.filter((field) => field.required).map((field) => field.name),
    };
    required.push('parameters');
  }
  const content = flow.fields?.requestBody?.content;
  if (content) {
    const contentType = content['application/json'] ? 'application/json' : Object.keys(content)[0];
    const bodySchema = contentType ? content[contentType]?.schema ?? content[contentType]?.schema_ : undefined;
    properties.requestBody = bodySchema ?? { type: 'object' };
    if (flow.fields?.requestBody?.required) required.push('requestBody');
  }
  return {
    type: 'function',
    function: {
      name: flow.id,
      description: flow.description ?? flow.title ?? flow.id,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  };
}

export function flowPrompt(agentsJson: AgentsJsonDocument): string {
  return (agentsJson.flows ?? [])
    .map((flow) => `${flow.id}: ${flow.description ?? flow.title ?? ''}`.trim())
    .join('\n');
}

function sourceById(agentsJson: AgentsJsonDocument, sourceId: string): { id: string; path: string } {
  const source = agentsJson.sources?.find((entry) => entry.id === sourceId);
  if (!source) throw new Error(`${CONNECTOR}: source ${sourceId} was not found`);
  return source;
}

async function loadOpenApi(source: { id: string; path: string }): Promise<OpenApiDocument> {
  const doc = await fetchJsonUrl(source.path, `source ${source.id}`);
  if (!doc.paths || typeof doc.paths !== 'object') {
    throw new Error(`${CONNECTOR}: source ${source.id} must be an OpenAPI JSON document with paths`);
  }
  return doc as OpenApiDocument;
}

function findOperation(
  openApi: OpenApiDocument,
  operationId: string,
): { path: string; method: HttpMethod; operation: OpenApiOperation } {
  for (const [path, methods] of Object.entries(openApi.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation?.operationId === operationId) {
        return { path, method: method.toUpperCase() as HttpMethod, operation };
      }
    }
  }
  throw new Error(`${CONNECTOR}: operation ${operationId} was not found in source OpenAPI document`);
}

function applyProviderAuth(
  sourceId: string,
  url: URL,
  headers: Headers,
  authConfigs: Record<string, ProviderAuthConfig>,
): void {
  const auth = authConfigs[sourceId];
  if (!auth || auth.type === 'none') return;
  if (auth.type === 'bearer') {
    headers.set('Authorization', `Bearer ${requireString(auth.token, `provider_auth_json.${sourceId}.token`)}`);
    return;
  }
  if (auth.type === 'apiKey') {
    const value = requireString(auth.key_value, `provider_auth_json.${sourceId}.key_value`);
    const formatted = auth.key_prefix ? `${auth.key_prefix} ${value}` : value;
    if (auth.in === 'query') {
      url.searchParams.set(auth.key_name ?? 'api_key', formatted);
    } else {
      headers.set(auth.key_name ?? 'X-API-Key', formatted);
    }
    return;
  }
  if (auth.type === 'basic') {
    const credentials = auth.credentials;
    if (typeof credentials === 'string') {
      headers.set('Authorization', `Basic ${credentials}`);
      return;
    }
    const username = requireString(credentials?.username, `provider_auth_json.${sourceId}.credentials.username`);
    const password = requireString(credentials?.password, `provider_auth_json.${sourceId}.credentials.password`);
    headers.set('Authorization', `Basic ${btoa(`${username}:${password}`)}`);
  }
}

export async function executeFlow(
  config: WildcardConfig,
  agentsJson: AgentsJsonDocument,
  flow: FlowDefinition,
  args: Record<string, unknown>,
): Promise<FlowInvokeResult> {
  if (!flow.actions?.length) throw new Error(`${CONNECTOR}: flow ${flow.id} has no actions`);

  const parameters = optionalRecord(args.parameters, 'parameters') ?? {};
  const requestBody = optionalRecord(args.requestBody ?? args.request_body, 'requestBody') ?? {};
  const sourceBaseUrls = optionalRecord(args.source_base_urls ?? args.sourceBaseUrls, 'source_base_urls') ?? {};
  const argProviderAuth = optionalRecord(args.provider_auth ?? args.providerAuth, 'provider_auth') as
    | Record<string, ProviderAuthConfig>
    | undefined;
  const providerAuth = argProviderAuth ?? config.providerAuthJson ?? {};

  const trace: Record<string, unknown> = {
    [flow.id]: { parameters, requestBody, responses: {} },
  };
  const openApiBySource = new Map<string, OpenApiDocument>();
  const actions: FlowInvokeResult['actions'] = [];

  for (const action of flow.actions) {
    const source = sourceById(agentsJson, action.sourceId);
    const openApi = openApiBySource.get(source.id) ?? await loadOpenApi(source);
    openApiBySource.set(source.id, openApi);
    const operation = findOperation(openApi, action.operationId);

    const actionInput: Record<string, unknown> = { parameters: {}, requestBody: {} };
    for (const link of flow.links ?? []) {
      if (link.target.actionId !== action.id) continue;
      const originId = link.origin.actionId ?? flow.id;
      const originTrace = trace[originId];
      setByPath(actionInput, link.target.fieldPath, getByPath(originTrace, link.origin.fieldPath));
    }
    if (!Object.keys(actionInput.parameters as Record<string, unknown>).length && actions.length === 0) {
      actionInput.parameters = parameters;
    }
    if (!Object.keys(actionInput.requestBody as Record<string, unknown>).length && actions.length === 0) {
      actionInput.requestBody = requestBody;
    }

    const actionParameters = actionInput.parameters as Record<string, unknown>;
    const actionBody = actionInput.requestBody as Record<string, unknown>;
    const baseUrl = optionalString(sourceBaseUrls[source.id], `source_base_urls.${source.id}`)
      ?? openApi.servers?.find((server) => server.url)?.url
      ?? '';
    if (!baseUrl) {
      throw new Error(`${CONNECTOR}: source ${source.id} has no server URL; pass source_base_urls.${source.id}`);
    }

    const resolvedPath = operation.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = actionParameters[key];
      if (value === undefined || value === null) {
        throw new Error(`${CONNECTOR}: path parameter ${key} is required`);
      }
      return encodeURIComponent(String(value));
    });

    const validatedBaseUrl = normalizeBaseUrl(baseUrl, `source_base_urls.${source.id}`);
    const requestUrl = new URL(`${validatedBaseUrl}${resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`}`);
    const headers = new Headers({ Accept: 'application/json' });

    for (const param of operation.operation.parameters ?? []) {
      const value = actionParameters[param.name];
      if (value === undefined || value === null) {
        if (param.required) throw new Error(`${CONNECTOR}: parameter ${param.name} is required`);
        continue;
      }
      if (param.in === 'path') continue;
      if (param.in === 'header') headers.set(param.name, String(value));
      if (param.in === 'query' || !param.in) requestUrl.searchParams.set(param.name, String(value));
    }

    applyProviderAuth(source.id, requestUrl, headers, providerAuth);

    const hasBody = operation.method !== 'GET' && Object.keys(actionBody).length > 0;
    if (hasBody) headers.set('Content-Type', 'application/json');

    const res = await fetch(requestUrl.toString(), {
      method: operation.method,
      headers,
      body: hasBody ? JSON.stringify(actionBody) : undefined,
    });

    const text = await res.text();
    const response = text ? parseJsonObject(text, `${action.id} response`) : {};
    if (!res.ok) {
      throw new Error(`${CONNECTOR}: action ${action.id} failed (${res.status}): ${text.slice(0, 500)}`);
    }

    trace[action.id] = {
      parameters: actionParameters,
      requestBody: actionBody,
      responses: { success: response },
    };

    actions.push({
      actionId: action.id,
      sourceId: source.id,
      operationId: action.operationId,
      request: {
        method: operation.method,
        url: `${requestUrl.origin}${requestUrl.pathname}`,
      },
      status: res.status,
      response,
    });
  }

  const last = actions.at(-1);
  return {
    flowId: flow.id,
    info: agentsJson.info,
    actions,
    result: last?.response ?? {},
  };
}

export class FlowsApi {
  constructor(private readonly config: WildcardConfig) {}

  async listFlows(args: Record<string, unknown>): Promise<unknown> {
    const agentsJson = await loadAgentsJson(args);
    return {
      info: agentsJson.info,
      flows: agentsJson.flows?.map((flow) => ({
        id: flow.id,
        title: flow.title,
        description: flow.description,
        actionCount: flow.actions?.length ?? 0,
      })) ?? [],
    };
  }

  async createFlowPrompt(args: Record<string, unknown>): Promise<string> {
    return flowPrompt(await loadAgentsJson(args));
  }

  async createOpenAiTools(args: Record<string, unknown>): Promise<unknown> {
    const agentsJson = await loadAgentsJson(args);
    return (agentsJson.flows ?? []).map(flowToOpenAiTool);
  }

  async invokeFlow(args: Record<string, unknown>): Promise<FlowInvokeResult> {
    const agentsJson = await loadAgentsJson(args);
    return executeFlow(this.config, agentsJson, findFlow(agentsJson, args), args);
  }
}
