const { initDatabase } = require('./database/db');
const WhatsAppClient = require('./whatsapp/client');
const MockWhatsAppClient = require('./whatsapp/mockClient');
const { startWebServer } = require('./server');

async function main() {
  console.log('⚽ Starting eLeagueBot (eFootball League Manager)...');

  // Initialize SQLite database
  initDatabase();
  console.log('📦 Database initialized and ready.');

  // Check if running in CLI test mode or production WhatsApp mode
  const isCliMode = process.argv.includes('--cli') || process.argv.includes('-c');

  if (isCliMode) {
    console.log('🧪 Starting in interactive CLI test mode...');
    const mock = new MockWhatsAppClient();
    await mock.start();
  } else {
    // Start Web Server for Render / UptimeRobot health-checks & browser QR display
    const port = process.env.PORT || 3000;
    const { setWhatsAppClient } = require('./server');
    startWebServer(port);

    console.log('📱 Starting in WhatsApp Web mode...');
    const bot = new WhatsAppClient();
    setWhatsAppClient(bot);
    await bot.start();

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down bot gracefully...');
      await bot.stop();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
