process.env.NODE_ENV = 'test';
const assert = require('assert');
const { initDatabase } = require('../src/database/db');
const LeagueService = require('../src/services/leagueService');
const FixtureRepo = require('../src/database/repositories/fixtureRepo');
const AdminRepo = require('../src/database/repositories/adminRepo');
const CommandHandler = require('../src/handlers/commandHandler');

async function testOngoingLeagueOnboarding() {
  console.log('🧪 Running Ongoing League Onboarding Tests...');

  // Initialize clean database
  initDatabase(':memory:');
  const adminId = 'admin@c.us';
  AdminRepo.addAdmin(adminId, 'Super Admin');

  // Scenario: A league is already in Week 4.
  // 1. Bulk import an existing table from Week 3 standings using !importtable
  console.log('  Testing !importtable bulk onboarding...');
  const tableImportText = 
`!importtable
Messi 3 3 0 0 9 2 9
Ronaldo 3 2 0 1 6 4 6
Neymar 3 1 1 1 4 4 4
Mbappe 3 0 1 2 2 7 1`;

  const importResponse = await CommandHandler.handle({
    body: tableImportText,
    senderId: adminId,
    isGroup: true,
  });

  assert(importResponse.includes('*4 players*'), 'Should report 4 players imported');

  // Verify baseline standings
  let standings = LeagueService.getStandings();
  assert.strictEqual(standings.length, 4);
  assert.strictEqual(standings[0].name, 'Messi');
  assert.strictEqual(standings[0].points, 9);
  assert.strictEqual(standings[0].played, 3);
  assert.strictEqual(standings[0].goal_diff, 7);

  assert.strictEqual(standings[3].name, 'Mbappe');
  assert.strictEqual(standings[3].points, 1);
  assert.strictEqual(standings[3].played, 3);
  assert.strictEqual(standings[3].goal_diff, -5);
  console.log('  ✅ Baseline table imported and verified with 100% precision.');

  // 2. Test backfilling an unrecorded historical match from Week 3
  console.log('  Testing historical match backfill...');
  await CommandHandler.handle({
    body: '!backfill 3 Neymar 3-1 Mbappe',
    senderId: adminId,
    isGroup: true,
  });

  const backfilledFixtures = FixtureRepo.findByWeek(3);
  assert.strictEqual(backfilledFixtures.length, 1);
  assert.strictEqual(backfilledFixtures[0].status, 'played');
  assert.strictEqual(backfilledFixtures[0].score_home, 3);
  assert.strictEqual(backfilledFixtures[0].score_away, 1);
  console.log('  ✅ Historical match backfill recorded.');

  // 3. Test importing remaining scheduled fixtures for Week 4
  console.log('  Testing !importfixtures for Week 4...');
  const fixturesImportText = 
`!importfixtures 4
Messi vs Ronaldo
Neymar vs Mbappe`;

  const fixResponse = await CommandHandler.handle({
    body: fixturesImportText,
    senderId: adminId,
    isGroup: true,
  });

  assert(fixResponse.includes('2 Fixtures Imported for Week 4'), 'Should report 2 fixtures imported');
  const week4Fixtures = FixtureRepo.findByWeek(4);
  assert.strictEqual(week4Fixtures.length, 2);
  assert.strictEqual(week4Fixtures[0].status, 'pending');
  console.log('  ✅ Upcoming fixtures imported into Week 4.');

  // 4. Play a Week 4 match and verify it stacks on top of baseline!
  console.log('  Testing live match result stacking on top of baseline...');
  // Messi vs Ronaldo in Week 4: Ronaldo wins 2-1
  const messiVsRonaldoW4 = week4Fixtures.find(f => 
    (f.home_name === 'Messi' && f.away_name === 'Ronaldo') || 
    (f.home_name === 'Ronaldo' && f.away_name === 'Messi')
  );

  const isRonaldoHome = messiVsRonaldoW4.home_name === 'Ronaldo';
  LeagueService.recordResult({
    fixtureId: messiVsRonaldoW4.id,
    scoreHome: isRonaldoHome ? 2 : 1,
    scoreAway: isRonaldoHome ? 1 : 2,
    senderId: adminId,
  });

  standings = LeagueService.getStandings();
  const messiAfter = standings.find(p => p.name === 'Messi');
  const ronaldoAfter = standings.find(p => p.name === 'Ronaldo');

  // Messi: baseline (P:3, W:3, D:0, L:0, GF:9, GA:2, PTS:9) + Week 4 Loss (P:1, L:1, GF:1, GA:2)
  // Total: P:4, W:3, D:0, L:1, GF:10, GA:4, GD:+6, PTS:9
  assert.strictEqual(messiAfter.played, 4);
  assert.strictEqual(messiAfter.won, 3);
  assert.strictEqual(messiAfter.lost, 1);
  assert.strictEqual(messiAfter.goals_for, 10);
  assert.strictEqual(messiAfter.goals_against, 4);
  assert.strictEqual(messiAfter.points, 9);

  // Ronaldo: baseline (P:3, W:2, D:0, L:1, GF:6, GA:4, PTS:6) + Week 4 Win (P:1, W:1, GF:2, GA:1, PTS:3)
  // Total: P:4, W:3, D:0, L:1, GF:8, GA:5, GD:+3, PTS:9
  assert.strictEqual(ronaldoAfter.played, 4);
  assert.strictEqual(ronaldoAfter.won, 3);
  assert.strictEqual(ronaldoAfter.points, 9);
  assert.strictEqual(ronaldoAfter.goals_for, 8);
  assert.strictEqual(ronaldoAfter.goals_against, 5);

  console.log('  ✅ Live results seamlessly stack onto ongoing league baselines!');
  console.log('\n🎉 ALL ONGOING LEAGUE ONBOARDING TESTS PASSED!\n');
}

testOngoingLeagueOnboarding().catch(err => {
  console.error('❌ Ongoing league test failed:', err);
  process.exit(1);
});
