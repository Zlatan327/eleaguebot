const SettingsRepo = require('../database/repositories/settingsRepo');
const FixtureRepo = require('../database/repositories/fixtureRepo');

/**
 * Fisher-Yates array shuffle
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Calculate future ISO timestamp given days from base date
 */
function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const FixtureGenerator = {
  /**
   * Generates a complete round-robin tournament for an array of active players.
   * Uses Berger tables / polygon rotation.
   * 
   * @param {Array<Object>} players - List of active player objects
   * @param {number} rounds - 1 for single round-robin, 2 for home & away
   * @param {number} deadlineDays - Duration for each week's deadline
   * @returns {Array<Object>} Fixture definitions ready for insertion
   */
  generateRoundRobin(players, rounds = 1, deadlineDays = 3) {
    if (!players || players.length < 2) {
      throw new Error('At least 2 players are required to generate fixtures.');
    }

    const shuffled = shuffle(players);
    const n = shuffled.length;
    const isOdd = n % 2 !== 0;
    const playerPool = [...shuffled];
    
    // Add dummy player for BYE if odd
    if (isOdd) {
      playerPool.push(null);
    }

    const totalParticipants = playerPool.length;
    const roundsPerCycle = totalParticipants - 1;
    const matchesPerRound = totalParticipants / 2;
    const generatedFixtures = [];
    const now = new Date();

    let currentWeekNumber = 1;

    for (let cycle = 0; cycle < rounds; cycle++) {
      // Rotation state
      const rotation = [...playerPool];

      for (let r = 0; r < roundsPerCycle; r++) {
        const week = currentWeekNumber;
        const weekDeadline = addDays(now, week * deadlineDays);

        for (let m = 0; m < matchesPerRound; m++) {
          const home = rotation[m];
          const away = rotation[totalParticipants - 1 - m];

          // Skip if either is BYE
          if (!home || !away) continue;

          // Alternate home and away to equalize advantages
          let homePlayerId = home.id;
          let awayPlayerId = away.id;

          if ((r % 2 === 1 && m === 0) || (cycle % 2 === 1)) {
            // Swap home and away
            homePlayerId = away.id;
            awayPlayerId = home.id;
          }

          generatedFixtures.push({
            week,
            home_player_id: homePlayerId,
            away_player_id: awayPlayerId,
            deadline: weekDeadline,
          });
        }

        // Rotate elements, keeping first element fixed (Berger algorithm)
        const fixed = rotation[0];
        const rest = rotation.slice(1);
        const last = rest.pop();
        rest.unshift(last);
        rotation[0] = fixed;
        for (let i = 0; i < rest.length; i++) {
          rotation[i + 1] = rest[i];
        }

        currentWeekNumber++;
      }
    }

    return generatedFixtures;
  },

  /**
   * Safely adds fixtures for a late-joining player without modifying any existing matches.
   * 
   * @param {Object} latePlayer - The newly registered player
   * @param {Array<Object>} existingPlayers - Array of active players already in the league
   * @param {number} currentWeek - Current active week
   * @param {number} maxWeek - Highest scheduled week in the league
   * @param {number} deadlineDays - Configured days per match
   * @returns {Array<Object>} Newly generated fixtures to be inserted
   */
  generateLateJoinerFixtures(latePlayer, existingPlayers, currentWeek = 1, maxWeek = 1, deadlineDays = 3) {
    if (!existingPlayers || existingPlayers.length === 0) {
      return [];
    }

    // Filter out late player themselves if accidentally included
    const opponents = existingPlayers.filter(p => p.id !== latePlayer.id && p.active === 1);
    if (opponents.length === 0) return [];

    // Shuffle opponents for fair fixture ordering
    const shuffledOpponents = shuffle(opponents);

    // Determine target weeks
    // Remaining weeks start from currentWeek through maxWeek
    const effectiveMaxWeek = Math.max(maxWeek, currentWeek);
    const remainingWeeks = [];
    for (let w = currentWeek; w <= effectiveMaxWeek; w++) {
      remainingWeeks.push(w);
    }

    const newFixtures = [];
    const now = new Date();

    // Slot fixtures across remaining weeks
    shuffledOpponents.forEach((opponent, index) => {
      // Pick a week cycling through remaining weeks
      const targetWeek = remainingWeeks[index % remainingWeeks.length];
      
      // Calculate a safe deadline:
      // Must be at least `now + deadlineDays`, or target week's natural deadline
      const daysAhead = Math.max(1, (targetWeek - currentWeek + 1)) * deadlineDays;
      const deadline = addDays(now, daysAhead);

      // Alternate home and away
      const isHome = index % 2 === 0;

      newFixtures.push({
        week: targetWeek,
        home_player_id: isHome ? latePlayer.id : opponent.id,
        away_player_id: isHome ? opponent.id : latePlayer.id,
        deadline,
      });
    });

    return newFixtures;
  }
};

module.exports = FixtureGenerator;
