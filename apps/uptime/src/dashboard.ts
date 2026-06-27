export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Open Uptime</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #5f6b7a;
      --line: #d8dee8;
      --up: #157347;
      --down: #b42318;
      --warn: #9a6700;
      --accent: #2457c5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      padding: 18px 24px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
    }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    main { padding: 24px; max-width: 1180px; margin: 0 auto; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .metric { font-size: 28px; font-weight: 700; margin-top: 6px; }
    .muted { color: var(--muted); font-size: 13px; }
    .toolbar { display: flex; gap: 8px; align-items: center; }
    .stack { display: grid; gap: 16px; margin-top: 16px; }
    .form-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); align-items: end; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      background: white;
      color: var(--text);
      font: inherit;
    }
    button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      padding: 8px 12px;
      cursor: pointer;
      font-weight: 600;
    }
    button.primary { background: var(--accent); color: white; border-color: var(--accent); }
    button.danger { color: var(--down); }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 11px 8px; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .badge { display: inline-flex; min-width: 72px; justify-content: center; border-radius: 999px; padding: 4px 8px; font-size: 12px; font-weight: 700; }
    .up { background: #dcfce7; color: var(--up); }
    .down { background: #fee2e2; color: var(--down); }
    .paused { background: #fef3c7; color: var(--warn); }
    .unknown { background: #e5e7eb; color: #374151; }
    .row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    @media (max-width: 760px) {
      header { align-items: flex-start; flex-direction: column; }
      main { padding: 16px; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Open Uptime</h1>
      <div class="muted">Local uptime and downtime monitoring</div>
    </div>
    <div class="toolbar">
      <button id="check-all" class="primary">Run Checks</button>
      <button id="refresh">Refresh</button>
    </div>
  </header>
  <main>
    <section class="grid" id="metrics"></section>
    <section class="panel" style="margin-top:16px">
      <strong>Add Monitor</strong>
      <form id="monitor-form" class="form-grid">
        <label>Name<input id="form-name" required /></label>
        <label>Kind<select id="form-kind"><option value="http">HTTP</option><option value="tcp">TCP</option></select></label>
        <label>URL<input id="form-url" placeholder="https://example.com/health" /></label>
        <label>Host<input id="form-host" placeholder="127.0.0.1" /></label>
        <label>Port<input id="form-port" type="number" min="1" max="65535" /></label>
        <label>Interval<input id="form-interval" type="number" min="1" value="60" /></label>
        <label>Timeout<input id="form-timeout" type="number" min="1" value="5000" /></label>
        <button id="form-submit" class="primary" type="submit">Add</button>
        <button id="form-cancel" type="button">Cancel</button>
      </form>
      <div class="muted" id="form-status"></div>
    </section>
    <section class="panel" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
        <div>
          <strong>Monitors</strong>
          <div class="muted" id="generated"></div>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Status</th><th>Name</th><th>Target</th><th>Uptime</th><th>Latency</th><th>Last Check</th><th>Incident</th><th></th></tr>
        </thead>
        <tbody id="monitors"></tbody>
      </table>
    </section>
    <section class="stack">
      <section class="panel">
        <strong>Recent Results</strong>
        <table>
          <thead><tr><th>Status</th><th>Monitor</th><th>Checked</th><th>Latency</th><th>Error</th></tr></thead>
          <tbody id="results"></tbody>
        </table>
      </section>
      <section class="panel">
        <strong>Incidents</strong>
        <table>
          <thead><tr><th>Status</th><th>Monitor</th><th>Opened</th><th>Closed</th><th>Failures</th><th>Reason</th></tr></thead>
          <tbody id="incidents"></tbody>
        </table>
      </section>
    </section>
  </main>
  <script>
    let monitorCache = [];
    let editingId = null;
    const fmt = (value) => value == null || value === '' ? '-' : String(value);
    const pct = (value) => value == null ? '-' : Number(value).toFixed(2) + '%';
    const byId = (id) => document.getElementById(id);
    const text = (value) => document.createTextNode(fmt(value));
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    function cell(value) {
      const td = document.createElement('td');
      td.appendChild(text(value));
      return td;
    }
    function statusCell(status) {
      const td = document.createElement('td');
      const span = document.createElement('span');
      const safe = ['up', 'down', 'paused', 'unknown'].includes(status) ? status : 'unknown';
      span.className = 'badge ' + safe;
      span.textContent = status || 'unknown';
      td.appendChild(span);
      return td;
    }
    function button(label, handler, className) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      if (className) btn.className = className;
      btn.addEventListener('click', handler);
      return btn;
    }
    async function load() {
      const [summary, results, incidents] = await Promise.all([
        fetch('/api/summary').then((r) => r.json()),
        fetch('/api/results?limit=20').then((r) => r.json()),
        fetch('/api/incidents?limit=20').then((r) => r.json()),
      ]);
      monitorCache = summary.monitors.map((item) => item.monitor);
      byId('generated').textContent = 'Generated ' + new Date(summary.generatedAt).toLocaleString();
      renderMetrics(summary);
      renderMonitors(summary);
      renderResults(results);
      renderIncidents(incidents);
    }
    function renderMetrics(summary) {
      const root = byId('metrics');
      clear(root);
      for (const [label, value] of [
        ['Monitors', summary.totals.monitors],
        ['Up', summary.totals.up],
        ['Down', summary.totals.down],
        ['Open incidents', summary.totals.openIncidents],
      ]) {
        const panel = document.createElement('div');
        panel.className = 'panel';
        const small = document.createElement('div');
        small.className = 'muted';
        small.textContent = label;
        const metric = document.createElement('div');
        metric.className = 'metric';
        metric.textContent = value;
        panel.append(small, metric);
        root.appendChild(panel);
      }
    }
    function renderMonitors(summary) {
      const root = byId('monitors');
      clear(root);
      for (const item of summary.monitors) {
        const m = item.monitor;
        const target = m.kind === 'http' ? m.url : m.host + ':' + m.port;
        const incident = item.openIncident ? 'open since ' + new Date(item.openIncident.openedAt).toLocaleString() : '-';
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = m.name;
        const kind = document.createElement('div');
        kind.className = 'muted';
        kind.textContent = m.kind;
        name.append(strong, kind);
        const actions = document.createElement('td');
        actions.className = 'row-actions';
        actions.append(
          button('Check', () => checkOne(m.id)),
          button(m.enabled ? 'Pause' : 'Resume', () => setEnabled(m.id, !m.enabled)),
          button('Edit', () => fillForm(m.id)),
          button('Delete', () => deleteMonitor(m.id), 'danger'),
        );
        tr.append(
          statusCell(m.status),
          name,
          cell(target),
          cell(pct(item.uptimePercent)),
          cell(item.averageLatencyMs == null ? '-' : item.averageLatencyMs + ' ms'),
          cell(m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString() : '-'),
          cell(incident),
          actions,
        );
        root.appendChild(tr);
      }
    }
    function renderResults(results) {
      const root = byId('results');
      clear(root);
      for (const result of results) {
        const tr = document.createElement('tr');
        tr.append(
          statusCell(result.status),
          cell(result.monitorId),
          cell(new Date(result.checkedAt).toLocaleString()),
          cell(result.latencyMs == null ? '-' : result.latencyMs + ' ms'),
          cell(result.error),
        );
        root.appendChild(tr);
      }
    }
    function renderIncidents(incidents) {
      const root = byId('incidents');
      clear(root);
      for (const incident of incidents) {
        const tr = document.createElement('tr');
        tr.append(
          statusCell(incident.status),
          cell(incident.monitorId),
          cell(new Date(incident.openedAt).toLocaleString()),
          cell(incident.closedAt ? new Date(incident.closedAt).toLocaleString() : '-'),
          cell(incident.failureCount),
          cell(incident.reason),
        );
        root.appendChild(tr);
      }
    }
    async function checkOne(id) {
      await fetch('/api/monitors/' + encodeURIComponent(id) + '/check', { method: 'POST' });
      await load();
    }
    async function setEnabled(id, enabled) {
      await fetch('/api/monitors/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await load();
    }
    async function deleteMonitor(id) {
      await fetch('/api/monitors/' + encodeURIComponent(id), { method: 'DELETE' });
      await load();
    }
    function fillForm(id) {
      const m = monitorCache.find((item) => item.id === id);
      if (!m) return;
      editingId = m.id;
      byId('form-name').value = m.name;
      byId('form-kind').value = m.kind;
      byId('form-url').value = m.url || '';
      byId('form-host').value = m.host || '';
      byId('form-port').value = m.port || '';
      byId('form-interval').value = m.intervalSeconds;
      byId('form-timeout').value = m.timeoutMs;
      byId('form-submit').textContent = 'Save';
      byId('form-status').textContent = ['Editing', m.name].join(' ');
    }
    function resetForm() {
      editingId = null;
      byId('monitor-form').reset();
      byId('form-submit').textContent = 'Add';
      byId('form-status').textContent = '';
    }
    byId('monitor-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const kind = byId('form-kind').value;
      const body = {
        name: byId('form-name').value,
        kind,
        intervalSeconds: Number(byId('form-interval').value || 60),
        timeoutMs: Number(byId('form-timeout').value || 5000),
      };
      if (kind === 'http') body.url = byId('form-url').value;
      else {
        body.host = byId('form-host').value;
        body.port = Number(byId('form-port').value);
      }
      const response = await fetch(editingId ? '/api/monitors/' + encodeURIComponent(editingId) : '/api/monitors', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      byId('form-status').textContent = response.ok ? [editingId ? 'Saved' : 'Added', payload.name].join(' ') : payload.error;
      if (response.ok) resetForm();
      await load();
    });
    byId('form-cancel').addEventListener('click', resetForm);
    byId('refresh').addEventListener('click', load);
    byId('check-all').addEventListener('click', async () => {
      await fetch('/api/check-all', { method: 'POST' });
      await load();
    });
    load();
  </script>
</body>
</html>`;
}
