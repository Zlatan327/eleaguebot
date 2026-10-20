process.env.NODE_ENV = 'production'; // test security guards in production mode
process.env.ADMIN_SETUP_TOKEN = 'secret-test-token-123';

const assert = require('assert');
const { initDatabase } = require('../src/database/db');
const LeagueService = require('../src/services/leagueService');
const PlayerRepo = require('../src/database/repositories/playerRepo');
const FixtureRepo = require('../src/database/repositories/fixtureRepo');
const AdminRepo = require('../src/database/repositories/adminRepo');
const SettingsRepo = require('../src/database/repositories/settingsRepo');
const CommandHandler = require('../src/handlers/commandHandler');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSecurityAudit() {
  console.log('🛡️  Running eLeagueBot Security & Exploit Audit Tests...');

  initDatabase(':memory:');
  SettingsRepo.set('admin_setup_token', 'secret-test-token-123');

  const attackerId = 'attacker@c.us';
  const playerAId = 'playera@c.us';
  const playerBId = 'playerb@c.us';
  const strangerId = 'stranger@c.us';

  // 1. Exploit Check: Unauthenticated Admin Takeover in empty database
  console.log('  [Audit 1] Verifying that random group members cannot execute admin commands...');
  const resAttacker = await CommandHandler.handle({
    body: '!generatefixtures',
    senderId: attackerId,
    isGroup: true,
  });
  assert(resAttacker && resAttacker.includes('Permission denied'), 'Attacker should be blocked from admin commands');
  console.log('  ✅ Unauthenticated admin commands blocked.');

  // 2. Exploit Check: Claiming admin with incorrect or empty token
  console.log('  [Audit 2] Verifying !claimadmin token security...');
  await sleep(2100); // wait for cooldown
  const resBadToken = await CommandHandler.handle({
    body: '!claimadmin wrong-token',
    senderId: attackerId,
    isGroup: true,
  });
  assert(resBadToken.includes('Invalid setup token'), 'Wrong token should be rejected');
  assert.strictEqual(AdminRepo.isAdmin(attackerId), false);

  // Claim with valid token
  await sleep(2100);
  const resGoodToken = await CommandHandler.handle({
    body: '!claimadmin secret-test-token-123',
    senderId: 'legit_admin@c.us',
    isGroup: true,
  });
  assert(resGoodToken.includes('Admin privileges successfully granted'), 'Valid token must grant admin');
  assert.strictEqual(AdminRepo.isAdmin('legit_admin@c.us'), true);
  console.log('  ✅ Admin claim token authenticated securely.');

  // 3. Exploit Check: Malicious Name Injection (breaking WhatsApp tables)
  console.log('  [Audit 3] Verifying player name input sanitization...');
  assert.throws(() => {
    LeagueService.addPlayer('A'.repeat(25)); // over 20 chars
  }, /cannot exceed 20 characters/);

  assert.throws(() => {
    LeagueService.addPlayer('X'); // under 2 chars
  }, /at least 2 characters/);

  const cleanPlayer = LeagueService.addPlayer('  Lionel  Messi \n ', playerAId);
  assert.strictEqual(cleanPlayer.name, 'Lionel Messi', 'Newlines and extra spaces must be sanitized');
  console.log('  ✅ Malformed and long names sanitized & rejected.');

  // Setup second player
  const pB = LeagueService.addPlayer('Ronaldo', playerBId);
  const adminId = 'legit_admin@c.us';

  // Generate 1 fixture
  await sleep(100);
  LeagueService.generateFixtures(1);
  const fixture = FixtureRepo.getAll()[0];

  // 4. Exploit Check: Stranger trying to submit scores for other players
  console.log('  [Audit 4] Verifying participant authorization on score submission...');
  assert.throws(() => {
    LeagueService.recordResult({
      fixtureId: fixture.id,
      scoreHome: 3,
      scoreAway: 0,
      senderId: strangerId,
    });
  }, /Only match participants or admins can submit/);
  console.log('  ✅ Strangers blocked from submitting match scores.');

  // 5. Exploit Check: Player A submits result, then Player B tries to tamper/overwrite!
  console.log('  [Audit 5] Verifying anti-tamper lock on completed matches...');
  // Player A submits legitimate 2-1
  LeagueService.recordResult({
    fixtureId: fixture.id,
    scoreHome: fixture.home_player_id === cleanPlayer.id ? 2 : 1,
    scoreAway: fixture.home_player_id === cleanPlayer.id ? 1 : 2,
    senderId: playerAId,
  });

  // Player B tries to overwrite with 0-3 afterwards
  assert.throws(() => {
    LeagueService.recordResult({
      fixtureId: fixture.id,
      scoreHome: fixture.home_player_id === cleanPlayer.id ? 0 : 3,
      scoreAway: fixture.home_player_id === cleanPlayer.id ? 3 : 0,
      senderId: playerBId,
    });
  }, /has already been recorded.*Ask an admin to !editresult/);
  console.log('  ✅ Completed matches cannot be overwritten by players.');

  // 6. Exploit Check: Extreme and Negative Scores
  console.log('  [Audit 6] Verifying score range boundaries...');
  assert.throws(() => {
    LeagueService.recordResult({
      fixtureId: fixture.id,
      scoreHome: 999,
      scoreAway: 0,
      senderId: adminId,
    });
  }, /Scores must be integers between 0 and 50/);

  assert.throws(() => {
    LeagueService.recordResult({
      fixtureId: fixture.id,
      scoreHome: -1,
      scoreAway: 2,
      senderId: adminId,
    });
  }, /Scores must be integers between 0 and 50/);
  console.log('  ✅ Unrealistic scores and negative numbers rejected.');

  // 7. Exploit Check: Multi-Group Bleed & Group Lockdown
  console.log('  [Audit 7] Verifying group lockdown isolation...');
  SettingsRepo.set('league_group_id', 'authorized_group@g.us');

  const rogueGroupMsg = await CommandHandler.handle({
    body: '!table',
    senderId: 'anyone@c.us',
    groupId: 'rogue_group@g.us',
    isGroup: true,
  });
  assert.strictEqual(rogueGroupMsg, null, 'Bot must ignore commands from non-authorized group');

  const authGroupMsg = await CommandHandler.handle({
    body: '!table',
    senderId: 'member_in_group@c.us',
    groupId: 'authorized_group@g.us',
    isGroup: true,
  });
  assert(authGroupMsg !== null && authGroupMsg.includes('EFOOTBALL LEAGUE'), 'Bot must answer in authorized group');
  console.log('  ✅ Group isolation and lockdown verified.');

  console.log('\n🎉 ALL SECURITY & EXPLOIT AUDIT TESTS PASSED WITH 100% SUCCESS!\n');
}

runSecurityAudit().catch(err => {
  console.error('❌ Security audit failed:', err);
  process.exit(1);
});
