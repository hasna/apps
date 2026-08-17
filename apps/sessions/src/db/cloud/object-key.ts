export type SessionObjectSource =
  | "claude"
  | "codex"
  | "codewith"
  | "gemini"
  | "cursor"
  | "opencode"
  | "aicopilot";

export interface SessionSandboxIdentity {
  provider: string;
  allocationId: string;
}

export interface BuildObjectKeyInput {
  machineId: string;
  sandbox?: SessionSandboxIdentity;
  source: SessionObjectSource;
  agent?: string;
  sessionId: string;
  sha256: string;
  ext: string;
}

export function buildObjectKey(input: BuildObjectKeyInput): string {
  const sandbox = input.sandbox
    ? `${input.sandbox.provider}:${input.sandbox.allocationId}`
    : "host";
  const agent = typeof input.agent === "string" && input.agent.trim() !== ""
    ? input.agent
    : "unresolved";
  const extension = input.ext.startsWith(".") ? input.ext.slice(1) : input.ext;

  return [
    `machine=${input.machineId}`,
    `sandbox=${sandbox}`,
    `runtime=${input.source}`,
    `agent=${agent}`,
    `session=${input.sessionId}`,
    `artifact=${input.sha256}.${extension}`,
  ].join("/");
}
