const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const CommandHandler = require('../handlers/commandHandler');
const VisionService = require('../services/visionService');
const LeagueService = require('../services/leagueService');
const MessageFormatter = require('../services/messageFormatter');
const { setLatestQr, setBotReady, setBotStatus } = require('../server');

class WhatsAppClient {
  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: config.sessionDir,
      }),
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
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
          '--disable-gpu',
        ],
      },
    });

    this.isReady = false;
    this.setupListeners();
  }

  setupListeners() {
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading screen: ${percent}% - ${message}`);
      setBotStatus(`Loading WhatsApp Web: ${percent}% (${message || 'initializing'})...`);
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
      setBotStatus('Session authenticated! Syncing chats...');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp authentication failure:', msg);
      setBotStatus(`Authentication failure: ${msg}. Please refresh to rescan.`);
    });

    this.client.on('ready', () => {
      this.isReady = true;
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
      setBotReady(false);
      console.warn('⚠️ WhatsApp client disconnected:', reason);
      setBotStatus(`Disconnected: ${reason}. Reinitializing...`);
      setTimeout(() => {
        this.client.initialize();
      }, 5000);
    });

    this.client.on('message', async (msg) => {
      await this.handleIncomingMessage(msg);
    });
  }

  async handleIncomingMessage(msg) {
    try {
      const chat = await msg.getChat();
      const isGroup = chat.isGroup;
      const groupId = isGroup ? chat.id._serialized : null;
      const senderId = msg.author || msg.from;
      const body = msg.body || '';

      if (msg.hasMedia) {
        const caption = body.trim().toLowerCase();
        if (caption.startsWith('!result') || caption.startsWith('!scan') || caption.startsWith('/result')) {
          if (!VisionService.isEnabled()) {
            await msg.reply('ℹ️ AI screenshot parsing is currently unconfigured. Please add `GEMINI_API_KEY` from Google AI Studio to `.env` or submit manually using `!result PlayerA 3-1 PlayerB`.');
            return;
          }

          const media = await msg.downloadMedia();
          if (media && media.mimetype && media.mimetype.startsWith('image/')) {
            await msg.reply('🔍 *Analyzing match screenshot via Google AI Studio...*');
            try {
              const aiData = await VisionService.parseMatchScreenshot(media.data, media.mimetype);
              const updated = LeagueService.recordResult({
                homeName: aiData.home,
                awayName: aiData.away,
                scoreHome: aiData.home_score,
                scoreAway: aiData.away_score,
                senderId,
              });

              await msg.reply(
                `📸 *Match Screenshot Recognized!*\n\n` +
                `*Detected:* ${aiData.home} ${aiData.home_score} - ${aiData.away_score} ${aiData.away_name}\n\n` +
                MessageFormatter.formatResultSaved(updated)
              );
              return;
            } catch (err) {
              await msg.reply(`⚠️ *Vision Error:* ${err.message}\n_You can submit the result manually:_ \`!result <Home> <Score> <Away>\``);
              return;
            }
          }
        }
      }

      let quotedBody = null;
      if (msg.hasQuotedMsg) {
        const quoted = await msg.getQuotedMessage();
        quotedBody = quoted ? quoted.body : null;
      }

      const response = await CommandHandler.handle({
        body,
        senderId,
        groupId,
        isGroup,
        quotedBody,
      });

      if (response) {
        await msg.reply(response);
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
