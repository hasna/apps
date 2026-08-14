const BASE_URL = process.env["TICKETS_BASE_URL"] ?? "http://localhost:19428";

interface Data { short_id: string; title: string; type: string; priority: string; description?: string | null; project_name?: string }

export const subject = (d: Data) => `[${d.short_id}] New ${d.type}: ${d.title}`;

export const text = (d: Data) => `
A new ${d.type} has been assigned to you.

[${d.short_id}] ${d.title}
Priority: ${d.priority}
${d.project_name ? `Project: ${d.project_name}` : ""}
${d.description ? `\n${d.description.slice(0, 500)}` : ""}

View ticket: ${BASE_URL}/tickets/${d.short_id}
`.trim();

export const html = (d: Data) => `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <p style="color:#6b7280">A new <strong>${d.type}</strong> has been assigned to you</p>
  <h2 style="margin:8px 0"><a href="${BASE_URL}/tickets/${d.short_id}" style="color:#2563eb;text-decoration:none">[${d.short_id}] ${d.title}</a></h2>
  <p style="color:#6b7280;margin:4px 0">Priority: <strong>${d.priority}</strong>${d.project_name ? ` &middot; Project: ${d.project_name}` : ""}</p>
  ${d.description ? `<div style="background:#f9fafb;border-left:3px solid #e5e7eb;padding:12px;margin:16px 0;white-space:pre-wrap">${d.description.slice(0, 500)}</div>` : ""}
  <a href="${BASE_URL}/tickets/${d.short_id}" style="display:inline-block;background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:16px">View Ticket</a>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px">open-tickets &middot; <a href="${BASE_URL}/tickets/${d.short_id}" style="color:#9ca3af">Unsubscribe</a></p>
</div>`.trim();
