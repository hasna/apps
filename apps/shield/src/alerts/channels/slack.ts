import type { AlertChannel, AlertPayload, AlertResult } from "../types.js";

export class SlackChannel implements AlertChannel {
  name = "slack";

  constructor(private webhookUrl: string) {}

  async send(payload: AlertPayload): Promise<AlertResult> {
    const { advisory, iocs } = payload;
    const safeVersions = advisory.safe_versions.join(", ") || "none (remove package)";
    const iocList = iocs.slice(0, 5).map((i) => `• [${i.type}] \`${i.value}\``).join("\n");

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🚨 Supply Chain Attack: ${advisory.package_name}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${advisory.title}*\n${advisory.description.slice(0, 300)}${advisory.description.length > 300 ? "..." : ""}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Package:*\n\`${advisory.package_name}\` (${advisory.ecosystem})` },
          { type: "mrkdwn", text: `*Severity:*\n${advisory.severity.toUpperCase()}` },
          { type: "mrkdwn", text: `*Affected:*\n\`${advisory.affected_versions.join("`, `")}\`` },
          { type: "mrkdwn", text: `*Safe versions:*\n${safeVersions}` },
          { type: "mrkdwn", text: `*Attack type:*\n${advisory.attack_type}` },
          { type: "mrkdwn", text: `*Threat actor:*\n${advisory.threat_actor || "unknown"}` },
        ],
      },
    ];

    if (iocList) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*IOCs:*\n${iocList}` },
      });
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks, text: `🚨 ${advisory.title}` }),
      });

      if (!response.ok) {
        return { channel: this.name, success: false, message: `HTTP ${response.status}: ${await response.text()}` };
      }
      return { channel: this.name, success: true, message: "Sent to Slack" };
    } catch (error) {
      return { channel: this.name, success: false, message: String(error) };
    }
  }
}
