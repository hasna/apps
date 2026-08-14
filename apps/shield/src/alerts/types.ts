import type { Advisory } from "../types/index.js";

export interface AlertPayload {
  advisory: Advisory;
  iocs: Array<{ type: string; value: string; context: string | null }>;
  detected_at: string;
  source: string; // e.g. "open-security/lepidus"
}

export interface AlertResult {
  channel: string;
  success: boolean;
  message?: string;
  url?: string; // e.g. tweet URL
}

export interface AlertChannel {
  name: string;
  send(payload: AlertPayload): Promise<AlertResult>;
}

export interface AlertConfig {
  enabled: boolean;
  channels: {
    twitter?: {
      enabled: boolean;
      api_key?: string;
      api_secret?: string;
      access_token?: string;
      access_token_secret?: string;
      bearer_token?: string;
    };
    slack?: {
      enabled: boolean;
      webhook_url?: string;
    };
    discord?: {
      enabled: boolean;
      webhook_url?: string;
    };
    webhook?: {
      enabled: boolean;
      url?: string;
      headers?: Record<string, string>;
    };
    email?: {
      enabled: boolean;
      smtp_host?: string;
      smtp_port?: number;
      smtp_user?: string;
      smtp_pass?: string;
      from?: string;
      to?: string[];
    };
  };
  min_severity: "critical" | "high" | "medium" | "low";
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: false,
  channels: {},
  min_severity: "critical",
};
