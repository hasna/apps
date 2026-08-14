import type { AlertChannel, AlertPayload, AlertResult } from "../types.js";

export class WebhookChannel implements AlertChannel {
  name = "webhook";

  constructor(
    private url: string,
    private headers: Record<string, string> = {},
  ) {}

  async send(payload: AlertPayload): Promise<AlertResult> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify({
          type: "supply_chain_advisory",
          advisory: {
            id: payload.advisory.id,
            package_name: payload.advisory.package_name,
            ecosystem: payload.advisory.ecosystem,
            affected_versions: payload.advisory.affected_versions,
            safe_versions: payload.advisory.safe_versions,
            attack_type: payload.advisory.attack_type,
            severity: payload.advisory.severity,
            title: payload.advisory.title,
            threat_actor: payload.advisory.threat_actor,
            detected_at: payload.advisory.detected_at,
          },
          iocs: payload.iocs,
          detected_at: payload.detected_at,
          source: payload.source,
        }),
      });

      if (!response.ok) {
        return { channel: this.name, success: false, message: `HTTP ${response.status}: ${await response.text()}` };
      }
      return { channel: this.name, success: true, message: `Webhook delivered to ${this.url}` };
    } catch (error) {
      return { channel: this.name, success: false, message: String(error) };
    }
  }
}
