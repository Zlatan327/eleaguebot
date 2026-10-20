const http = require('http');
const LeagueService = require('./services/leagueService');
const FixtureRepo = require('./database/repositories/fixtureRepo');
const SettingsRepo = require('./database/repositories/settingsRepo');

let latestQrDataUrl = null;
let isBotReady = false;
let currentStatus = 'Initializing WhatsApp Web client in Chromium...';

function setLatestQr(qrString) {
  latestQrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(qrString)}`;
  currentStatus = 'QR Code generated! Ready to scan with WhatsApp.';
}

function setBotReady(ready = true) {
  isBotReady = ready;
  if (ready) {
    latestQrDataUrl = null;
    currentStatus = 'Bot is online and actively managing league group chats.';
  }
}

function setBotStatus(statusText) {
  currentStatus = statusText;
}

function startWebServer(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // 1. Health check endpoint (for Render & UptimeRobot keep-alive)
    if (url.pathname === '/health' || url.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // NEVER expose env vars or secrets here
      res.end(JSON.stringify({
        status: 'ok',
        botReady: isBotReady,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // 2. Public JSON API for standings (Phone numbers strictly stripped)
    if (url.pathname === '/api/standings') {
      try {
        const standings = LeagueService.getStandings().map(player => ({
          id: player.id,
          name: player.name,
          played: player.played,
          won: player.won,
          drawn: player.drawn,
          lost: player.lost,
          goals_for: player.goals_for,
          goals_against: player.goals_against,
          goal_diff: player.goal_diff,
          points: player.points,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(standings));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch standings' }));
      }
      return;
    }

    // 3. Figma-styled Frontend Dashboard
    if (url.pathname === '/') {
      let standings = [];
      let fixtures = [];
      let currentWeek = 1;
      let leagueName = 'eFootball League';

      try {
        standings = LeagueService.getStandings();
        fixtures = FixtureRepo.getAll({ limit: 12 });
        currentWeek = SettingsRepo.getInt('current_week', 1);
        leagueName = SettingsRepo.get('league_name', 'eFootball League');
      } catch (err) {
        // Fallback for fresh boot
      }

      // Generate Standings Rows
      const standingsRowsHtml = standings.length > 0 ? standings.map((s, idx) => {
        let rankBadge = `<span class="rank">${idx + 1}</span>`;
        if (idx === 0) rankBadge = `<span class="rank gold">1</span>`;
        else if (idx === 1) rankBadge = `<span class="rank silver">2</span>`;
        else if (idx === 2) rankBadge = `<span class="rank bronze">3</span>`;

        const gdFormatted = s.goal_diff > 0 ? `+${s.goal_diff}` : `${s.goal_diff}`;

        return `
          <tr class="table-row">
            <td class="col-rank">${rankBadge}</td>
            <td class="col-player">
              <div class="player-info">
                <span class="avatar">${s.name.slice(0, 2).toUpperCase()}</span>
                <span class="player-name">${s.name}</span>
              </div>
            </td>
            <td class="col-num">${s.played}</td>
            <td class="col-num text-muted">${s.won}</td>
            <td class="col-num text-muted">${s.drawn}</td>
            <td class="col-num text-muted">${s.lost}</td>
            <td class="col-num text-muted">${s.goals_for}:${s.goals_against}</td>
            <td class="col-num ${s.goal_diff > 0 ? 'text-green' : s.goal_diff < 0 ? 'text-red' : 'text-muted'}">${gdFormatted}</td>
            <td class="col-pts"><strong>${s.points}</strong></td>
          </tr>
        `;
      }).join('') : `
        <tr>
          <td colspan="9" class="empty-state">No players registered yet. Add players using <code>!addplayer &lt;name&gt;</code> in WhatsApp.</td>
        </tr>
      `;

      // Generate Fixtures List (Matching user's pill list style)
      const fixturesHtml = fixtures.length > 0 ? fixtures.slice(0, 6).map(f => {
        const isPlayed = f.status === 'played';
        const isForfeit = f.status === 'forfeited';

        let statusPill = `<span class="pill pill-pending">Pending</span>`;
        let scoreDisplay = `<span class="score-vs">vs</span>`;

        if (isPlayed) {
          statusPill = `<span class="pill pill-played">FT</span>`;
          scoreDisplay = `<span class="score-result">${f.score_home} - ${f.score_away}</span>`;
        } else if (isForfeit) {
          statusPill = `<span class="pill pill-forfeit">Forfeit</span>`;
          scoreDisplay = `<span class="score-result">${f.score_home} - ${f.score_away}</span>`;
        }

        return `
          <div class="fixture-card">
            <div class="fixture-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </div>
            <div class="fixture-details">
              <div class="fixture-teams">
                <span class="team">${f.home_name}</span>
                ${scoreDisplay}
                <span class="team">${f.away_name}</span>
              </div>
              <span class="fixture-meta">Week ${f.week} &bull; Match #${f.id}</span>
            </div>
            ${statusPill}
          </div>
        `;
      }).join('') : `
        <div class="empty-state">No scheduled fixtures yet. Run <code>!generatefixtures</code> in WhatsApp.</div>
      `;

      // QR Code Card
      let qrCardHtml = '';
      if (!isBotReady && latestQrDataUrl) {
        qrCardHtml = `
          <div class="glass-card qr-card">
            <div class="qr-header">
              <div class="badge-icon">📲</div>
              <div>
                <h3>Link WhatsApp Account</h3>
                <p>Open WhatsApp &gt; Linked Devices &gt; Link a Device and scan:</p>
              </div>
            </div>
            <div class="qr-img-wrapper">
              <img src="${latestQrDataUrl}" alt="WhatsApp Web QR Code" width="280" height="280" />
            </div>
            <div class="qr-footer">
              <span class="pulse-dot"></span> Auto-refreshes when updated
            </div>
          </div>
        `;
      } else if (!isBotReady) {
        qrCardHtml = `
          <div class="glass-card status-card">
            <div class="loader-spinner"></div>
            <div>
              <h3>Connecting to WhatsApp Web...</h3>
              <p class="status-msg">${currentStatus}</p>
            </div>
          </div>
        `;
      }

      // Auto-refresh rate
      const refreshSec = !isBotReady ? 6 : 30;

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${leagueName} &bull; Dashboard</title>
  <meta http-equiv="refresh" content="${refreshSec}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090D16;
      --card-bg: #111726;
      --card-border: rgba(255, 255, 255, 0.07);
      --card-hover: rgba(255, 255, 255, 0.03);
      --text-main: #F1F5F9;
      --text-muted: #94A3B8;
      --text-dim: #64748B;
      --accent-gold: #F59E0B;
      --accent-green: #10B981;
      --accent-blue: #38BDF8;
      --accent-red: #EF4444;
      --font: 'Plus Jakarta Sans', -apple-system, sans-serif;
      --mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.08) 0px, transparent 50%),
        radial-gradient(at 100% 0%, rgba(245, 158, 11, 0.06) 0px, transparent 50%);
      color: var(--text-main);
      font-family: var(--font);
      min-height: 100vh;
      padding: 32px 16px;
      display: flex;
      justify-content: center;
    }

    .app-container {
      width: 100%;
      max-width: 900px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Top Navigation / Header */
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      backdrop-filter: blur(12px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #1E293B, #0F172A);
      border: 1px solid rgba(245, 158, 11, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .brand h1 {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .header-pills {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.25);
      color: #34D399;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
    }

    .status-badge.offline {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.25);
      color: #FBBF24;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Cards / Glass Container */
    .glass-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
      letter-spacing: 0.02em;
    }

    .pill-pending { background: rgba(56, 189, 248, 0.12); color: var(--accent-blue); }
    .pill-played { background: rgba(16, 185, 129, 0.15); color: #34D399; }
    .pill-forfeit { background: rgba(239, 68, 68, 0.15); color: #F87171; }

    /* Figma-styled Table */
    .table-container {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--text-dim);
      padding: 10px 14px;
      border-bottom: 1px solid var(--card-border);
      letter-spacing: 0.05em;
    }

    td {
      padding: 12px 14px;
      font-size: 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .table-row:hover {
      background: var(--card-hover);
    }

    .col-rank { width: 44px; text-align: center; }
    .col-player { font-weight: 600; }
    .col-num { text-align: center; font-family: var(--mono); font-size: 13px; }
    .col-pts { text-align: center; font-family: var(--mono); font-size: 15px; color: var(--accent-gold); }

    .player-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .avatar {
      width: 26px;
      height: 26px;
      border-radius: 8px;
      background: #1E293B;
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
    }

    .rank {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      color: var(--text-dim);
    }

    .rank.gold { background: rgba(245, 158, 11, 0.2); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .rank.silver { background: rgba(148, 163, 184, 0.2); color: #E2E8F0; border: 1px solid rgba(148, 163, 184, 0.4); }
    .rank.bronze { background: rgba(180, 83, 9, 0.2); color: #FCD34D; border: 1px solid rgba(180, 83, 9, 0.4); }

    .text-green { color: var(--accent-green); }
    .text-red { color: var(--accent-red); }
    .text-muted { color: var(--text-muted); }

    /* Figma-styled Fixture List (Matches User Image) */
    .fixtures-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .fixture-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 16px;
      background: #0B0F19;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 14px;
      transition: all 0.2s ease;
    }

    .fixture-card:hover {
      background: #0E1422;
      border-color: rgba(255, 255, 255, 0.1);
      transform: translateY(-1px);
    }

    .fixture-icon {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .fixture-details {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .fixture-teams {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .score-vs {
      font-size: 11px;
      color: var(--text-dim);
      font-weight: 700;
      text-transform: uppercase;
    }

    .score-result {
      font-family: var(--mono);
      font-size: 13px;
      color: var(--accent-gold);
      font-weight: 700;
    }

    .fixture-meta {
      font-size: 11px;
      color: var(--text-dim);
    }

    /* QR Code Card Modal */
    .qr-card {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      background: linear-gradient(180deg, #131C30 0%, #0F1626 100%);
      border: 1px solid rgba(56, 189, 248, 0.2);
    }

    .qr-header {
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      text-align: left;
    }

    .badge-icon {
      font-size: 24px;
    }

    .qr-header h3 { font-size: 16px; font-weight: 700; color: #F8FAFC; }
    .qr-header p { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

    .qr-img-wrapper {
      background: white;
      padding: 10px;
      border-radius: 14px;
      display: inline-block;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    }

    .qr-img-wrapper img { display: block; border-radius: 6px; }

    .qr-footer {
      margin-top: 14px;
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Status Spinner Card */
    .status-card {
      display: flex;
      align-items: center;
      gap: 16px;
      border-color: rgba(245, 158, 11, 0.25);
      background: rgba(245, 158, 11, 0.05);
    }

    .status-card h3 { font-size: 15px; font-weight: 700; color: #FBBF24; }
    .status-msg { font-size: 13px; color: var(--text-muted); margin-top: 2px; }

    .loader-spinner {
      width: 28px;
      height: 28px;
      border: 3px solid rgba(245, 158, 11, 0.2);
      border-top-color: #F59E0B;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .empty-state {
      padding: 24px;
      text-align: center;
      color: var(--text-dim);
      font-size: 13px;
    }

    footer {
      text-align: center;
      font-size: 12px;
      color: var(--text-dim);
      padding: 12px 0;
    }
  </style>
</head>
<body>
  <div class="app-container">
    
    <!-- Top Bar -->
    <header class="header-bar">
      <div class="brand">
        <div class="brand-icon">⚽</div>
        <div>
          <h1>${leagueName}</h1>
        </div>
      </div>
      <div class="header-pills">
        <span class="pill">Week ${currentWeek}</span>
        ${isBotReady 
          ? `<span class="status-badge"><span class="pulse-dot"></span> Online</span>`
          : `<span class="status-badge offline"><span class="pulse-dot"></span> Syncing</span>`
        }
      </div>
    </header>

    <!-- QR Code / Connection Box -->
    ${qrCardHtml}

    <!-- Standings Table -->
    <section class="glass-card">
      <div class="card-header">
        <h2 class="card-title">
          <span>🏆</span>
          <span>${leagueName} Standings</span>
        </h2>
        <span class="pill">Week ${currentWeek}</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th class="col-rank">#</th>
              <th>Player</th>
              <th class="col-num">P</th>
              <th class="col-num">W</th>
              <th class="col-num">D</th>
              <th class="col-num">L</th>
              <th class="col-num">Goals</th>
              <th class="col-num">GD</th>
              <th class="col-pts">PTS</th>
            </tr>
          </thead>
          <tbody>
            ${standingsRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Recent Fixtures (Styled after user design) -->
    <section class="glass-card">
      <div class="card-header">
        <h2 class="card-title">
          <span>📅</span>
          <span>Match Fixtures</span>
        </h2>
        <span class="pill">Latest</span>
      </div>
      <div class="fixtures-grid">
        ${fixturesHtml}
      </div>
    </section>

    <!-- Security-safe Footer -->
    <footer>
      eLeagueBot &bull; WhatsApp eFootball League Manager &bull; Keep-alive: <code>/health</code>
    </footer>

  </div>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`🌐 Web server & dashboard listening on port ${port}`);
    console.log(`   Health check URL: http://localhost:${port}/health`);
  });

  return server;
}

module.exports = {
  startWebServer,
  setLatestQr,
  setBotReady,
  setBotStatus,
};
