import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { AlertChannel, AlertConfig, AlertPayload, AlertResult } from "./types.js";
import type { Advisory } from "../types/index.js";
import { Severity, SEVERITY_ORDER } from "../types/index.js";
import { SlackChannel } from "./channels/slack.js";
import { DiscordChannel } from "./channels/discord.js";
import { WebhookChannel } from "./channels/webhook.js";
import { TwitterChannel } from "./channels/twitter.js";
import { EmailChannel } from "./channels/email.js";
import { getDataRoot, getHomeDir } from "../lib/paths.js";

// --- Config loading ---

function getGlobalAlertConfigPath(): string {
  // The global alert config lives at the effective data root's alerts.json
  // (see src/lib/paths.ts), with one-time migration of the legacy
  // `~/.hasna/shield/alerts.json` / `~/.security/alerts.json` files.
  const path = join(getDataRoot(), "alerts.json");
  const legacyShieldPath = join(getHomeDir(), ".hasna", "shield", "alerts.json");
  const legacySecurityPath = join(getHomeDir(), ".security", "alerts.json");
  if (!existsSync(path)) {
    const legacyPath = existsSync(legacyShieldPath)
      ? legacyShieldPath
      : existsSync(legacySecurityPath)
        ? legacySecurityPath
        : null;
    if (legacyPath) {
      mkdirSync(dirname(path), { recursive: true });
      copyFileSync(legacyPath, path);
    }
  }
  return path;
}

function getAlertConfigPath(): string {
  const local = join(process.cwd(), ".security", "alerts.json");
  if (existsSync(local)) return local;
  return getGlobalAlertConfigPath();
}

export function loadAlertConfig(): AlertConfig {
  const path = getAlertConfigPath();
  if (!existsSync(path)) {
    return {
      enabled: false,
      channels: {},
      min_severity: "critical",
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AlertConfig;
  } catch {
    return { enabled: false, channels: {}, min_severity: "critical" };
  }
}

export function saveAlertConfig(config: AlertConfig, projectPath?: string): void {
  const targetPath = projectPath
    ? join(projectPath, ".security", "alerts.json")
    : getGlobalAlertConfigPath();

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// --- Manager ---

export class AlertManager {
  private channels: AlertChannel[] = [];
  private config: AlertConfig;

  constructor(config?: AlertConfig) {
    this.config = config ?? loadAlertConfig();
    this.initChannels();
  }

  private initChannels(): void {
    const { channels } = this.config;

    if (channels.slack?.enabled) {
      const url = channels.slack.webhook_url || process.env.SECURITY_SLACK_WEBHOOK_URL;
      if (url) this.channels.push(new SlackChannel(url));
    }

    if (channels.discord?.enabled) {
      const url = channels.discord.webhook_url || process.env.SECURITY_DISCORD_WEBHOOK_URL;
      if (url) this.channels.push(new DiscordChannel(url));
    }

    if (channels.webhook?.enabled) {
      const url = channels.webhook.url || process.env.SECURITY_WEBHOOK_URL;
      if (url) this.channels.push(new WebhookChannel(url, channels.webhook.headers));
    }

    if (channels.twitter?.enabled) {
      const api_key = channels.twitter.api_key || process.env.SECURITY_TWITTER_API_KEY;
      const api_secret = channels.twitter.api_secret || process.env.SECURITY_TWITTER_API_SECRET;
      const access_token = channels.twitter.access_token || process.env.SECURITY_TWITTER_ACCESS_TOKEN;
      const access_token_secret = channels.twitter.access_token_secret || process.env.SECURITY_TWITTER_ACCESS_TOKEN_SECRET;

      if (api_key && api_secret && access_token && access_token_secret) {
        this.channels.push(new TwitterChannel({ api_key, api_secret, access_token, access_token_secret }));
      }
    }

    if (channels.email?.enabled) {
      const smtp_host = channels.email.smtp_host || process.env.SECURITY_SMTP_HOST;
      const smtp_user = channels.email.smtp_user || process.env.SECURITY_SMTP_USER;
      const smtp_pass = channels.email.smtp_pass || process.env.SECURITY_SMTP_PASS;
      const from = channels.email.from || process.env.SECURITY_ALERT_FROM_EMAIL;
      const to = channels.email.to || (process.env.SECURITY_ALERT_TO_EMAILS?.split(",").map((e) => e.trim())) || [];

      if (smtp_host && smtp_user && smtp_pass && from && to.length > 0) {
        this.channels.push(new EmailChannel({
          smtp_host,
          smtp_port: channels.email.smtp_port || 587,
          smtp_user,
          smtp_pass,
          from,
          to,
        }));
      }
    }
  }

  shouldAlert(advisory: Advisory): boolean {
    if (!this.config.enabled) return false;
    if (this.channels.length === 0) return false;

    const minOrder = SEVERITY_ORDER[this.config.min_severity as Severity] ?? SEVERITY_ORDER[Severity.Critical];
    const advisoryOrder = SEVERITY_ORDER[advisory.severity as Severity] ?? 4;
    return advisoryOrder <= minOrder;
  }

  async alert(
    advisory: Advisory,
    iocs: Array<{ type: string; value: string; context: string | null }> = [],
  ): Promise<AlertResult[]> {
    if (!this.shouldAlert(advisory)) return [];

    const payload: AlertPayload = {
      advisory,
      iocs,
      detected_at: new Date().toISOString(),
      source: "shield",
    };

    const results = await Promise.allSettled(
      this.channels.map((ch) => ch.send(payload)),
    );

    return results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { channel: "unknown", success: false, message: String(r.reason) },
    );
  }

  getChannelNames(): string[] {
    return this.channels.map((c) => c.name);
  }

  isEnabled(): boolean {
    return this.config.enabled && this.channels.length > 0;
  }
}

// Singleton for use across the app
let _alertManager: AlertManager | null = null;

export function getAlertManager(): AlertManager {
  if (!_alertManager) _alertManager = new AlertManager();
  return _alertManager;
}

export function resetAlertManager(): void {
  _alertManager = null;
}
