const http = require('http');
const LeagueService = require('./services/leagueService');
const PlayerRepo = require('./database/repositories/playerRepo');
const FixtureRepo = require('./database/repositories/fixtureRepo');
const SettingsRepo = require('./database/repositories/settingsRepo');

let latestQrDataUrl = null;
let latestPairingCode = null;
let whatsAppClientInstance = null;
let isBotAuthenticated = false;
let isBotReady = false;
let currentStatus = 'Initializing WhatsApp Web client in Chromium...';

function setWhatsAppClient(client) {
  whatsAppClientInstance = client;
}

function setLatestPairingCode(code) {
  latestPairingCode = code;
  currentStatus = `Pairing code generated: ${code}. Enter this code in WhatsApp on your phone.`;
}

function setLatestQr(qrString) {
  if (!qrString) {
    latestQrDataUrl = null;
    return;
  }
  latestQrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(qrString)}`;
  currentStatus = 'QR Code generated! Ready to scan with WhatsApp.';
}

function setBotAuthenticated(authenticated = true) {
  isBotAuthenticated = authenticated;
  if (authenticated) {
    latestQrDataUrl = null;
    latestPairingCode = null;
    currentStatus = 'WhatsApp connected & authenticated! Synchronizing league data...';
  }
}

function setBotReady(ready = true) {
  isBotReady = ready;
  if (ready) {
    isBotAuthenticated = true;
    latestQrDataUrl = null;
    latestPairingCode = null;
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
        botAuthenticated: isBotAuthenticated,
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

    // 2b. Request WhatsApp Pairing Code without Camera
    if (url.pathname === '/api/request-code') {
      const handleRequest = async (phoneNumber) => {
        try {
          if (!whatsAppClientInstance) {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('WhatsApp client is initializing. Please wait a few seconds and refresh.');
            return;
          }
          const code = await whatsAppClientInstance.requestPairingCode(phoneNumber);
          setLatestPairingCode(code);
          if (req.method === 'POST') {
            res.writeHead(302, { Location: '/?code_requested=1' });
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, code }));
          }
        } catch (err) {
          if (req.method === 'POST') {
            res.writeHead(302, { Location: '/?error=' + encodeURIComponent(err.message) });
            res.end();
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      };

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          const params = new URLSearchParams(body);
          const phone = params.get('phone') || process.env.INITIAL_ADMIN_PHONE || '2348154396451';
          await handleRequest(phone);
        });
      } else {
        const phone = url.searchParams.get('phone') || process.env.INITIAL_ADMIN_PHONE || '2348154396451';
        handleRequest(phone);
      }
      return;
    }

    // 2c. Silent Live Status Endpoint (replaces annoying full-page browser reloads)
    if (url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        isBotReady,
        isBotAuthenticated,
        latestQrDataUrl,
        latestPairingCode,
        currentStatus,
      }));
      return;
    }

    // 2d. Clean Session Reset Endpoint (wipes stale/conflicting auth session)
    if (url.pathname === '/api/reset-session') {
      try {
        if (whatsAppClientInstance) {
          whatsAppClientInstance.resetSession();
        }
        res.writeHead(302, { Location: '/?reset=1' });
        res.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 3. Figma-styled Frontend Dashboard
    if (url.pathname === '/') {
      let standings = [];
      let fixtures = [];
      let currentWeek = 1;
      let leagueName = 'eFootball League';

      const distinctLeagues = PlayerRepo.getDistinctLeagues();
      const activeLeagueId = url.searchParams.get('league') || (distinctLeagues.length > 0 ? distinctLeagues[0] : 'default');

      try {
        standings = LeagueService.getStandings(activeLeagueId);
        fixtures = FixtureRepo.getAll({ limit: 12 }, activeLeagueId);
        currentWeek = SettingsRepo.getInt('current_week', 1, activeLeagueId);
        leagueName = SettingsRepo.get('league_name', 'eFootball League', activeLeagueId);
      } catch (err) {
        // Fallback for fresh boot
      }

      // League Tabs if multiple leagues exist
      const leagueTabsHtml = distinctLeagues.length > 1 ? `
        <div class="league-tabs">
          ${distinctLeagues.map(lId => {
            const name = SettingsRepo.get('league_name', lId === 'default' ? 'Main League' : `League (${lId.slice(0, 8)})`, lId);
            const activeClass = lId === activeLeagueId ? 'active' : '';
            return `<a href="/?league=${encodeURIComponent(lId)}" class="league-tab ${activeClass}">🏆 ${name}</a>`;
          }).join('')}
        </div>
      ` : '';

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

      // Normalize admin phone for pairing default
      let rawPhone = process.env.INITIAL_ADMIN_PHONE || '08154396451';
      let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
        cleanPhone = '234' + cleanPhone.slice(1);
      }

      const pairingCardHtml = (!isBotReady && !isBotAuthenticated) ? `
        <div class="glass-card pairing-card" id="pairingContainer">
          <div class="pairing-header">
            <div class="badge-icon">🔢</div>
            <div>
              <h3>Link with Phone Number (No Camera Needed)</h3>
              <p>Camera overheated or unavailable? Generate an 8-character pairing code to link directly:</p>
            </div>
          </div>

          <div id="pairingError" class="pairing-error-box" style="display:none;"></div>

          ${latestPairingCode ? `
            <div class="code-box">
              <span class="code-eyebrow">YOUR WHATSAPP PAIRING CODE</span>
              <div class="code-display">${latestPairingCode}</div>
              <div class="code-guide">
                <ol>
                  <li>Open <strong>WhatsApp</strong> on your phone</li>
                  <li>Tap <strong>⋮ (Menu)</strong> &gt; <strong>Linked Devices</strong> &gt; <strong>Link a Device</strong></li>
                  <li>Tap <strong>Link with phone number instead</strong> at the bottom of the scanner screen</li>
                  <li>Enter the code: <strong>${latestPairingCode}</strong></li>
                </ol>
              </div>
              <form action="/api/request-code" method="POST" id="pairingRefreshForm" style="margin-top:10px;">
                <input type="hidden" name="phone" value="${cleanPhone}">
                <button type="submit" class="btn-refresh-code">🔄 Request New Code</button>
              </form>
            </div>
          ` : `
            <form action="/api/request-code" method="POST" id="pairingForm" class="pairing-form">
              <div class="input-group">
                <label for="phone">Your WhatsApp Number (international format):</label>
                <div class="input-row">
                  <input type="text" id="phone" name="phone" value="${cleanPhone}" placeholder="e.g. 2348154396451" required class="phone-input" />
                  <button type="submit" id="btnPair" class="btn-pair">Get 8-Digit Code</button>
                </div>
              </div>
            </form>
          `}
          <div style="margin-top: 16px; text-align: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;">
            <a href="/api/reset-session" onclick="return confirm('Clear any stale session files and restart WhatsApp fresh?')" class="btn-clean-reset">🔄 Clear Stale Session & Restart</a>
          </div>
        </div>
      ` : '';

      // QR Code / Connection Card
      let qrCardHtml = '';
      if (!isBotReady && !isBotAuthenticated && latestQrDataUrl) {
        qrCardHtml = `
          <div class="glass-card qr-card">
            <div class="qr-header">
              <div class="badge-icon">📲</div>
              <div>
                <h3>Link via QR Code</h3>
                <p>Open WhatsApp &gt; Linked Devices &gt; Link a Device and scan:</p>
              </div>
            </div>
            <div class="qr-img-wrapper">
              <img src="${latestQrDataUrl}" alt="WhatsApp Web QR Code" width="280" height="280" />
            </div>
            <div class="qr-footer">
              <span class="pulse-dot pulse-amber"></span> Scan with WhatsApp &bull; Auto-syncing
            </div>
          </div>
        `;
      } else if (!isBotReady && isBotAuthenticated) {
        qrCardHtml = `
          <div class="glass-card status-card connected-card">
            <div class="status-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>
            <div class="status-content">
              <h3>WhatsApp Linked Successfully</h3>
              <p class="status-msg">${currentStatus}</p>
              <div class="sync-hint">
                <span class="pulse-dot pulse-blue"></span> Session linked! You can now send <code>!help</code> or <code>!table</code> in your WhatsApp group.
              </div>
            </div>
          </div>
        `;
      } else if (!isBotReady) {
        qrCardHtml = `
          <div class="glass-card status-card">
            <div class="loader-spinner"></div>
            <div class="status-content">
              <h3>Connecting to WhatsApp Web...</h3>
              <p class="status-msg">${currentStatus}</p>
            </div>
          </div>
        `;
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${leagueName} &bull; Dashboard</title>
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

    .league-tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 4px 0;
    }

    .league-tab {
      padding: 8px 14px;
      border-radius: 12px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      transition: all 0.2s ease;
    }

    .league-tab:hover {
      background: #182236;
      color: var(--text-main);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .league-tab.active {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.4);
      color: var(--accent-blue);
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

    .status-badge.connected {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.3);
      color: #38BDF8;
    }

    .status-badge.qr-ready {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.3);
      color: #F59E0B;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
      animation: pulse 2s infinite;
    }

    .pulse-dot.pulse-blue {
      background: #38BDF8;
      box-shadow: 0 0 8px #38BDF8;
    }

    .pulse-dot.pulse-amber {
      background: #F59E0B;
      box-shadow: 0 0 8px #F59E0B;
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

    .status-card.connected-card {
      border-color: rgba(16, 185, 129, 0.25);
      background: rgba(16, 185, 129, 0.06);
    }

    .status-card.connected-card h3 {
      color: #34D399;
    }

    .status-icon-box {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .status-content {
      flex: 1;
    }

    .sync-hint {
      margin-top: 8px;
      font-size: 12px;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .sync-hint code {
      background: rgba(255, 255, 255, 0.08);
      padding: 1px 6px;
      border-radius: 4px;
      color: var(--accent-blue);
      font-family: var(--mono);
      font-size: 11px;
    }

    /* Alternative Pairing Card */
    .pairing-card {
      border: 1px solid rgba(56, 189, 248, 0.2);
      background: linear-gradient(180deg, #111A2E 0%, #0D1524 100%);
    }

    .pairing-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .pairing-header h3 {
      font-size: 16px;
      font-weight: 700;
      color: #F8FAFC;
    }

    .pairing-header p {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .pairing-error-box {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #F87171;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .code-box {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 14px;
      padding: 20px;
      text-align: center;
    }

    .code-eyebrow {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--accent-blue);
      letter-spacing: 0.08em;
      display: block;
    }

    .code-display {
      font-family: var(--mono);
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 0.18em;
      color: #38BDF8;
      margin: 14px 0;
      background: rgba(56, 189, 248, 0.12);
      padding: 12px 24px;
      border-radius: 12px;
      display: inline-block;
      border: 1px dashed rgba(56, 189, 248, 0.6);
      user-select: all;
    }

    .code-guide {
      text-align: left;
      font-size: 13px;
      color: var(--text-muted);
      margin: 12px 0 16px 0;
      background: rgba(255, 255, 255, 0.03);
      padding: 14px 18px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .code-guide ol {
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .code-guide strong {
      color: #F1F5F9;
    }

    .btn-refresh-code {
      display: inline-block;
      font-size: 12px;
      color: var(--accent-blue);
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      padding: 7px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }

    .pairing-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .input-group label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 6px;
      display: block;
    }

    .input-row {
      display: flex;
      gap: 10px;
    }

    .phone-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 10px 14px;
      color: #F8FAFC;
      font-family: var(--mono);
      font-size: 14px;
      outline: none;
    }

    .phone-input:focus {
      border-color: var(--accent-blue);
    }

    .btn-pair {
      background: #0284C7;
      color: white;
      border: none;
      border-radius: 10px;
      padding: 10px 18px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }

    .btn-pair:hover {
      background: #0369A1;
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

    /* Commands Cheatsheet Grid */
    .commands-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }

    .cmd-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 14px;
      background: #0B0F19;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
    }

    .cmd-item code {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--accent-blue);
      font-weight: 600;
    }

    .cmd-item span {
      font-size: 12px;
      color: var(--text-muted);
    }

    .btn-clean-reset {
      display: inline-block;
      font-size: 11px;
      color: var(--text-dim);
      text-decoration: none;
      padding: 5px 12px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: all 0.2s;
    }

    .btn-clean-reset:hover {
      color: #F8FAFC;
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
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
          : isBotAuthenticated
            ? `<span class="status-badge connected"><span class="pulse-dot pulse-blue"></span> Connected &bull; Syncing</span>`
            : latestQrDataUrl
              ? `<span class="status-badge qr-ready"><span class="pulse-dot pulse-amber"></span> Scan QR Code</span>`
              : `<span class="status-badge offline"><span class="pulse-dot"></span> Initializing</span>`
        }
      </div>
    </header>

    <!-- Multi-League Switcher Tabs -->
    ${leagueTabsHtml}

    <!-- QR Code / Connection Box -->
    ${qrCardHtml}

    <!-- Alternative: Link without Camera via 8-Digit Pairing Code -->
    ${pairingCardHtml}

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

    <!-- Quick Commands Guide for Group Members -->
    <section class="glass-card">
      <div class="card-header">
        <h2 class="card-title">
          <span>⚡</span>
          <span>WhatsApp Group Commands</span>
        </h2>
        <span class="pill">Cheatsheet</span>
      </div>
      <div class="commands-grid">
        <div class="cmd-item">
          <code>!table</code>
          <span>Display current league standings</span>
        </div>
        <div class="cmd-item">
          <code>!fixtures</code>
          <span>View upcoming &amp; past matches</span>
        </div>
        <div class="cmd-item">
          <code>!myfixtures</code>
          <span>View your personal matches &amp; deadlines</span>
        </div>
        <div class="cmd-item">
          <code>!result PlayerA 3-1 PlayerB</code>
          <span>Submit match score (or reply <code>3-1</code>)</span>
        </div>
        <div class="cmd-item">
          <code>📸 Send Photo + !result</code>
          <span>AI Vision automatically detects score</span>
        </div>
        <div class="cmd-item">
          <code>!help</code>
          <span>Display full guide in WhatsApp group</span>
        </div>
      </div>
    </section>

    <!-- Security-safe Footer -->
    <footer>
      eLeagueBot &bull; WhatsApp eFootball League Manager &bull; Keep-alive: <code>/health</code>
    </footer>

  </div>

  <script>
    (function() {
      // 1. Smooth AJAX WhatsApp Pairing Code Generator (NO whole-page refreshes)
      const pairingForm = document.getElementById('pairingForm');
      if (pairingForm) {
        pairingForm.addEventListener('submit', async function(e) {
          e.preventDefault();
          const phoneInput = document.getElementById('phone');
          const submitBtn = document.getElementById('btnPair');
          const pairingBox = document.getElementById('pairingContainer');
          const errorBox = document.getElementById('pairingError');
          
          const phone = phoneInput ? phoneInput.value.trim() : '';
          if (!phone) return;

          submitBtn.disabled = true;
          submitBtn.textContent = 'Generating Code...';
          if (errorBox) errorBox.style.display = 'none';

          try {
            const res = await fetch('/api/request-code?phone=' + encodeURIComponent(phone));
            const data = await res.json();
            if (data.success && data.code) {
              pairingBox.innerHTML = \`
                <div class="pairing-header">
                  <div class="badge-icon">🔢</div>
                  <div>
                    <h3>Link with Phone Number (No Camera Needed)</h3>
                    <p>Enter the code below in WhatsApp on your phone:</p>
                  </div>
                </div>
                <div class="code-box">
                  <span class="code-eyebrow">YOUR WHATSAPP PAIRING CODE</span>
                  <div class="code-display">\${data.code}</div>
                  <div class="code-guide">
                    <ol>
                      <li>Open <strong>WhatsApp</strong> on your phone</li>
                      <li>Tap <strong>⋮ (Menu)</strong> &gt; <strong>Linked Devices</strong> &gt; <strong>Link a Device</strong></li>
                      <li>Tap <strong>Link with phone number instead</strong> at the bottom of the scanner screen</li>
                      <li>Enter the code above: <strong>\${data.code}</strong></li>
                    </ol>
                  </div>
                  <button type="button" onclick="location.reload()" class="btn-refresh-code">🔄 Request New Code</button>
                </div>
              \`;
            } else {
              throw new Error(data.error || 'Failed to generate code');
            }
          } catch (err) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Get 8-Digit Code';
            if (errorBox) {
              errorBox.textContent = '⚠️ ' + err.message;
              errorBox.style.display = 'block';
            } else {
              alert('⚠️ ' + err.message);
            }
          }
        });
      }

      // 2. Silent Live Status Poller (Runs quietly in background without jarring page flicker)
      const initialReady = ${isBotReady};
      const initialAuth = ${isBotAuthenticated};

      setInterval(async () => {
        try {
          const res = await fetch('/api/status');
          const data = await res.json();

          // Update status message dynamically if present
          const statusMsgEl = document.querySelector('.status-msg');
          if (statusMsgEl && data.currentStatus) {
            statusMsgEl.textContent = data.currentStatus;
          }

          // If session state changed (e.g. user linked device or authenticated), reload once to update dashboard
          if (data.isBotReady !== initialReady || data.isBotAuthenticated !== initialAuth) {
            window.location.reload();
          }
        } catch (e) {
          // ignore background network blip
        }
      }, 4000);
    })();
  </script>
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
  setWhatsAppClient,
  setLatestQr,
  setLatestPairingCode,
  setBotAuthenticated,
  setBotReady,
  setBotStatus,
};
