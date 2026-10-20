process.env.NODE_ENV = 'test';
const assert = require('assert');
const { initDatabase } = require('../src/database/db');
const LeagueService = require('../src/services/leagueService');
const PlayerRepo = require('../src/database/repositories/playerRepo');
const FixtureRepo = require('../src/database/repositories/fixtureRepo');
const AdminRepo = require('../src/database/repositories/adminRepo');
const SettingsRepo = require('../src/database/repositories/settingsRepo');
const CommandHandler = require('../src/handlers/commandHandler');

async function testMultiGroupLeagues() {
  console.log('🧪 Running Multi-Group Independent League Tests...');

  initDatabase(':memory:');
  const adminId = 'admin@c.us';
  AdminRepo.addAdmin(adminId, 'Super Admin');

  const group1 = '120363001@g.us'; // Group 1
  const group2 = '120363002@g.us'; // Group 2

  // 1. Group 1: Set custom league name & add players
  console.log('  Setting up Group 1 League (Premier League)...');
  await CommandHandler.handle({
    body: '!setleaguename Premier League',
    senderId: adminId,
    groupId: group1,
    isGroup: true,
  });

  await CommandHandler.handle({
    body: '!addplayer Messi',
    senderId: adminId,
    groupId: group1,
    isGroup: true,
  });

  await CommandHandler.handle({
    body: '!addplayer Ronaldo',
    senderId: adminId,
    groupId: group1,
    isGroup: true,
  });

  // Generate fixtures in Group 1
  await CommandHandler.handle({
    body: '!generatefixtures 1',
    senderId: adminId,
    groupId: group1,
    isGroup: true,
  });

  assert.strictEqual(PlayerRepo.countActive(group1), 2, 'Group 1 should have 2 players');

  // 2. Group 2: Set completely different league name & add players
  console.log('  Setting up Group 2 League (Sunday Cup)...');
  await CommandHandler.handle({
    body: '!setleaguename Sunday Cup',
    senderId: adminId,
    groupId: group2,
    isGroup: true,
  });

  await CommandHandler.handle({
    body: '!addplayer Haaland',
    senderId: adminId,
    groupId: group2,
    isGroup: true,
  });

  await CommandHandler.handle({
    body: '!addplayer Mbappe',
    senderId: adminId,
    groupId: group2,
    isGroup: true,
  });

  // Player with same name in Group 2 should be allowed without collision
  await CommandHandler.handle({
    body: '!addplayer Messi',
    senderId: adminId,
    groupId: group2,
    isGroup: true,
  });

  assert.strictEqual(PlayerRepo.countActive(group2), 3, 'Group 2 should have 3 players');
  assert.strictEqual(PlayerRepo.countActive(group1), 2, 'Group 1 should still have 2 players');

  // Generate fixtures in Group 2
  await CommandHandler.handle({
    body: '!generatefixtures 1',
    senderId: adminId,
    groupId: group2,
    isGroup: true,
  });

  // 3. Play a match in Group 1: Messi 3-1 Ronaldo
  console.log('  Recording match in Group 1...');
  await CommandHandler.handle({
    body: '!result Messi 3-1 Ronaldo',
    senderId: adminId,
    groupId: group1,
    isGroup: true,
  });

  // 4. Play a match in Group 2: Haaland 2-0 Mbappe
  console.log('  Recording match in Group 2...');
  await CommandHandler.handle({
    body: '!result Haaland 2-0 Mbappe',
    senderId: adminId,
    groupId: group2,
    isGroup: true,
  });

  // 5. Verify Table 1 (Group 1)
  console.log('  Verifying Group 1 Table isolation...');
  const table1Msg = await CommandHandler.handle({
    body: '!table',
    senderId: 'user1@c.us',
    groupId: group1,
    isGroup: true,
  });

  assert(table1Msg.includes('PREMIER LEAGUE STANDINGS'), 'Group 1 must display Premier League');
  assert(table1Msg.includes('Messi') && table1Msg.includes('Ronaldo'), 'Group 1 must list Messi and Ronaldo');
  assert(!table1Msg.includes('Haaland'), 'Group 1 must NOT contain Group 2 player Haaland');

  const standings1 = LeagueService.getStandings(group1);
  assert.strictEqual(standings1[0].name, 'Messi');
  assert.strictEqual(standings1[0].points, 3);
  assert.strictEqual(standings1[1].name, 'Ronaldo');
  assert.strictEqual(standings1[1].points, 0);

  // 6. Verify Table 2 (Group 2)
  console.log('  Verifying Group 2 Table isolation...');
  const table2Msg = await CommandHandler.handle({
    body: '!table',
    senderId: 'user2@c.us',
    groupId: group2,
    isGroup: true,
  });

  assert(table2Msg.includes('SUNDAY CUP STANDINGS'), 'Group 2 must display Sunday Cup');
  assert(table2Msg.includes('Haaland') && table2Msg.includes('Mbappe'), 'Group 2 must list Haaland and Mbappe');
  
  const standings2 = LeagueService.getStandings(group2);
  const haaland = standings2.find(p => p.name === 'Haaland');
  const mbappe = standings2.find(p => p.name === 'Mbappe');
  const messiG2 = standings2.find(p => p.name === 'Messi');

  assert.strictEqual(haaland.points, 3);
  assert.strictEqual(mbappe.points, 0);
  assert.strictEqual(messiG2.points, 0); // unplayed in Group 2

  // 7. Verify Distinct Leagues detection for Web Dashboard
  const leagues = PlayerRepo.getDistinctLeagues();
  assert(leagues.includes(group1), 'Should detect group1 league');
  assert(leagues.includes(group2), 'Should detect group2 league');

  console.log('\n🎉 ALL MULTI-GROUP INDEPENDENT LEAGUE TESTS PASSED!\n');
}

testMultiGroupLeagues().catch(err => {
  console.error('❌ Multi-group test failed:', err);
  process.exit(1);
});
