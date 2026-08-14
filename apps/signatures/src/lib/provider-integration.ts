import { readFileSync } from "node:fs";
import type { SignatureLevel } from "../types/index.js";

export type ProviderName = "pandadoc" | "yousign" | string;

export interface ProviderRecipient {
  name: string;
  email: string;
  role?: string;
}

export interface ProviderConnectorOptions {
  apiUrl?: string;
  apiKey?: string;
  serverUrl?: string;
  accountId?: string;
  profileName?: string;
  idempotencyKey?: string;
}

export interface ProviderSendInput {
  provider: ProviderName;
  apiKey?: string;
  documentName: string;
  documentPath?: string;
  documentUrl?: string;
  recipients: ProviderRecipient[];
  fields?: Record<string, { value: string | number | boolean }>;
  message?: string;
  subject?: string;
  silent?: boolean;
  signatureLevel: SignatureLevel;
  connectors?: ProviderConnectorOptions;
  dryRun?: boolean;
}

export interface ProviderSendResult {
  provider: string;
  connector_slug?: string;
  operation?: string;
  remote_document_id?: string;
  remote_status?: string;
  status: "created" | "sent" | "dry_run" | "failed";
  signature_level: SignatureLevel;
  request?: Record<string, unknown>;
  response?: unknown;
  error?: string;
}

interface ProviderRequest {
  connector_slug: string;
  operation: string;
  request: Record<string, unknown>;
}

export async function sendWithProvider(input: ProviderSendInput): Promise<ProviderSendResult> {
  const provider = normalizeProvider(input.provider);
  const signatureLevel = assertSignatureLevel(input.signatureLevel);
  const prepared = prepareProviderRequest({ ...input, provider, signatureLevel });

  if (input.dryRun) {
    return {
      provider,
      connector_slug: prepared.connector_slug,
      operation: prepared.operation,
      status: "dry_run",
      signature_level: signatureLevel,
      request: prepared.request,
    };
  }

  const connectorResult = await tryConnectorProvider(prepared, input.connectors);
  if (connectorResult) {
    return { provider, signature_level: signatureLevel, ...connectorResult };
  }

  if (provider === "pandadoc") {
    return sendWithPandaDoc(input, prepared.request, signatureLevel);
  }

  return {
    provider,
    connector_slug: prepared.connector_slug,
    operation: prepared.operation,
    status: "failed",
    signature_level: signatureLevel,
    request: prepared.request,
    error: `${provider} requires @hasna/connectors-sdk hosted/local connector execution until direct API credentials are implemented.`,
  };
}

export function assertSignatureLevel(value: unknown): SignatureLevel {
  if (value === "ses" || value === "aes" || value === "qes" || value === "eseal" || value === "qeseal") {
    return value;
  }
  throw new Error("signature_level must be one of: ses, aes, qes, eseal, qeseal");
}

export function prepareProviderRequest(input: ProviderSendInput & { signatureLevel: SignatureLevel }): ProviderRequest {
  const provider = normalizeProvider(input.provider);
  if (isSealLevel(input.signatureLevel)) return prepareSealRequest({ ...input, provider });
  if (provider === "pandadoc") return preparePandaDocRequest(input);
  if (provider === "yousign") return prepareYousignRequest(input);
  return {
    connector_slug: provider,
    operation: "signature_requests.create",
    request: {
      provider,
      document: commonDocument(input),
      recipients: input.recipients,
      signature_level: input.signatureLevel,
      subject: input.subject,
      message: input.message,
      fields: input.fields,
    },
  };
}

function prepareSealRequest(input: ProviderSendInput & { signatureLevel: SignatureLevel }): ProviderRequest {
  return {
    connector_slug: normalizeProvider(input.provider),
    operation: input.signatureLevel === "qeseal" ? "seals.create_qualified" : "seals.create",
    request: {
      provider: normalizeProvider(input.provider),
      document: commonDocument(input),
      signature_level: input.signatureLevel,
      legal_entity: true,
      unsupported_without_seal_certificate: true,
      subject: input.subject,
      message: input.message,
    },
  };
}

function preparePandaDocRequest(input: ProviderSendInput & { signatureLevel: SignatureLevel }): ProviderRequest {
  const recipients = input.recipients.map((recipient) => ({
    email: recipient.email,
    first_name: recipient.name.split(/\s+/)[0] ?? recipient.name,
    last_name: recipient.name.split(/\s+/).slice(1).join(" ") || undefined,
    role: recipient.role ?? "Signer",
  }));
  return {
    connector_slug: "pandadoc",
    operation: input.signatureLevel === "qes" ? "documents.create_qualified_signature" : "documents.create_and_send",
    request: {
      name: input.documentName,
      document: commonDocument(input),
      recipients,
      fields: input.fields,
      url: input.documentUrl,
      subject: input.subject,
      message: input.message,
      silent: input.silent ?? false,
      signature_level: input.signatureLevel,
      settings: {
        qualified_electronic_signature: input.signatureLevel === "qes",
      },
    },
  };
}

function prepareYousignRequest(input: ProviderSendInput & { signatureLevel: SignatureLevel }): ProviderRequest {
  return {
    connector_slug: "yousign",
    operation: input.signatureLevel === "qes" ? "signature_requests.create_qualified" : "signature_requests.create",
    request: {
      name: input.documentName,
      delivery_mode: input.silent ? "none" : "email",
      signature_level: yousignSignatureLevel(input.signatureLevel),
      document: commonDocument(input),
      signers: input.recipients.map((recipient) => ({
        info: {
          first_name: recipient.name.split(/\s+/)[0] ?? recipient.name,
          last_name: recipient.name.split(/\s+/).slice(1).join(" ") || recipient.name,
          email: recipient.email,
        },
        role: recipient.role ?? "signer",
      })),
      fields: input.fields,
      email_notification: input.silent ? undefined : {
        subject: input.subject,
        message: input.message,
      },
    },
  };
}

function commonDocument(input: ProviderSendInput): Record<string, unknown> {
  return {
    name: input.documentName,
    path: input.documentPath,
    url: input.documentUrl,
  };
}

function normalizeProvider(provider: ProviderName): string {
  return provider.trim().toLowerCase().replace(/^@hasna\//, "").replace(/^connect-/, "");
}

function yousignSignatureLevel(level: SignatureLevel): string {
  if (level === "qes") return "qualified_electronic_signature";
  if (level === "aes") return "advanced_electronic_signature";
  if (isSealLevel(level)) {
    throw new Error("eSeal/qeSeal levels require legal-entity seal endpoints and must not be routed through signer flows.");
  }
  return "electronic_signature";
}

function isSealLevel(level: SignatureLevel): boolean {
  return level === "eseal" || level === "qeseal";
}

async function tryConnectorProvider(
  prepared: ProviderRequest,
  connectors?: ProviderConnectorOptions
): Promise<Omit<ProviderSendResult, "provider" | "signature_level"> | undefined> {
  if (!connectors?.apiUrl && !connectors?.serverUrl) return undefined;
  try {
    const sdk = await import("@hasna/connectors-sdk");
    if (connectors.apiUrl) {
      const client = new sdk.HostedConnectorsClient({
        apiUrl: connectors.apiUrl,
        apiKey: connectors.apiKey,
      });
      const response = await client.submitRun({
        connectorSlug: prepared.connector_slug,
        operationName: prepared.operation,
        input: prepared.request,
        accountId: connectors.accountId,
        profileName: connectors.profileName,
        idempotencyKey: connectors.idempotencyKey,
      });
      return resultFromConnectorResponse(prepared, response);
    }

    const client = new sdk.LocalConnectorsClient({
      serverUrl: connectors.serverUrl,
    });
    const invoke = "invoke" in client && typeof client.invoke === "function"
      ? client.invoke.bind(client)
      : client.runStructuredOperation.bind(client);
    const response = await invoke(prepared.connector_slug, {
      operation: prepared.operation,
      input: prepared.request,
      profile: connectors.profileName,
      parseJson: true,
    });
    return resultFromConnectorResponse(prepared, response);
  } catch (error) {
    return {
      connector_slug: prepared.connector_slug,
      operation: prepared.operation,
      status: "failed",
      request: prepared.request,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resultFromConnectorResponse(
  prepared: ProviderRequest,
  response: unknown
): Omit<ProviderSendResult, "provider" | "signature_level"> {
  const remoteId = pickRemoteId(response);
  const remoteStatus = pickRemoteStatus(response);
  return {
    connector_slug: prepared.connector_slug,
    operation: prepared.operation,
    status: remoteStatus === "failed" ? "failed" : "sent",
    remote_document_id: remoteId,
    remote_status: remoteStatus,
    request: prepared.request,
    response,
  };
}

function pickRemoteId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const record = response as Record<string, unknown>;
  for (const key of ["id", "document_id", "documentId", "remote_document_id", "runId"]) {
    if (typeof record[key] === "string") return record[key];
  }
  if (record["data"] && typeof record["data"] === "object") return pickRemoteId(record["data"]);
  return undefined;
}

function pickRemoteStatus(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const record = response as Record<string, unknown>;
  for (const key of ["status", "remote_status"]) {
    if (typeof record[key] === "string") return record[key];
  }
  if (record["success"] === false) return "failed";
  if (record["success"] === true) return "sent";
  if (record["data"] && typeof record["data"] === "object") return pickRemoteStatus(record["data"]);
  return undefined;
}

async function sendWithPandaDoc(
  input: ProviderSendInput,
  request: Record<string, unknown>,
  signatureLevel: SignatureLevel
): Promise<ProviderSendResult> {
  if (signatureLevel === "eseal" || signatureLevel === "qeseal") {
    return {
      provider: "pandadoc",
      connector_slug: "pandadoc",
      operation: signatureLevel === "qeseal" ? "seals.create_qualified" : "seals.create",
      status: "failed",
      signature_level: signatureLevel,
      request,
      error: "PandaDoc signer flow cannot satisfy eSeal/qeSeal. Configure a legal-entity seal connector/provider endpoint.",
    };
  }
  if (!input.apiKey) {
    return {
      provider: "pandadoc",
      connector_slug: "pandadoc",
      operation: signatureLevel === "qes" ? "documents.create_qualified_signature" : "documents.create_and_send",
      status: "failed",
      signature_level: signatureLevel,
      request,
      error: "PandaDoc API key is required. Set pandadoc_api_key or pass --api-key.",
    };
  }

  const headers = {
    Authorization: `API-Key ${input.apiKey}`,
    Accept: "application/json",
  };

  const createPayload = {
    name: input.documentName,
    recipients: request["recipients"],
    fields: input.fields,
    url: input.documentUrl,
    settings: request["settings"],
  };

  let createResponse: Response;
  if (input.documentPath && !input.documentUrl) {
    const form = new FormData();
    form.set("data", JSON.stringify({ ...createPayload, url: undefined }));
    form.set("file", new Blob([readFileSync(input.documentPath)], { type: "application/pdf" }), input.documentName);
    createResponse = await fetch("https://api.pandadoc.com/public/v1/documents", {
      method: "POST",
      headers,
      body: form,
    });
  } else {
    createResponse = await fetch("https://api.pandadoc.com/public/v1/documents", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(createPayload),
    });
  }

  const createBody = await readJson(createResponse);
  if (!createResponse.ok) {
    return {
      provider: "pandadoc",
      connector_slug: "pandadoc",
      operation: "documents.create_and_send",
      status: "failed",
      signature_level: signatureLevel,
      request,
      response: createBody,
      error: `PandaDoc create failed: HTTP ${createResponse.status}`,
    };
  }

  const remoteId = pickRemoteId(createBody);
  if (!remoteId) {
    return {
      provider: "pandadoc",
      connector_slug: "pandadoc",
      operation: "documents.create",
      status: "created",
      signature_level: signatureLevel,
      request,
      response: createBody,
    };
  }

  const sendResponse = await fetch(`https://api.pandadoc.com/public/v1/documents/${remoteId}/send`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: input.message,
      subject: input.subject,
      silent: input.silent ?? false,
    }),
  });
  const sendBody = await readJson(sendResponse);
  return {
    provider: "pandadoc",
    connector_slug: "pandadoc",
    operation: "documents.create_and_send",
    remote_document_id: remoteId,
    remote_status: sendResponse.ok ? "sent" : "failed",
    status: sendResponse.ok ? "sent" : "failed",
    signature_level: signatureLevel,
    request,
    response: { create: createBody, send: sendBody },
    error: sendResponse.ok ? undefined : `PandaDoc send failed: HTTP ${sendResponse.status}`,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}
