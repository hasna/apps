import type { AlertChannel, AlertPayload, AlertResult } from "../types.js";

export class DiscordChannel implements AlertChannel {
  name = "discord";

  constructor(private webhookUrl: string) {}

  async send(payload: AlertPayload): Promise<AlertResult> {
    const { advisory, iocs } = payload;
    const safeVersions = advisory.safe_versions.join(", ") || "none (remove package)";
    const iocFields = iocs.slice(0, 5).map((i) => ({
      name: `[${i.type}]`,
      value: `\`${i.value}\`${i.context ? ` — ${i.context}` : ""}`,
      inline: false,
    }));

    const severityColor =
      advisory.severity === "critical" ? 0xff0000 :
      advisory.severity === "high" ? 0xff6600 :
      advisory.severity === "medium" ? 0xffaa00 : 0x0099ff;

    const embed = {
      title: `🚨 ${advisory.title}`,
      color: severityColor,
      description: advisory.description.slice(0, 400),
      fields: [
        { name: "Package", value: `\`${advisory.package_name}\` (${advisory.ecosystem})`, inline: true },
        { name: "Severity", value: advisory.severity.toUpperCase(), inline: true },
        { name: "Affected", value: advisory.affected_versions.map((v) => `\`${v}\``).join(", "), inline: false },
        { name: "Safe versions", value: safeVersions, inline: false },
        { name: "Attack type", value: advisory.attack_type, inline: true },
        ...(advisory.threat_actor ? [{ name: "Threat actor", value: advisory.threat_actor, inline: true }] : []),
        ...iocFields,
      ],
      footer: { text: `open-security advisory • ${advisory.detected_at}` },
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });

      if (!response.ok) {
        return { channel: this.name, success: false, message: `HTTP ${response.status}: ${await response.text()}` };
      }
      return { channel: this.name, success: true, message: "Sent to Discord" };
    } catch (error) {
      return { channel: this.name, success: false, message: String(error) };
    }
  }
}
