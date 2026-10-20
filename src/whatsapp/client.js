const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const CommandHandler = require('../handlers/commandHandler');
const VisionService = require('../services/visionService');
const LeagueService = require('../services/leagueService');
const MessageFormatter = require('../services/messageFormatter');
const { setLatestQr, setBotAuthenticated, setBotReady, setBotStatus } = require('../server');

class WhatsAppClient {
  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: config.sessionDir,
      }),
      webVersionCache: {
        type: 'none',
      },
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
        ],
      },
    });

    this.isReady = false;
    this.isAuthenticated = false;
    this.setupListeners();
  }

  setupListeners() {
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading screen: ${percent}% - ${message}`);
      setBotStatus(`Loading WhatsApp Web: ${percent}% (${message || 'syncing'})...`);
      if (percent === 100) {
        setTimeout(() => {
          if (!this.isReady) {
            this.isReady = true;
            setBotReady(true);
          }
        }, 3000);
      }
    });

    this.client.on('qr', (qr) => {
      console.log('\n======================================================');
      console.log('⚡ WhatsApp Web QR Code generated. Scan with WhatsApp:');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
      setLatestQr(qr);
    });

    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp session authenticated successfully.');
      this.isAuthenticated = true;
      setBotAuthenticated(true);
      setBotStatus('Session authenticated! Syncing chats...');

      // State verification fallback
      setTimeout(async () => {
        try {
          if (!this.isReady) {
            const state = await this.client.getState();
            console.log(`ℹ️ Client state check: ${state}`);
            if (state === 'CONNECTED') {
              console.log('🚀 Client is CONNECTED! Marking ready.');
              this.isReady = true;
              setBotReady(true);
            }
          }
        } catch (e) {
          // ignore if state check not yet available
        }
      }, 10000);
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp authentication failure:', msg);
      setBotStatus(`Authentication failure: ${msg}. Please refresh to rescan.`);
    });

    this.client.on('ready', () => {
      this.isReady = true;
      this.isAuthenticated = true;
      setBotReady(true);
      console.log('🚀 eLeagueBot is online and listening for WhatsApp group commands!');
      if (VisionService.isEnabled()) {
        console.log('👁️ Google AI Studio Vision is active (post-match screenshots supported).');
      } else {
        console.log('ℹ️ Manual text entry active (set GEMINI_API_KEY to enable AI screenshot reading).');
      }
    });

    this.client.on('disconnected', (reason) => {
      this.isReady = false;
      this.isAuthenticated = false;
      setBotReady(false);
      console.warn('⚠️ WhatsApp client disconnected:', reason);
      setBotStatus(`Disconnected: ${reason}. Reinitializing...`);
      setTimeout(() => {
        this.client.initialize();
      }, 5000);
    });

    // 1. Listen for incoming messages from group members
    this.client.on('message', async (msg) => {
      const body = (msg.body || '').trim();
      const hasMedia = Boolean(msg.hasMedia);

      // Fast-filter: bot only processes messages addressed to it (! or /) or media submissions
      if (!body.startsWith('!') && !body.startsWith('/') && !hasMedia) {
        return; // Normal group conversation discarded immediately with ZERO memory overhead
      }

      if (!this.isReady) {
        this.isReady = true;
        setBotReady(true);
      }
      await this.handleIncomingMessage(msg);
    });

    // 2. Listen for messages sent from the bot's own linked phone (admin testing from own device)
    this.client.on('message_create', async (msg) => {
      if (msg.fromMe) {
        const body = (msg.body || '').trim();
        const hasMedia = Boolean(msg.hasMedia);
        if (body.startsWith('!') || body.startsWith('/') || hasMedia) {
          if (!this.isReady) {
            this.isReady = true;
            setBotReady(true);
          }
          await this.handleIncomingMessage(msg);
        }
      }
    });
  }

  async handleIncomingMessage(msg) {
    try {
      const body = (msg.body || '').trim();
      const hasMedia = Boolean(msg.hasMedia);

      // Guard check: only process bot commands or media
      if (!body.startsWith('!') && !body.startsWith('/') && !hasMedia) {
        return;
      }

      const chat = await msg.getChat();
      const isGroup = chat.isGroup;
      const groupId = isGroup ? chat.id._serialized : null;
      let senderId = msg.author || msg.from;
      if (msg.fromMe && !msg.author) {
        senderId = this.client.info?.wid?._serialized || (config.initialAdminPhone ? `${config.initialAdminPhone}@c.us` : msg.from);
      }

      if (msg.hasMedia) {
        const caption = body.trim().toLowerCase();
        if (caption.startsWith('!result') || caption.startsWith('!scan') || caption.startsWith('/result')) {
          if (!VisionService.isEnabled()) {
            const warnText = 'ℹ️ AI screenshot parsing is currently unconfigured. Please add `GEMINI_API_KEY` from Google AI Studio to `.env` or submit manually using `!result PlayerA 3-1 PlayerB`.';
            try { await msg.reply(warnText); } catch (e) { if (chat) await chat.sendMessage(warnText); }
            return;
          }

          const media = await msg.downloadMedia();
          if (media && media.mimetype && media.mimetype.startsWith('image/')) {
            try { await msg.reply('🔍 *Analyzing match screenshot via Google AI Studio...*'); } catch (e) {}
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
              try {
                await msg.reply(replyText);
              } catch (e) {
                if (chat) await chat.sendMessage(replyText);
              }
              return;
            } catch (err) {
              const errText = `⚠️ *Vision Error:* ${err.message}\n_You can submit the result manually:_ \`!result <Home> <Score> <Away>\``;
              try {
                await msg.reply(errText);
              } catch (e) {
                if (chat) await chat.sendMessage(errText);
              }
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
        try {
          await msg.reply(response);
        } catch (replyErr) {
          if (chat) {
            await chat.sendMessage(response);
          }
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  }

  async start() {
    console.log('Initializing WhatsApp Web client...');
    setBotStatus('Navigating to WhatsApp Web in Chromium...');
    try {
      await this.client.initialize();
    } catch (err) {
      console.error('Failed to initialize WhatsApp client:', err);
      setBotStatus(`Startup error: ${err.message}. Retrying...`);
      setTimeout(() => this.start(), 8000);
    }
  }

  async stop() {
    console.log('Shutting down WhatsApp Web client...');
    await this.client.destroy();
  }
}

module.exports = WhatsAppClient;
