const http = require('http');
const LeagueService = require('./services/leagueService');
const SettingsRepo = require('./database/repositories/settingsRepo');

let latestQrDataUrl = null;
let isBotReady = false;
let currentStatus = 'Launching WhatsApp Web client and starting Chromium...';

function setLatestQr(qrString) {
  latestQrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrString)}`;
  currentStatus = 'QR Code generated! Ready to scan with your phone.';
}

function setBotReady(ready = true) {
  isBotReady = ready;
  if (ready) {
    latestQrDataUrl = null;
    currentStatus = 'WhatsApp Bot is ONLINE and listening to group commands.';
  }
}

function setBotStatus(statusText) {
  currentStatus = statusText;
}

function startWebServer(port = process.env.PORT || 3000) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Health check endpoint for Render / UptimeRobot keep-alive
    if (url.pathname === '/health' || url.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        botReady: isBotReady,
        currentStatus,
        hasQr: Boolean(latestQrDataUrl),
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // JSON Standings API
    if (url.pathname === '/api/standings') {
      try {
        const standings = LeagueService.getStandings();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(standings));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Main HTML Dashboard
    if (url.pathname === '/') {
      let standingsHtml = '';
      try {
        const standings = LeagueService.getStandings();
        const currentWeek = SettingsRepo.getInt('current_week', 1);

        standingsHtml = `
          <h2>🏆 League Standings (Week ${currentWeek})</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>P</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF</th>
                <th>GA</th>
                <th>GD</th>
                <th>PTS</th>
              </tr>
            </thead>
            <tbody>
              ${standings.map((s, idx) => `
                <tr>
                  <td><strong>${idx + 1}</strong></td>
                  <td>${s.name}</td>
                  <td>${s.played}</td>
                  <td>${s.won}</td>
                  <td>${s.drawn}</td>
                  <td>${s.lost}</td>
                  <td>${s.goals_for}</td>
                  <td>${s.goals_against}</td>
                  <td>${s.goal_diff > 0 ? '+' + s.goal_diff : s.goal_diff}</td>
                  <td><strong>${s.points}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } catch (err) {
        standingsHtml = `<p>Standings not initialized yet.</p>`;
      }

      let qrHtml = '';
      if (!isBotReady && latestQrDataUrl) {
        qrHtml = `
          <div class="qr-container">
            <h3>📱 Scan with WhatsApp to Link Bot</h3>
            <p>Open WhatsApp &gt; Linked Devices &gt; Link a Device:</p>
            <img src="${latestQrDataUrl}" alt="WhatsApp QR Code" width="300" height="300" />
            <p><small>Scan this QR code with your WhatsApp app on your phone</small></p>
          </div>
        `;
      } else if (!isBotReady) {
        qrHtml = `
          <div class="status-box waiting">
            ⏳ <strong>Status:</strong> ${currentStatus}<br/>
            <small style="opacity: 0.8;">Chromium is loading WhatsApp Web on Render. This usually takes 30–60 seconds on first boot.</small>
          </div>
        `;
      } else {
        qrHtml = `
          <div class="status-box online">
            ✅ WhatsApp Bot is <strong>ONLINE</strong> and listening to group commands.
          </div>
        `;
      }

      // Faster auto-refresh (6s) while waiting for QR, slower (30s) once online
      const refreshInterval = !isBotReady ? 6 : 30;

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>eLeagueBot - eFootball League Manager</title>
  <meta http-equiv="refresh" content="${refreshInterval}">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 800px; margin: 0 auto; background: #1e293b; padding: 24px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); }
    h1 { color: #38bdf8; margin-top: 0; display: flex; align-items: center; gap: 8px; }
    .status-box { padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; font-size: 15px; line-height: 1.5; }
    .status-box.online { background: #065f46; color: #34d399; }
    .status-box.waiting { background: #78350f; color: #fef08a; border: 1px solid #b45309; }
    .qr-container { text-align: center; background: #0f172a; padding: 20px; border-radius: 8px; margin-bottom: 24px; }
    .qr-container img { border: 8px solid white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th, td { padding: 10px 12px; text-align: center; border-bottom: 1px solid #334155; }
    th:nth-child(2), td:nth-child(2) { text-align: left; }
    th { background: #334155; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 12px; }
    tr:hover { background: #243248; }
    footer { margin-top: 24px; text-align: center; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚽ eLeagueBot Dashboard</h1>
    ${qrHtml}
    ${standingsHtml}
    <footer>eLeagueBot &bull; Keep-alive endpoint: <code>/health</code> &bull; Auto-refreshing every ${refreshInterval}s</footer>
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
