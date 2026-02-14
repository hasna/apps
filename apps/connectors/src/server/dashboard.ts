/**
 * HTML dashboard template for the connector auth management server.
 * Single-file HTML with embedded CSS/JS — no frameworks.
 */

export function getDashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connectors Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
    }
    .header {
      border-bottom: 1px solid #222;
      padding: 20px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      color: #fff;
    }
    .header h1 span { color: #666; font-weight: 400; }
    .header .port { color: #666; font-size: 13px; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px 32px; }
    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat {
      background: #141414;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 16px 20px;
      flex: 1;
    }
    .stat .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat .value { font-size: 24px; font-weight: 600; color: #fff; margin-top: 4px; }
    .search-bar {
      margin-bottom: 20px;
    }
    .search-bar input {
      width: 100%;
      padding: 10px 14px;
      background: #141414;
      border: 1px solid #222;
      border-radius: 6px;
      color: #e5e5e5;
      font-size: 14px;
      outline: none;
    }
    .search-bar input:focus { border-color: #444; }
    .search-bar input::placeholder { color: #555; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #141414;
      border: 1px solid #222;
      border-radius: 8px;
      overflow: hidden;
    }
    thead { background: #1a1a1a; }
    th {
      padding: 10px 16px;
      text-align: left;
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }
    td { padding: 12px 16px; border-top: 1px solid #1e1e1e; font-size: 14px; }
    tr:hover td { background: #1a1a1a; }
    .name { color: #fff; font-weight: 500; }
    .category { color: #888; font-size: 13px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
    }
    .badge-oauth { background: #1a1a3e; color: #818cf8; }
    .badge-apikey { background: #1a2e1a; color: #86efac; }
    .badge-bearer { background: #2e2a1a; color: #fcd34d; }
    .status-ok { color: #22c55e; }
    .status-no { color: #666; }
    .token-info { font-size: 12px; color: #666; }
    .token-info.expired { color: #ef4444; }
    .token-info.valid { color: #22c55e; }
    .btn {
      padding: 6px 12px;
      border: 1px solid #333;
      border-radius: 4px;
      background: #1a1a1a;
      color: #e5e5e5;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn:hover { background: #252525; border-color: #444; }
    .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-sm { padding: 4px 8px; font-size: 11px; }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      z-index: 100;
      justify-content: center;
      align-items: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px;
      width: 440px;
      max-width: 90vw;
    }
    .modal h2 { font-size: 16px; margin-bottom: 16px; color: #fff; }
    .modal label { display: block; font-size: 13px; color: #999; margin-bottom: 6px; }
    .modal input[type="text"], .modal input[type="password"] {
      width: 100%;
      padding: 8px 12px;
      background: #0a0a0a;
      border: 1px solid #333;
      border-radius: 6px;
      color: #e5e5e5;
      font-size: 14px;
      margin-bottom: 12px;
      outline: none;
      font-family: monospace;
    }
    .modal input:focus { border-color: #555; }
    .modal .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .modal .hint { font-size: 12px; color: #555; margin-bottom: 12px; }
    .modal .env-list { margin-bottom: 12px; }
    .modal .env-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 13px;
    }
    .modal .env-item code {
      background: #0a0a0a;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      color: #818cf8;
    }
    .modal .env-set { color: #22c55e; }
    .modal .env-unset { color: #666; }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      z-index: 200;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
    }
    .toast.show { transform: translateY(0); opacity: 1; }
    .toast.success { background: #14532d; color: #86efac; border: 1px solid #166534; }
    .toast.error { background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d; }

    .loading { text-align: center; padding: 40px; color: #666; }
    .empty { text-align: center; padding: 40px; color: #555; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Connectors <span>Dashboard</span></h1>
    <div class="port">localhost:${port}</div>
  </div>
  <div class="container">
    <div class="stats">
      <div class="stat">
        <div class="label">Installed</div>
        <div class="value" id="stat-installed">-</div>
      </div>
      <div class="stat">
        <div class="label">Configured</div>
        <div class="value" id="stat-configured">-</div>
      </div>
      <div class="stat">
        <div class="label">Needs Auth</div>
        <div class="value" id="stat-needs-auth">-</div>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="search" placeholder="Filter connectors..." />
    </div>
    <table>
      <thead>
        <tr>
          <th>Connector</th>
          <th>Category</th>
          <th>Auth Type</th>
          <th>Status</th>
          <th>Token</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="connectors-body">
        <tr><td colspan="6" class="loading">Loading connectors...</td></tr>
      </tbody>
    </table>
  </div>

  <div class="modal-overlay" id="modal-overlay">
    <div class="modal" id="modal"></div>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    const API = '';
    let connectors = [];

    async function load() {
      try {
        const res = await fetch(API + '/api/connectors');
        connectors = await res.json();
        render();
      } catch (e) {
        document.getElementById('connectors-body').innerHTML =
          '<tr><td colspan="6" class="empty">Failed to load connectors</td></tr>';
      }
    }

    function render(filter) {
      const q = (filter || '').toLowerCase();
      const filtered = q
        ? connectors.filter(c => c.name.toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q))
        : connectors;

      const configured = connectors.filter(c => c.auth?.configured).length;
      document.getElementById('stat-installed').textContent = connectors.length;
      document.getElementById('stat-configured').textContent = configured;
      document.getElementById('stat-needs-auth').textContent = connectors.length - configured;

      if (filtered.length === 0) {
        document.getElementById('connectors-body').innerHTML =
          '<tr><td colspan="6" class="empty">No connectors found</td></tr>';
        return;
      }

      document.getElementById('connectors-body').innerHTML = filtered.map(c => {
        const auth = c.auth || {};
        const typeBadge = auth.type === 'oauth'
          ? '<span class="badge badge-oauth">OAuth</span>'
          : auth.type === 'bearer'
          ? '<span class="badge badge-bearer">Bearer</span>'
          : '<span class="badge badge-apikey">API Key</span>';

        const status = auth.configured
          ? '<span class="status-ok">Configured</span>'
          : '<span class="status-no">Not configured</span>';

        let tokenInfo = '-';
        if (auth.type === 'oauth' && auth.configured && auth.tokenExpiry) {
          const exp = new Date(auth.tokenExpiry);
          const now = Date.now();
          if (auth.tokenExpiry < now) {
            tokenInfo = '<span class="token-info expired">Expired ' + timeAgo(auth.tokenExpiry) + '</span>';
          } else {
            tokenInfo = '<span class="token-info valid">Expires ' + timeAgo(auth.tokenExpiry) + '</span>';
          }
        }

        let actions = '';
        if (auth.type === 'oauth') {
          if (auth.configured) {
            actions = '<button class="btn btn-sm" onclick="refreshToken(\\''+c.name+'\\')">Refresh</button>';
          } else {
            actions = '<button class="btn btn-sm btn-primary" onclick="startOAuth(\\''+c.name+'\\')">Connect</button>';
          }
        } else {
          actions = '<button class="btn btn-sm" onclick="showKeyModal(\\''+c.name+'\\', '+JSON.stringify(JSON.stringify(auth))+')">'
            + (auth.configured ? 'Update' : 'Configure') + '</button>';
        }

        return '<tr>' +
          '<td class="name">' + c.displayName + '</td>' +
          '<td class="category">' + (c.category || '-') + '</td>' +
          '<td>' + typeBadge + '</td>' +
          '<td>' + status + '</td>' +
          '<td>' + tokenInfo + '</td>' +
          '<td>' + actions + '</td>' +
          '</tr>';
      }).join('');
    }

    function timeAgo(ts) {
      const diff = ts - Date.now();
      const absDiff = Math.abs(diff);
      if (absDiff < 60000) return Math.round(absDiff / 1000) + 's' + (diff < 0 ? ' ago' : '');
      if (absDiff < 3600000) return Math.round(absDiff / 60000) + 'm' + (diff < 0 ? ' ago' : '');
      if (absDiff < 86400000) return Math.round(absDiff / 3600000) + 'h' + (diff < 0 ? ' ago' : '');
      return Math.round(absDiff / 86400000) + 'd' + (diff < 0 ? ' ago' : '');
    }

    function showKeyModal(name, authJson) {
      const auth = JSON.parse(authJson);
      const envVars = auth.envVars || [];
      const modal = document.getElementById('modal');
      const overlay = document.getElementById('modal-overlay');

      let envHtml = '';
      if (envVars.length > 0) {
        envHtml = '<div class="env-list">' +
          envVars.map(v =>
            '<div class="env-item">' +
            '<code>' + v.variable + '</code>' +
            '<span class="' + (v.set ? 'env-set' : 'env-unset') + '">' + (v.set ? 'Set' : 'Not set') + '</span>' +
            '<span style="color:#555">— ' + v.description + '</span>' +
            '</div>'
          ).join('') +
          '</div>';
      }

      modal.innerHTML =
        '<h2>Configure ' + name + '</h2>' +
        envHtml +
        '<label>API Key / Token</label>' +
        '<input type="password" id="key-input" placeholder="Enter key or token..." />' +
        '<div class="hint">Stored locally at ~/.connect/connect-' + name + '/</div>' +
        '<div class="actions">' +
        '<button class="btn" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveKey(\\''+name+'\\')">Save</button>' +
        '</div>';

      overlay.classList.add('active');
      setTimeout(() => document.getElementById('key-input').focus(), 100);
    }

    function closeModal() {
      document.getElementById('modal-overlay').classList.remove('active');
    }

    async function saveKey(name) {
      const key = document.getElementById('key-input').value.trim();
      if (!key) return;

      try {
        const res = await fetch(API + '/api/connectors/' + name + '/key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Key saved for ' + name, 'success');
          closeModal();
          load();
        } else {
          showToast(data.error || 'Failed to save', 'error');
        }
      } catch (e) {
        showToast('Failed to save key', 'error');
      }
    }

    function startOAuth(name) {
      window.open(API + '/oauth/' + name + '/start', '_blank', 'width=600,height=700');
    }

    async function refreshToken(name) {
      try {
        const res = await fetch(API + '/api/connectors/' + name + '/refresh', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Token refreshed for ' + name, 'success');
          load();
        } else {
          showToast(data.error || 'Failed to refresh', 'error');
        }
      } catch (e) {
        showToast('Failed to refresh token', 'error');
      }
    }

    function showToast(msg, type) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = 'toast ' + type + ' show';
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    document.getElementById('search').addEventListener('input', (e) => {
      render(e.target.value);
    });

    // Close modal on overlay click
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Refresh when OAuth popup completes
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'oauth-complete') {
        showToast('Connected ' + e.data.connector, 'success');
        load();
      }
    });

    load();
  </script>
</body>
</html>`;
}
