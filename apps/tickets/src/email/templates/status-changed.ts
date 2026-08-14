const BASE_URL = process.env["TICKETS_BASE_URL"] ?? "http://localhost:19428";

interface Data { short_id: string; title: string; status: string; resolution?: string | null }

export const subject = (d: Data) => `[${d.short_id}] ${d.status === "closed" ? "Closed" : "Resolved"}: ${d.title}`;

export const text = (d: Data) => `
Your ticket has been ${d.status}.

[${d.short_id}] ${d.title}
${d.resolution ? `Resolution: ${d.resolution}` : ""}

View: ${BASE_URL}/tickets/${d.short_id}
`.trim();

export const html = (d: Data) => `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <p>Your ticket has been <strong>${d.status}</strong>.</p>
  <h2 style="margin:8px 0"><a href="${BASE_URL}/tickets/${d.short_id}" style="color:#2563eb;text-decoration:none">[${d.short_id}] ${d.title}</a></h2>
  ${d.resolution ? `<p style="color:#6b7280">Resolution: <strong>${d.resolution}</strong></p>` : ""}
  <a href="${BASE_URL}/tickets/${d.short_id}" style="display:inline-block;background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:16px">View Ticket</a>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px">open-tickets</p>
</div>`.trim();
