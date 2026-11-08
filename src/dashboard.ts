export function serveDashboardHtml(): Response {
  return new Response(DASHBOARD_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>IssueBot - Activity Dashboard</title>
<style>
  :root {
    --bg-page: #f8fafc;
    --card-bg: #ffffff;
    --card-border: #e2e8f0;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --btn-primary: #0d1527;
    --btn-primary-hover: #1e293b;
    --green: #22c55e;
    --red: #ef4444;
    --blue: #3b82f6;
    --amber: #f59e0b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--bg-page);
    color: var(--text-main);
    line-height: 1.5;
  }
  main {
    max-width: 1040px;
    margin: 0 auto;
    padding: 36px 20px 80px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
    border-bottom: 1px solid var(--card-border);
    padding-bottom: 18px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand img {
    height: 34px;
    width: auto;
  }
  .badge {
    font-size: 0.75rem;
    background: #e0e7ff;
    color: #4338ca;
    padding: 3px 10px;
    border-radius: 999px;
    font-weight: 700;
  }
  .badge-free {
    font-size: 0.75rem;
    background: #dcfce7;
    color: #15803d;
    padding: 3px 10px;
    border-radius: 999px;
    font-weight: 700;
  }
  p.sub { color: var(--text-muted); font-size: 0.95rem; margin-top: 4px; }

  .header-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  button {
    background: var(--btn-primary);
    color: #ffffff;
    border: none;
    padding: 9px 16px;
    border-radius: 8px;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  button:hover { background: var(--btn-primary-hover); }
  button.secondary {
    background: #ffffff;
    color: var(--text-main);
    border: 1px solid var(--card-border);
  }
  button.secondary:hover { background: #f1f5f9; }
  button.danger {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }
  button.danger:hover { background: #fca5a5; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 18px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
  }
  .card h2 {
    font-size: .75rem;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 1.15rem;
  }
  .dot-status { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .green { background: var(--green); box-shadow: 0 0 8px rgba(34, 197, 94, 0.4); }
  .value { font-size: 1.15rem; font-weight: 800; margin-top: 4px; }
  .time { color: var(--text-muted); font-size: .85rem; margin-top: 6px; }

  .panel-box {
    background: #f1f5f9;
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }
  .panel-box-info h3 {
    font-size: 0.95rem;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .panel-box-info p {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .panel-form {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .panel-form input {
    padding: 8px 12px;
    border: 1px solid var(--card-border);
    border-radius: 8px;
    font-size: 0.88rem;
    min-width: 220px;
  }

  .links-bar {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .board-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #ffffff;
    border: 1px solid var(--card-border);
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 0.88rem;
    font-weight: 600;
    color: #1e293b;
    text-decoration: none;
    transition: all 0.15s ease;
  }
  .board-link:hover {
    border-color: #94a3b8;
    background: #f1f5f9;
  }

  .section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 24px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .section h2 { font-size: 1.2rem; font-weight: 800; }

  .filter-bar {
    display: flex;
    gap: 8px;
  }
  .filter-btn {
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--card-border);
    background: #ffffff;
    color: var(--text-muted);
  }
  .filter-btn.active {
    background: var(--btn-primary);
    color: #ffffff;
    border-color: var(--btn-primary);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid var(--card-border);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  td {
    padding: 12px;
    border-bottom: 1px solid var(--card-border);
    vertical-align: top;
  }
  tr:last-child td { border-bottom: none; }

  .badge-level {
    font-size: 0.7rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 6px;
    text-transform: uppercase;
  }
  .badge-INFO { background: #e0f2fe; color: #0369a1; }
  .badge-SUCCESS { background: #dcfce7; color: #15803d; }
  .badge-WARN { background: #fef3c7; color: #b45309; }
  .badge-ERROR { background: #fee2e2; color: #b91c1c; }

  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1e293b;
    color: #ffffff;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    display: none;
    z-index: 1000;
    font-size: 0.9rem;
  }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand">
        <img src="https://hosted.inled.es/cdn/inled-logo-full.png" alt="INLED" />
        <span class="badge">IssueBot v2.0</span>
        <span class="badge-free">100% Free (0 DO)</span>
      </div>
      <p class="sub">Stateless Discord Interactions bot for GitHub Project Boards</p>
    </div>
    <div class="header-actions">
      <button id="btn-register" class="secondary">⚡ Register Slash Commands (/issue, /help)</button>
      <button id="btn-clear" class="danger">Clear Logs</button>
    </div>
  </header>

  <div class="grid">
    <div class="card">
      <h2>Bot Architecture</h2>
      <div class="pill"><span class="dot-status green"></span><span>Discord Webhooks</span></div>
      <div class="time">0 Durable Objects • 0 Storage Writes</div>
    </div>
    <div class="card">
      <h2>Uptime & Quotas</h2>
      <div class="value" style="color: var(--green);">100% Always Online</div>
      <div class="time">Standard Worker (100k req/day free)</div>
    </div>
    <div class="card">
      <h2>Recent Events</h2>
      <div class="value" id="logs-count">0</div>
      <div class="time">in memory buffer</div>
    </div>
  </div>

  <div class="panel-box">
    <div class="panel-box-info">
      <h3>📢 Post Interactive Control Panel to Discord</h3>
      <p>Send the interactive buttons panel (➕ New Issue, 💬 Comment, 🔒 Close Issue, Filter buttons) to any Discord channel.</p>
    </div>
    <div class="panel-form">
      <input type="text" id="channel-id-input" placeholder="Discord Channel ID" />
      <button id="btn-post-panel">Post Panel</button>
    </div>
  </div>

  <div class="links-bar">
    <span style="font-size: 0.88rem; color: var(--text-muted); align-self: center; font-weight: 600;">Project Boards:</span>
    <a href="https://github.com/orgs/Inled-Pulsar-OS/projects/1/views/2" target="_blank" class="board-link">
      <span>🚀 Pulsar OS Project Board (View 2)</span> ↗
    </a>
    <a href="https://github.com/orgs/InledGroup/projects/1/views/1" target="_blank" class="board-link">
      <span>🏢 Inled Issues Board (View 1)</span> ↗
    </a>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Activity Log</h2>
      <div class="filter-bar">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="Inled-Pulsar-OS">Pulsar</button>
        <button class="filter-btn" data-filter="InledGroup">Inled</button>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Level</th>
          <th>Event</th>
          <th>Org</th>
          <th>User</th>
          <th>Message / Details</th>
        </tr>
      </thead>
      <tbody id="logs-tbody">
        <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading logs...</td></tr>
      </tbody>
    </table>
  </div>
</main>

<div id="toast" class="toast"></div>

<script>
let currentFilter = 'all';
let allLogs = [];

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3500);
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    allLogs = await res.json();
    document.getElementById('logs-count').textContent = allLogs.length;
    renderLogs();
  } catch (err) {
    console.error('Error loading logs:', err);
  }
}

function renderLogs() {
  const tbody = document.getElementById('logs-tbody');
  const filtered = allLogs.filter(log => {
    if (currentFilter === 'all') return true;
    return log.org === currentFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No events recorded yet. Click a button or run a slash command in Discord.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(log => \`
    <tr>
      <td style="white-space: nowrap; font-family: monospace; font-size: 0.8rem; color: var(--text-muted);">\${fmtTime(log.timestamp)}</td>
      <td><span class="badge-level badge-\${log.level}">\${log.level}</span></td>
      <td><strong>\${log.event}</strong></td>
      <td><span style="font-size: 0.82rem; color: #475569;">\${log.org || '—'}</span></td>
      <td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">\${log.user || 'System'}</code></td>
      <td>
        <div>\${log.message}</div>
        \${log.details ? '<small style="color: var(--text-muted); display: block; margin-top: 2px;">' + log.details + '</small>' : ''}
      </td>
    </tr>
  \`).join('');
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderLogs();
  };
});

document.getElementById('btn-clear').onclick = async () => {
  await fetch('/api/logs', { method: 'DELETE' });
  showToast('Logs cleared.');
  loadLogs();
};

document.getElementById('btn-register').onclick = async () => {
  showToast('Registering Slash Commands with Discord...');
  try {
    const res = await fetch('/api/register-commands', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ Registered ' + data.count + ' slash commands: ' + data.commands.join(', '));
    } else {
      showToast('❌ Error: ' + (data.error || 'Failed'));
    }
  } catch (err) {
    showToast('❌ Error: ' + err);
  }
};

document.getElementById('btn-post-panel').onclick = async () => {
  const channelId = document.getElementById('channel-id-input').value.trim();
  if (!channelId) {
    showToast('⚠️ Please enter a Discord Channel ID');
    return;
  }
  showToast('Posting panel to Discord...');
  try {
    const res = await fetch('/api/post-panel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ Panel successfully posted to channel ' + channelId);
      document.getElementById('channel-id-input').value = '';
    } else {
      showToast('❌ Error: ' + (data.error || 'Failed'));
    }
  } catch (err) {
    showToast('❌ Error: ' + err);
  }
};

loadLogs();
setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadLogs();
  }
}, 30000);
</script>
</body>
</html>
`;
