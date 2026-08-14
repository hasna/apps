const BASE_URL = process.env["TICKETS_BASE_URL"] ?? "http://localhost:19428";

interface Data { short_id: string; title: string; sla_minutes: number; priority: string }

export const subject = (d: Data) => `🚨 SLA Breached: [${d.short_id}] ${d.title}`;

export const text = (d: Data) => `
SLA has been breached for ticket ${d.short_id}.

${d.title}
Expected resolution: ${d.sla_minutes} minutes
Priority: ${d.priority}

Please take immediate action: ${BASE_URL}/tickets/${d.short_id}
`.trim();

export const html = (d: Data) => `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px">
    <p style="color:#dc2626;font-weight:bold;margin:0">⚠️ SLA Breached — Immediate Action Required</p>
  </div>
  <h2 style="margin:8px 0"><a href="${BASE_URL}/tickets/${d.short_id}" style="color:#2563eb;text-decoration:none">[${d.short_id}] ${d.title}</a></h2>
  <p style="color:#6b7280">Expected resolution: <strong>${d.sla_minutes} minutes</strong> &middot; Priority: <strong>${d.priority}</strong></p>
  <a href="${BASE_URL}/tickets/${d.short_id}" style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:16px">View Ticket Now</a>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px">open-tickets</p>
</div>`.trim();
