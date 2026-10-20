process.env.NODE_ENV = 'test';
const assert = require('assert');
const { initDatabase } = require('../src/database/db');
const LeagueService = require('../src/services/leagueService');
const PlayerRepo = require('../src/database/repositories/playerRepo');
const FixtureRepo = require('../src/database/repositories/fixtureRepo');
const AdminRepo = require('../src/database/repositories/adminRepo');
const CommandHandler = require('../src/handlers/commandHandler');

async function runTests() {
  console.log('🧪 Running eLeagueBot League Core Unit & Integration Tests...');

  // 1. Initialize clean in-memory database
  initDatabase(':memory:');
  const adminId = 'admin@c.us';
  AdminRepo.addAdmin(adminId, 'Super Admin');

  // 2. Add 4 players
  console.log('  Testing Player Registration...');
  const p1 = LeagueService.addPlayer('Messi', '1111@c.us');
  const p2 = LeagueService.addPlayer('Ronaldo', '2222@c.us');
  const p3 = LeagueService.addPlayer('Neymar', '3333@c.us');
  const p4 = LeagueService.addPlayer('Mbappe', '4444@c.us');

  assert.strictEqual(PlayerRepo.countActive(), 4);
  console.log('  ✅ 4 Players successfully added.');

  // 3. Generate single round-robin fixtures
  console.log('  Testing Round-Robin Generation...');
  const genResult = LeagueService.generateFixtures(1);
  // With 4 players, total fixtures = 4 * 3 / 2 = 6 fixtures across 3 weeks
  assert.strictEqual(genResult.totalFixtures, 6);
  assert.strictEqual(genResult.totalWeeks, 3);
  console.log(`  ✅ Generated ${genResult.totalFixtures} fixtures across ${genResult.totalWeeks} weeks.`);

  // 4. Verify initial standings (all 0 played)
  console.log('  Testing Initial Standings...');
  let table = LeagueService.getStandings();
  assert.strictEqual(table.length, 4);
  assert.strictEqual(table[0].played, 0);
  assert.strictEqual(table[0].points, 0);
  console.log('  ✅ Initial table correctly zeroed.');

  // 5. Record match results
  console.log('  Testing Score Recording...');
  // Match 1: Messi vs Ronaldo 3-1
  const f1 = FixtureRepo.findPendingBetween(p1.id, p2.id);
  assert(f1 !== null, 'Fixture between Messi and Ronaldo should exist');
  
  const isMessiHome = f1.home_player_id === p1.id;
  LeagueService.recordResult({
    fixtureId: f1.id,
    scoreHome: isMessiHome ? 3 : 1,
    scoreAway: isMessiHome ? 1 : 3,
    senderId: adminId,
  });

  table = LeagueService.getStandings();
  const messiRow = table.find(r => r.name === 'Messi');
  const ronaldoRow = table.find(r => r.name === 'Ronaldo');
  assert.strictEqual(messiRow.won, 1);
  assert.strictEqual(messiRow.points, 3);
  assert.strictEqual(messiRow.goal_diff, 2);
  assert.strictEqual(ronaldoRow.lost, 1);
  assert.strictEqual(ronaldoRow.points, 0);
  assert.strictEqual(ronaldoRow.goal_diff, -2);
  console.log('  ✅ Score recording & points allocation verified.');

  // 6. Test Draw Match
  // Neymar vs Mbappe 2-2
  const f2 = FixtureRepo.findPendingBetween(p3.id, p4.id);
  LeagueService.recordResult({
    fixtureId: f2.id,
    scoreHome: 2,
    scoreAway: 2,
    senderId: adminId,
  });

  table = LeagueService.getStandings();
  const neymarRow = table.find(r => r.name === 'Neymar');
  const mbappeRow = table.find(r => r.name === 'Mbappe');
  assert.strictEqual(neymarRow.drawn, 1);
  assert.strictEqual(neymarRow.points, 1);
  assert.strictEqual(mbappeRow.drawn, 1);
  assert.strictEqual(mbappeRow.points, 1);
  console.log('  ✅ Draw points and goals properly credited.');

  // 7. Test Forfeit (3-0 walkover)
  console.log('  Testing Forfeit Logic...');
  const f3 = FixtureRepo.findPendingBetween(p1.id, p3.id);
  LeagueService.recordForfeit({
    fixtureId: f3.id,
    winnerName: 'Neymar',
    senderId: adminId,
  });

  const updatedF3 = FixtureRepo.findById(f3.id);
  assert.strictEqual(updatedF3.status, 'forfeited');
  table = LeagueService.getStandings();
  const neymarAfterForfeit = table.find(r => r.name === 'Neymar');
  assert.strictEqual(neymarAfterForfeit.won, 1);
  assert.strictEqual(neymarAfterForfeit.points, 4); // 1 from draw + 3 from forfeit
  console.log('  ✅ Forfeit successfully awarded 3-0 walkover.');

  // 8. Test Edit Result
  console.log('  Testing Result Edit & Deterministic Recalculation...');
  LeagueService.editResult(f1.id, 2, 2, adminId); // Change 3-1 to 2-2
  table = LeagueService.getStandings();
  const messiEdited = table.find(r => r.name === 'Messi');
  const ronaldoEdited = table.find(r => r.name === 'Ronaldo');
  assert.strictEqual(messiEdited.points, 1); // 2-2 draw gives 1 pt (forfeit vs Neymar was a loss)
  assert.strictEqual(ronaldoEdited.points, 1);
  console.log('  ✅ Table dynamically updated after editing historical result.');

  // 9. Test Revert Result
  console.log('  Testing Result Reversion...');
  LeagueService.revertResult(f1.id, adminId);
  const revertedF1 = FixtureRepo.findById(f1.id);
  assert.strictEqual(revertedF1.status, 'pending');
  assert.strictEqual(revertedF1.score_home, null);
  table = LeagueService.getStandings();
  const ronaldoReverted = table.find(r => r.name === 'Ronaldo');
  assert.strictEqual(ronaldoReverted.played, 0); // No played matches now
  console.log('  ✅ Reverting result restored fixture to pending without residue.');

  // 10. Test CommandHandler End-to-End
  console.log('  Testing CommandHandler string interface...');
  const tableMsg = await CommandHandler.handle({
    body: '!table',
    senderId: 'random_user@c.us',
    isGroup: true,
  });
  assert(tableMsg.includes('EFOOTBALL LEAGUE STANDINGS'), 'Table response should contain header');

  const fixMsg = await CommandHandler.handle({
    body: '!fixtures',
    senderId: 'random_user@c.us',
    isGroup: true,
  });
  assert(fixMsg.includes('WEEK 1'), 'Fixtures response should list weeks');

  const permDenied = await CommandHandler.handle({
    body: '!addplayer Hacker',
    senderId: 'random_user@c.us',
    isGroup: true,
  });
  assert(permDenied.includes('Permission denied'), 'Non-admin cannot add players');

  console.log('\n🎉 ALL LEAGUE CORE TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
