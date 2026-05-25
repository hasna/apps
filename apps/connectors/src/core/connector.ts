import { z } from "zod";
import {
  ConnectorDefinitionError,
  ConnectorOperationNotFoundError,
} from "./errors.js";

export type ConnectorAuthType =
  | "none"
  | "api_key"
  | "bearer_token"
  | "oauth2"
  | "basic"
  | "custom";

export interface ConnectorMetadata {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  tags?: string[];
}

export interface ConnectorAuthField {
  key: string;
  env?: string;
  label?: string;
  description?: string;
  required?: boolean;
  secret?: boolean;
}

export interface ConnectorAuthDefinition {
  type: ConnectorAuthType;
  supportsProfiles?: boolean;
  fields?: ConnectorAuthField[];
}

export interface ConnectorCommandDescriptor {
  name: string;
  summary: string;
  helpText?: string;
}

export interface ConnectorCommandResult {
  stdout: string;
  stderr?: string;
  exitCode?: number;
  success?: boolean;
}

export interface ConnectorCommandRuntime {
  commands: ConnectorCommandDescriptor[];
  helpText?: string;
  getHelp?: (
    command?: string
  ) => Promise<string | null | undefined> | string | null | undefined;
  run?: (
    args: string[]
  ) =>
    | Promise<ConnectorCommandResult | null | undefined>
    | ConnectorCommandResult
    | null
    | undefined;
}

export interface ConnectorContextFactoryArgs {
  credentials?: Record<string, unknown>;
  profile?: string;
}

export interface ConnectorOperationContext<TContext> {
  connector: InternalConnectorDefinition<TContext>;
  context: TContext;
  profile?: string;
  credentials?: Record<string, unknown>;
}

export interface ConnectorOperationDefinition<
  TContext = unknown,
  TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> {
  name?: string;
  summary: string;
  description?: string;
  inputSchema?: TInputSchema;
  execute: (
    ctx: ConnectorOperationContext<TContext>,
    input: z.infer<TInputSchema>
  ) => Promise<TOutput> | TOutput;
}

export type ConnectorOperationMap<TContext = unknown> = Record<
  string,
  ConnectorOperationDefinition<TContext, z.ZodTypeAny, unknown>
>;

export interface ConnectorDefinition<TContext = unknown> {
  meta: ConnectorMetadata;
  auth: ConnectorAuthDefinition;
  docsMarkdown?: string;
  createContext?: (
    args: ConnectorContextFactoryArgs
  ) => Promise<TContext> | TContext;
  operations: ConnectorOperationMap<TContext>;
  commandRuntime?: ConnectorCommandRuntime;
}

export type InternalConnectorOperationDefinition<TContext = unknown> =
  ConnectorOperationDefinition<TContext, z.ZodTypeAny, unknown> & {
    name: string;
  };

export interface InternalConnectorDefinition<TContext = unknown>
  extends Omit<ConnectorDefinition<TContext>, "operations"> {
  operations: Record<string, InternalConnectorOperationDefinition<TContext>>;
}

const CONNECTOR_NAME_RE = /^[a-z0-9-]+$/;
const OPERATION_NAME_RE = /^[a-z0-9:._-]+$/;

export function defineConnector<TContext = unknown>(
  definition: ConnectorDefinition<TContext>
): InternalConnectorDefinition<TContext> {
  const { meta, auth, operations } = definition;

  if (!CONNECTOR_NAME_RE.test(meta.name)) {
    throw new ConnectorDefinitionError(
      `Connector name '${meta.name}' must match ${CONNECTOR_NAME_RE}`
    );
  }

  if (Object.keys(operations).length === 0) {
    throw new ConnectorDefinitionError(
      `Connector '${meta.name}' must define at least one operation`
    );
  }

  const normalizedOperations: Record<
    string,
    InternalConnectorOperationDefinition<TContext>
  > = {};
  const usedNames = new Set<string>();

  for (const [key, operation] of Object.entries(operations)) {
    const effectiveName = operation.name ?? key;
    if (!OPERATION_NAME_RE.test(effectiveName)) {
      throw new ConnectorDefinitionError(
        `Operation name '${effectiveName}' on connector '${meta.name}' must match ${OPERATION_NAME_RE}`
      );
    }
    if (usedNames.has(effectiveName)) {
      throw new ConnectorDefinitionError(
        `Duplicate operation name '${effectiveName}' on connector '${meta.name}'`
      );
    }
    usedNames.add(effectiveName);
    normalizedOperations[key] = { ...operation, name: effectiveName };
  }

  return {
    ...definition,
    auth: {
      ...auth,
      fields: [...(auth.fields ?? [])],
    },
    meta: {
      ...meta,
      tags: [...(meta.tags ?? [])],
    },
    commandRuntime: definition.commandRuntime
      ? {
          ...definition.commandRuntime,
          commands: [...definition.commandRuntime.commands].sort((a, b) =>
            a.name.localeCompare(b.name)
          ),
        }
      : undefined,
    operations: normalizedOperations,
  };
}

export function listConnectorOperations<TContext = unknown>(
  connector: InternalConnectorDefinition<TContext>
): InternalConnectorOperationDefinition<TContext>[] {
  return Object.values(connector.operations).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function getConnectorOperation<TContext = unknown>(
  connector: InternalConnectorDefinition<TContext>,
  name: string
): InternalConnectorOperationDefinition<TContext> | undefined {
  return listConnectorOperations(connector).find((operation) => operation.name === name);
}

export interface ExecuteConnectorOperationArgs {
  operation: string;
  input?: unknown;
  credentials?: Record<string, unknown>;
  profile?: string;
}

export async function executeConnectorOperation<TContext = unknown>(
  connector: InternalConnectorDefinition<TContext>,
  args: ExecuteConnectorOperationArgs
): Promise<unknown> {
  const operation = getConnectorOperation(connector, args.operation);
  if (!operation) {
    throw new ConnectorOperationNotFoundError(connector.meta.name, args.operation);
  }

  const context = connector.createContext
    ? await connector.createContext({
        credentials: args.credentials,
        profile: args.profile,
      })
    : (undefined as TContext);

  const parsedInput = operation.inputSchema
    ? operation.inputSchema.parse(args.input ?? {})
    : (args.input ?? {});

  return operation.execute(
    {
      connector,
      context,
      profile: args.profile,
      credentials: args.credentials,
    },
    parsedInput
  );
}
