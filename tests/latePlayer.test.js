process.env.NODE_ENV = 'test';
const assert = require('assert');
const { initDatabase } = require('../src/database/db');
const LeagueService = require('../src/services/leagueService');
const PlayerRepo = require('../src/database/repositories/playerRepo');
const FixtureRepo = require('../src/database/repositories/fixtureRepo');
const SettingsRepo = require('../src/database/repositories/settingsRepo');
const AdminRepo = require('../src/database/repositories/adminRepo');

async function testLatePlayer() {
  console.log('🧪 Running Late-Joiner Mid-Season Scheduling Tests...');

  // Initialize clean database
  initDatabase(':memory:');
  const adminId = 'admin@c.us';
  AdminRepo.addAdmin(adminId, 'Super Admin');

  // 1. Setup initial 4 players
  const pA = LeagueService.addPlayer('Alpha');
  const pB = LeagueService.addPlayer('Bravo');
  const pC = LeagueService.addPlayer('Charlie');
  const pD = LeagueService.addPlayer('Delta');

  // 2. Generate fixtures
  LeagueService.generateFixtures(1);
  const initialFixtures = FixtureRepo.getAll();
  assert.strictEqual(initialFixtures.length, 6, 'Should have 6 initial fixtures');
  const initialFixtureIds = initialFixtures.map(f => f.id);

  // 3. Play Week 1 matches
  const alphaMatchW1 = FixtureRepo.findPendingBetween(pA.id, pB.id);
  assert(alphaMatchW1 !== null, 'Alpha vs Bravo match should exist');

  // Record: Alpha wins 2-1
  const isAlphaHome = alphaMatchW1.home_player_id === pA.id;
  LeagueService.recordResult({
    fixtureId: alphaMatchW1.id,
    scoreHome: isAlphaHome ? 2 : 1,
    scoreAway: isAlphaHome ? 1 : 2,
    senderId: adminId,
  });

  const standingsAfterW1 = LeagueService.getStandings();
  const alphaAfterW1 = standingsAfterW1.find(p => p.name === 'Alpha');
  assert.strictEqual(alphaAfterW1.points, 3);
  assert.strictEqual(alphaAfterW1.played, 1);

  // 4. Advance league to Week 2
  SettingsRepo.set('current_week', '2');

  // 5. Add Late Player "Echo" in Week 2
  console.log('  Adding late player Echo in Week 2...');
  const lateResult = LeagueService.addLatePlayer('Echo', '5555@c.us');
  assert.strictEqual(lateResult.createdFixturesCount, 4, 'Echo should have 4 matches (against Alpha, Bravo, Charlie, Delta)');
  assert.strictEqual(lateResult.currentWeek, 2);

  // 6. Verify that ALL original 6 fixtures remain untouched
  const allFixturesNow = FixtureRepo.getAll();
  assert.strictEqual(allFixturesNow.length, 10, 'Total fixtures should now be 6 + 4 = 10');

  for (const origId of initialFixtureIds) {
    const found = allFixturesNow.find(f => f.id === origId);
    assert(found !== undefined, `Original fixture #${origId} must still exist`);
  }

  // Verify the already played match is still played with identical score
  const playedMatch = FixtureRepo.findById(alphaMatchW1.id);
  assert.strictEqual(playedMatch.status, 'played');
  assert.strictEqual(isAlphaHome ? playedMatch.score_home : playedMatch.score_away, 2);
  assert.strictEqual(isAlphaHome ? playedMatch.score_away : playedMatch.score_home, 1);

  // 7. Verify Echo's matches are only slotted in remaining weeks (Week 2 and 3)
  const echoFixtures = FixtureRepo.findByPlayer(lateResult.player.id);
  assert.strictEqual(echoFixtures.length, 4);
  const echoOpponentIds = new Set();
  for (const ef of echoFixtures) {
    assert(ef.week >= 2, `Echo fixture #${ef.id} must be scheduled in Week 2 or later (actual: Week ${ef.week})`);
    const oppId = ef.home_player_id === lateResult.player.id ? ef.away_player_id : ef.home_player_id;
    echoOpponentIds.add(oppId);
  }
  assert.strictEqual(echoOpponentIds.size, 4, 'Echo must play all 4 unique existing players');

  // 8. Verify Table Standings Integrity
  const standingsWithLate = LeagueService.getStandings();
  assert.strictEqual(standingsWithLate.length, 5, 'Standings should now contain 5 players');
  const echoRow = standingsWithLate.find(p => p.name === 'Echo');
  assert.strictEqual(echoRow.played, 0);
  assert.strictEqual(echoRow.points, 0);

  // Alpha should still have 3 points from Week 1!
  const alphaRow = standingsWithLate.find(p => p.name === 'Alpha');
  assert.strictEqual(alphaRow.points, 3);
  assert.strictEqual(alphaRow.played, 1);
  assert.strictEqual(alphaRow.won, 1);

  // 9. Play a match involving the late player (Echo 2-0 Alpha)
  const echoVsAlpha = echoFixtures.find(f => f.home_player_id === pA.id || f.away_player_id === pA.id);
  const isEchoHome = echoVsAlpha.home_player_id === lateResult.player.id;
  LeagueService.recordResult({
    fixtureId: echoVsAlpha.id,
    scoreHome: isEchoHome ? 2 : 0,
    scoreAway: isEchoHome ? 0 : 2,
    senderId: adminId,
  });

  const updatedTable = LeagueService.getStandings();
  const echoUpdated = updatedTable.find(p => p.name === 'Echo');
  const alphaUpdated = updatedTable.find(p => p.name === 'Alpha');

  assert.strictEqual(echoUpdated.played, 1);
  assert.strictEqual(echoUpdated.won, 1);
  assert.strictEqual(echoUpdated.points, 3);
  assert.strictEqual(echoUpdated.goal_diff, 2);

  assert.strictEqual(alphaUpdated.played, 2);
  assert.strictEqual(alphaUpdated.won, 1);
  assert.strictEqual(alphaUpdated.lost, 1);
  assert.strictEqual(alphaUpdated.points, 3);
  assert.strictEqual(alphaUpdated.goal_diff, -1); // 2-1 win (+1) and 0-2 loss (-2) = -1 net GD

  console.log('  ✅ Late player mid-season integration verified with 100% fixture & table integrity!');
  console.log('\n🎉 ALL LATE-JOINER TESTS PASSED!\n');
}

testLatePlayer().catch(err => {
  console.error('❌ Late player test failed:', err);
  process.exit(1);
});
