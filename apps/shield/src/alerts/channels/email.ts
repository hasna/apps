import type { AlertChannel, AlertPayload, AlertResult } from "../types.js";

/**
 * Email alert channel via SMTP.
 * Uses the Bun/Node net module to send raw SMTP.
 * For production, prefer using a transactional email API (SendGrid, Postmark, etc.)
 * and set SECURITY_SMTP_* env vars.
 */
export class EmailChannel implements AlertChannel {
  name = "email";

  constructor(
    private config: {
      smtp_host: string;
      smtp_port: number;
      smtp_user: string;
      smtp_pass: string;
      from: string;
      to: string[];
    },
  ) {}

  private formatHtml(payload: AlertPayload): string {
    const { advisory, iocs } = payload;
    const safeVersions = advisory.safe_versions.join(", ") || "none — remove package";
    const iocRows = iocs
      .map((i) => `<tr><td style="padding:4px 8px"><code>${i.type}</code></td><td style="padding:4px 8px"><code>${i.value}</code></td><td style="padding:4px 8px">${i.context || ""}</td></tr>`)
      .join("");

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Security Advisory: ${advisory.package_name}</title></head>
<body style="font-family: monospace; max-width: 700px; margin: 0 auto; padding: 20px; color: #333">
  <div style="background: #ff0000; color: white; padding: 16px; border-radius: 6px 6px 0 0">
    <h1 style="margin: 0; font-size: 18px">🚨 SUPPLY CHAIN ATTACK DETECTED</h1>
  </div>
  <div style="border: 2px solid #ff0000; padding: 20px; border-radius: 0 0 6px 6px">
    <h2 style="color: #cc0000">${advisory.title}</h2>
    <p>${advisory.description}</p>

    <table style="width: 100%; border-collapse: collapse; margin: 16px 0">
      <tr><th align="left" style="padding:4px 8px; background:#f5f5f5">Field</th><th align="left" style="padding:4px 8px; background:#f5f5f5">Value</th></tr>
      <tr><td style="padding:4px 8px"><strong>Package</strong></td><td style="padding:4px 8px"><code>${advisory.package_name}</code> (${advisory.ecosystem})</td></tr>
      <tr><td style="padding:4px 8px"><strong>Severity</strong></td><td style="padding:4px 8px"><strong style="color:#cc0000">${advisory.severity.toUpperCase()}</strong></td></tr>
      <tr><td style="padding:4px 8px"><strong>Affected versions</strong></td><td style="padding:4px 8px"><code>${advisory.affected_versions.join(", ")}</code></td></tr>
      <tr><td style="padding:4px 8px"><strong>Safe versions</strong></td><td style="padding:4px 8px" style="color:green">${safeVersions}</td></tr>
      <tr><td style="padding:4px 8px"><strong>Attack type</strong></td><td style="padding:4px 8px">${advisory.attack_type}</td></tr>
      ${advisory.threat_actor ? `<tr><td style="padding:4px 8px"><strong>Threat actor</strong></td><td style="padding:4px 8px">${advisory.threat_actor}</td></tr>` : ""}
      <tr><td style="padding:4px 8px"><strong>Detected at</strong></td><td style="padding:4px 8px">${advisory.detected_at}</td></tr>
    </table>

    ${iocRows ? `
    <h3>Indicators of Compromise</h3>
    <table style="width: 100%; border-collapse: collapse">
      <tr><th align="left" style="padding:4px 8px; background:#f5f5f5">Type</th><th align="left" style="padding:4px 8px; background:#f5f5f5">Value</th><th align="left" style="padding:4px 8px; background:#f5f5f5">Context</th></tr>
      ${iocRows}
    </table>
    ` : ""}

    <hr style="margin: 20px 0">
    <p style="color: #666; font-size: 12px">
      Sent by open-security (@hasna/security) — AI-powered supply chain security scanner.<br>
      Advisory ID: ${advisory.id}
    </p>
  </div>
</body>
</html>`;
  }

  async send(payload: AlertPayload): Promise<AlertResult> {
    const { advisory } = payload;
    const subject = `[SECURITY] ${advisory.severity.toUpperCase()}: ${advisory.package_name} supply chain attack`;
    const html = this.formatHtml(payload);

    // Build raw SMTP message
    const message = [
      `From: ${this.config.from}`,
      `To: ${this.config.to.join(", ")}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      html,
    ].join("\r\n");

    try {
      // Use fetch to a simple SMTP-over-HTTP relay if available,
      // otherwise attempt direct SMTP via net socket
      const smtpApiUrl = process.env.SECURITY_SMTP_API_URL;
      if (smtpApiUrl) {
        const response = await fetch(smtpApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: this.config.from,
            to: this.config.to,
            subject,
            html,
          }),
        });
        if (!response.ok) {
          return { channel: this.name, success: false, message: `SMTP API error: ${response.status}` };
        }
        return { channel: this.name, success: true, message: `Email sent to ${this.config.to.join(", ")}` };
      }

      // Direct SMTP not implemented here (requires TLS negotiation)
      // In production, use SendGrid/Postmark SDK or set SECURITY_SMTP_API_URL
      return {
        channel: this.name,
        success: false,
        message: "Direct SMTP not supported. Set SECURITY_SMTP_API_URL for HTTP-based SMTP relay.",
      };
    } catch (error) {
      return { channel: this.name, success: false, message: String(error) };
    }
  }
}
