const BASE_URL = process.env["TICKETS_BASE_URL"] ?? "http://localhost:19428";

interface Data { short_id: string; title: string; comment_content: string; author_name?: string }

export const subject = (d: Data) => `Re: [${d.short_id}] ${d.title}`;

export const text = (d: Data) => `
New comment on [${d.short_id}] ${d.title}:
${d.author_name ? `From: ${d.author_name}\n` : ""}
${d.comment_content}

View ticket: ${BASE_URL}/tickets/${d.short_id}
`.trim();

export const html = (d: Data) => `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <p style="color:#6b7280">New comment on <a href="${BASE_URL}/tickets/${d.short_id}" style="color:#2563eb;text-decoration:none">[${d.short_id}] ${d.title}</a>${d.author_name ? ` from <strong>${d.author_name}</strong>` : ""}:</p>
  <blockquote style="background:#f9fafb;border-left:3px solid #e5e7eb;padding:12px;margin:16px 0;white-space:pre-wrap">${d.comment_content}</blockquote>
  <a href="${BASE_URL}/tickets/${d.short_id}" style="display:inline-block;background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">View Ticket</a>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px">open-tickets</p>
</div>`.trim();
