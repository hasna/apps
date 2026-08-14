interface Data { domain: string; txt_record_host: string; txt_record_value: string }

export const subject = (d: Data) => `Verify your domain: ${d.domain}`;

export const text = (d: Data) => `
To verify ${d.domain}, add the following DNS TXT record:

Host:  ${d.txt_record_host}
Value: ${d.txt_record_value}

Then run: tickets domain verify ${d.domain}

DNS changes may take up to 48 hours to propagate.
`.trim();

export const html = (d: Data) => `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2>Verify your domain: ${d.domain}</h2>
  <p>Add the following DNS TXT record to your DNS provider:</p>
  <table style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;width:100%;border-collapse:collapse">
    <tr><td style="color:#6b7280;padding:6px 0;width:80px">Host</td><td style="font-family:monospace;font-weight:bold">${d.txt_record_host}</td></tr>
    <tr><td style="color:#6b7280;padding:6px 0">Value</td><td style="font-family:monospace;font-weight:bold;word-break:break-all">${d.txt_record_value}</td></tr>
  </table>
  <p style="color:#6b7280;font-size:14px;margin-top:16px">Then run <code>tickets domain verify ${d.domain}</code> to complete verification.<br>DNS changes may take up to 48 hours to propagate.</p>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px">open-tickets</p>
</div>`.trim();
