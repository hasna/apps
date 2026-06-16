import { readFileSync } from "node:fs";

export interface ProviderRecipient {
  name: string;
  email: string;
  role?: string;
}

export interface ProviderSendInput {
  provider: "pandadoc" | string;
  apiKey?: string;
  documentName: string;
  documentPath?: string;
  documentUrl?: string;
  recipients: ProviderRecipient[];
  fields?: Record<string, { value: string | number | boolean }>;
  message?: string;
  subject?: string;
  silent?: boolean;
  dryRun?: boolean;
}

export interface ProviderSendResult {
  provider: string;
  remote_document_id?: string;
  status: "created" | "sent" | "dry_run" | "failed";
  request?: Record<string, unknown>;
  response?: unknown;
  error?: string;
}

export async function sendWithProvider(input: ProviderSendInput): Promise<ProviderSendResult> {
  if (input.provider !== "pandadoc") {
    return {
      provider: input.provider,
      status: "failed",
      error: `Unsupported provider: ${input.provider}`,
    };
  }
  return sendWithPandaDoc(input);
}

async function sendWithPandaDoc(input: ProviderSendInput): Promise<ProviderSendResult> {
  const request = {
    name: input.documentName,
    recipients: input.recipients.map((recipient) => ({
      email: recipient.email,
      first_name: recipient.name.split(/\s+/)[0] ?? recipient.name,
      last_name: recipient.name.split(/\s+/).slice(1).join(" ") || undefined,
      role: recipient.role ?? "Signer",
    })),
    fields: input.fields,
    url: input.documentUrl,
  };

  if (input.dryRun) {
    return { provider: "pandadoc", status: "dry_run", request };
  }
  if (!input.apiKey) {
    return {
      provider: "pandadoc",
      status: "failed",
      request,
      error: "PandaDoc API key is required. Set pandadoc_api_key or pass --api-key.",
    };
  }

  const headers = {
    Authorization: `API-Key ${input.apiKey}`,
    Accept: "application/json",
  };

  let createResponse: Response;
  if (input.documentPath && !input.documentUrl) {
    const form = new FormData();
    form.set("data", JSON.stringify({ ...request, url: undefined }));
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
      body: JSON.stringify(request),
    });
  }

  const createBody = await readJson(createResponse);
  if (!createResponse.ok) {
    return { provider: "pandadoc", status: "failed", request, response: createBody, error: `PandaDoc create failed: HTTP ${createResponse.status}` };
  }

  const remoteId = typeof createBody === "object" && createBody && "id" in createBody
    ? String((createBody as Record<string, unknown>)["id"])
    : undefined;

  if (!remoteId) {
    return { provider: "pandadoc", status: "created", request, response: createBody };
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
    remote_document_id: remoteId,
    status: sendResponse.ok ? "sent" : "failed",
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
