const readline = require('readline');
const CommandHandler = require('../handlers/commandHandler');
const AdminRepo = require('../database/repositories/adminRepo');

class MockWhatsAppClient {
  constructor() {
    this.currentSenderId = 'admin@c.us';
    this.currentGroupId = '12036302@g.us';
    this.isGroup = true;
  }

  async start() {
    // Ensure mock admin exists
    AdminRepo.addAdmin(this.currentSenderId, 'CLI Admin');

    console.log('\n======================================================');
    console.log('🎮 eLeagueBot Interactive CLI Test Harness');
    console.log('======================================================');
    console.log('Simulating WhatsApp Group: ' + this.currentGroupId);
    console.log('Current User: ' + this.currentSenderId + ' (Admin)');
    console.log('Type any bot command (e.g. !help, !addplayer Messi, !table)');
    console.log('Or type special commands:');
    console.log('  /as <id>       -> Switch sender (e.g. /as 1234567@c.us)');
    console.log('  /reply <text>  -> Simulate replying to a fixture');
    console.log('  exit           -> Quit CLI');
    console.log('======================================================\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'eLeagueBot> '
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        return;
      }

      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        rl.close();
        process.exit(0);
      }

      if (input.startsWith('/as ')) {
        this.currentSenderId = input.slice(4).trim();
        console.log(`[Switched current sender to: ${this.currentSenderId}]`);
        rl.prompt();
        return;
      }

      try {
        const response = await CommandHandler.handle({
          body: input,
          senderId: this.currentSenderId,
          groupId: this.currentGroupId,
          isGroup: this.isGroup,
        });

        if (response) {
          console.log('\n[WhatsApp Bot Reply]:\n' + response + '\n');
        } else {
          console.log('[No response or command ignored]');
        }
      } catch (err) {
        console.error('[Handler Error]:', err.message);
      }

      rl.prompt();
    });
  }
}

module.exports = MockWhatsAppClient;
