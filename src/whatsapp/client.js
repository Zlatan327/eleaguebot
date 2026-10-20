const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const CommandHandler = require('../handlers/commandHandler');
const VisionService = require('../services/visionService');
const LeagueService = require('../services/leagueService');
const MessageFormatter = require('../services/messageFormatter');
const { setLatestQr, setBotAuthenticated, setBotReady, setBotStatus } = require('../server');

const MODERN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class WhatsAppClient {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.isAuthenticated = false;
    this.isInitializing = false;
  }

  initClient() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: config.sessionDir,
      }),
      webVersionCache: {
        type: 'none',
      },
      userAgent: MODERN_USER_AGENT,
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--hide-scrollbars',
          '--mute-audio',
          `--user-agent=${MODERN_USER_AGENT}`,
          '--disable-blink-features=AutomationControlled',
          '--js-flags=--max-old-space-size=128',
          '--renderer-process-limit=1',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-domain-reliability',
          '--disable-features=AudioServiceOutOfProcess,Translate,BackForwardCache',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-sync',
          '--metrics-recording-only',
          '--no-default-browser-check',
        ],
      },
    });

    this.setupListeners();
  }

  setupListeners() {
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading screen: ${percent}% - ${message || ''}`);
      setBotStatus(`Loading WhatsApp Web: ${percent}% (${message || 'syncing'})...`);
    });

    this.client.on('qr', (qr) => {
      console.log('\n======================================================');
      console.log('⚡ WhatsApp Web QR Code generated. Scan with WhatsApp:');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });

      this.isReady = false;
      this.isAuthenticated = false;
      setBotReady(false);
      setBotAuthenticated(false);
      setLatestQr(qr);
    });

    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp session authenticated successfully.');
      this.isAuthenticated = true;
      setBotAuthenticated(true);
      setBotStatus('Session authenticated! Syncing chats with WhatsApp...');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp authentication failure:', msg);
      this.isReady = false;
      this.isAuthenticated = false;
      setBotReady(false);
      setBotAuthenticated(false);
      setLatestQr(null);
      setBotStatus(`Authentication failure: ${msg}. Click reset or refresh.`);
    });

    this.client.on('ready', () => {
      this.isReady = true;
      this.isAuthenticated = true;
      setBotReady(true);
      setBotAuthenticated(true);
      console.log('🚀 eLeagueBot is online and listening for WhatsApp group commands!');
      if (VisionService.isEnabled()) {
        console.log('👁️ Google AI Studio Vision is active (post-match screenshots supported).');
      } else {
        console.log('ℹ️ Manual text entry active (set GEMINI_API_KEY to enable AI screenshot reading).');
      }
    });

    this.client.on('disconnected', async (reason) => {
      console.warn('⚠️ WhatsApp client disconnected:', reason);
      this.isReady = false;
      this.isAuthenticated = false;
      setBotReady(false);
      setBotAuthenticated(false);
      setLatestQr(null);
      setBotStatus(`Disconnected: ${reason}. Restarting cleanly...`);

      try {
        await this.client.destroy();
      } catch (e) {}

      setTimeout(() => {
        this.start();
      }, 5000);
    });

    // 1. Listen for incoming messages from group members
    this.client.on('message', async (msg) => {
      await this.handleIncomingMessage(msg);
    });

    // 2. Listen for messages sent from the bot's own linked phone (admin testing from own device)
    this.client.on('message_create', async (msg) => {
      if (msg.fromMe) {
        await this.handleIncomingMessage(msg);
      }
    });
  }

  async handleIncomingMessage(msg) {
    try {
      let body = (msg.body || '').trim();
      const hasMedia = Boolean(msg.hasMedia);

      // Support common commands even if user forgets the leading '!' or '/'
      if (!body.startsWith('!') && !body.startsWith('/') && !hasMedia) {
        const lower = body.toLowerCase();
        if (lower === 'hlp' || lower === 'help' || lower === 'rules') {
          body = '!help';
        } else if (lower === 'table' || lower === 'standings') {
          body = '!table';
        } else if (lower === 'fixtures') {
          body = '!fixtures';
        } else if (lower === 'myfixtures') {
          body = '!myfixtures';
        }
      }

      const isCmd = body.startsWith('!') || body.startsWith('/');
      const isScore = /^\d+\s*[-:]\s*\d+$/.test(body);
      if (!isCmd && !hasMedia && !isScore) {
        return;
      }

      // Robust chat destination detection (works for both incoming & self-sent group messages)
      const destinationChatId = (msg.id && msg.id.remote) ? msg.id.remote : (msg.fromMe ? msg.to : msg.from);
      if (!destinationChatId) return;

      const isGroup = destinationChatId.endsWith('@g.us');
      const groupId = isGroup ? destinationChatId : null;

      let senderId = msg.author || msg.from;
      if (msg.fromMe) {
        senderId = this.client.info?.wid?._serialized || msg.from;
      }

      console.log(`📩 [CMD] Received: "${body}" from: ${senderId} in: ${destinationChatId}`);

      if (!this.isReady) {
        this.isReady = true;
        setBotReady(true);
      }

      if (hasMedia) {
        const caption = body.toLowerCase();
        if (caption.startsWith('!result') || caption.startsWith('!scan') || caption.startsWith('/result')) {
          if (!VisionService.isEnabled()) {
            const warnText = 'ℹ️ AI screenshot parsing is currently unconfigured. Please add `GEMINI_API_KEY` from Google AI Studio to `.env` or submit manually using `!result PlayerA 3-1 PlayerB`.';
            await this.client.sendMessage(destinationChatId, warnText);
            return;
          }

          const media = await msg.downloadMedia();
          if (media && media.mimetype && media.mimetype.startsWith('image/')) {
            try { await this.client.sendMessage(destinationChatId, '🔍 *Analyzing match screenshot via Google AI Studio...*'); } catch (e) {}
            try {
              const aiData = await VisionService.parseMatchScreenshot(media.data, media.mimetype);
              const leagueId = (isGroup && groupId) ? groupId : 'default';
              const updated = LeagueService.recordResult({
                homeName: aiData.home,
                awayName: aiData.away,
                scoreHome: aiData.home_score,
                scoreAway: aiData.away_score,
                senderId,
                leagueId,
              });

              const replyText = `📸 *Match Screenshot Recognized!*\n\n` +
                `*Detected:* ${aiData.home} ${aiData.home_score} - ${aiData.away_score} ${aiData.away_name}\n\n` +
                MessageFormatter.formatResultSaved(updated);
              await this.client.sendMessage(destinationChatId, replyText);
              return;
            } catch (err) {
              const errText = `⚠️ *Vision Error:* ${err.message}\n_You can submit the result manually:_ \`!result <Home> <Score> <Away>\``;
              await this.client.sendMessage(destinationChatId, errText);
              return;
            }
          }
        }
      }

      let quotedBody = null;
      if (msg.hasQuotedMsg) {
        try {
          const quoted = await msg.getQuotedMessage();
          quotedBody = quoted ? quoted.body : null;
        } catch (e) {}
      }

      const response = await CommandHandler.handle({
        body,
        senderId,
        groupId,
        isGroup,
        quotedBody,
      });

      if (response) {
        console.log(`📤 [REPLY] Sending response to ${destinationChatId}...`);
        try {
          await this.client.sendMessage(destinationChatId, response);
          console.log(`✅ [SENT] Successfully responded in ${destinationChatId}`);
        } catch (sendErr) {
          console.error(`❌ [SEND_ERROR] client.sendMessage failed:`, sendErr?.message || sendErr);
          try {
            await msg.reply(response);
          } catch (replyErr) {
            console.error(`❌ [FALLBACK_ERROR] msg.reply also failed:`, replyErr?.message || replyErr);
          }
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  }

  async start() {
    if (this.isInitializing) return;
    this.isInitializing = true;

    console.log('Initializing WhatsApp Web client...');
    setBotStatus('Navigating to WhatsApp Web in Chromium...');
    try {
      if (this.client) {
        try { await this.client.destroy(); } catch (e) {}
      }
      this.initClient();
      await this.client.initialize();
      this.isInitializing = false;
    } catch (err) {
      this.isInitializing = false;
      console.error('Failed to initialize WhatsApp client:', err);
      setBotStatus(`Startup error: ${err.message}. Retrying in 10s...`);
      setTimeout(() => this.start(), 10000);
    }
  }

  async resetSession() {
    try {
      this.isReady = false;
      this.isAuthenticated = false;
      setBotReady(false);
      setBotAuthenticated(false);
      setLatestQr(null);
      setBotStatus('Clearing session data and restarting client...');
      if (this.client) {
        await this.client.destroy();
      }
      const fs = require('fs');
      if (fs.existsSync(config.sessionDir)) {
        fs.rmSync(config.sessionDir, { recursive: true, force: true });
        console.log('🗑️ Deleted old session directory:', config.sessionDir);
      }
      setTimeout(() => this.start(), 2000);
    } catch (err) {
      console.error('Error resetting session:', err);
      setTimeout(() => this.start(), 3000);
    }
  }

  async stop() {
    console.log('Shutting down WhatsApp Web client...');
    if (this.client) {
      await this.client.destroy();
    }
  }
}

module.exports = WhatsAppClient;
