const { getDatabase } = require('../database/db');
const PlayerRepo = require('../database/repositories/playerRepo');
const FixtureRepo = require('../database/repositories/fixtureRepo');
const SettingsRepo = require('../database/repositories/settingsRepo');
const AdminRepo = require('../database/repositories/adminRepo');
const FixtureGenerator = require('./fixtureGenerator');

const LeagueService = {
  /**
   * Dynamically calculates standings from player baselines PLUS played & forfeited fixtures.
   * Deterministic, immune to race conditions, and handles standard football tie-breakers.
   */
  getStandings() {
    const players = PlayerRepo.getAllActive();
    const fixtures = FixtureRepo.getAll();
    const pointsWin = SettingsRepo.getInt('points_win', 3);
    const pointsDraw = SettingsRepo.getInt('points_draw', 1);
    const pointsLoss = SettingsRepo.getInt('points_loss', 0);

    // Initialize stats map seeded with baseline stats (for ongoing league entry)
    const tableMap = new Map();
    for (const p of players) {
      tableMap.set(p.id, {
        id: p.id,
        name: p.name,
        whatsapp_id: p.whatsapp_id,
        played: p.baseline_played || 0,
        won: p.baseline_won || 0,
        drawn: p.baseline_drawn || 0,
        lost: p.baseline_lost || 0,
        goals_for: p.baseline_gf || 0,
        goals_against: p.baseline_ga || 0,
        goal_diff: (p.baseline_gf || 0) - (p.baseline_ga || 0),
        points: p.baseline_points || 0,
        h2h: {}, // [opponentId]: points against opponent
      });
    }

    // Process completed and forfeited fixtures
    for (const f of fixtures) {
      if (f.status !== 'played' && f.status !== 'forfeited') continue;
      if (f.score_home === null || f.score_away === null) continue;

      const home = tableMap.get(f.home_player_id);
      const away = tableMap.get(f.away_player_id);

      // If a player was deactivated, still compute if present
      if (!home || !away) continue;

      home.played += 1;
      away.played += 1;
      home.goals_for += f.score_home;
      home.goals_against += f.score_away;
      away.goals_for += f.score_away;
      away.goals_against += f.score_home;

      if (!home.h2h[away.id]) home.h2h[away.id] = 0;
      if (!away.h2h[home.id]) away.h2h[home.id] = 0;

      if (f.score_home > f.score_away) {
        home.won += 1;
        home.points += pointsWin;
        home.h2h[away.id] += pointsWin;

        away.lost += 1;
        away.points += pointsLoss;
      } else if (f.score_away > f.score_home) {
        away.won += 1;
        away.points += pointsWin;
        away.h2h[home.id] += pointsWin;

        home.lost += 1;
        home.points += pointsLoss;
      } else {
        home.drawn += 1;
        away.drawn += 1;
        home.points += pointsDraw;
        away.points += pointsDraw;
        home.h2h[away.id] += pointsDraw;
        away.h2h[home.id] += pointsDraw;
      }
    }

    const standings = Array.from(tableMap.values()).map(entry => {
      entry.goal_diff = entry.goals_for - entry.goals_against;
      return entry;
    });

    // Sort using standard league tiebreakers:
    // 1. Points
    // 2. Goal Difference
    // 3. Goals For
    // 4. Head-to-Head points
    // 5. Total Wins
    // 6. Name
    standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
      if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;

      const aH2H = a.h2h[b.id] || 0;
      const bH2H = b.h2h[a.id] || 0;
      if (bH2H !== aH2H) return bH2H - aH2H;

      if (b.won !== a.won) return b.won - a.won;
      return a.name.localeCompare(b.name);
    });

    return standings;
  },

  /**
   * Records a match result safely with validation and anti-tampering guards.
   */
  recordResult({ fixtureId, homeName, awayName, scoreHome, scoreAway, senderId }) {
    if (isNaN(scoreHome) || isNaN(scoreAway) || scoreHome < 0 || scoreAway < 0 || scoreHome > 50 || scoreAway > 50) {
      throw new Error('Scores must be integers between 0 and 50 (e.g. 3-1).');
    }

    let fixture = null;

    if (fixtureId) {
      fixture = FixtureRepo.findById(fixtureId);
      if (!fixture) {
        throw new Error(`Fixture #${fixtureId} not found.`);
      }
    } else if (homeName && awayName) {
      const home = PlayerRepo.findByNameOrFuzzy(homeName);
      const away = PlayerRepo.findByNameOrFuzzy(awayName);

      if (!home) throw new Error(`Player '${homeName}' not found.`);
      if (!away) throw new Error(`Player '${awayName}' not found.`);

      fixture = FixtureRepo.findPendingBetween(home.id, away.id);
      if (!fixture) {
        throw new Error(`No pending fixture found between ${home.name} and ${away.name}.`);
      }

      // If user typed away first, normalize score to fixture orientation
      if (fixture.home_player_id === away.id && fixture.away_player_id === home.id) {
        const temp = scoreHome;
        scoreHome = scoreAway;
        scoreAway = temp;
      }
    } else {
      throw new Error('Must specify either a fixture ID or both player names.');
    }

    const isAdmin = AdminRepo.isAdmin(senderId);

    // ANTI-EXPLOIT GUARD: If match is already played, prevent players from overwriting!
    if (fixture.status === 'played' || fixture.status === 'forfeited') {
      if (!isAdmin) {
        throw new Error(`Match [#${fixture.id}] has already been recorded (${fixture.home_name} ${fixture.score_home} - ${fixture.score_away} ${fixture.away_name}). Ask an admin to !editresult.`);
      }
    }

    // Permission check
    const policy = SettingsRepo.get('submission_policy', 'players_or_admin');

    if (policy === 'admin_only' && !isAdmin) {
      throw new Error('Permission denied: Only league admins can record match results.');
    }

    if (policy === 'players_or_admin' && !isAdmin && senderId) {
      const senderPlayer = PlayerRepo.findByWhatsappId(senderId);
      const isParticipant = senderPlayer && 
        (senderPlayer.id === fixture.home_player_id || senderPlayer.id === fixture.away_player_id);

      if (!isParticipant) {
        throw new Error('Permission denied: Only match participants or admins can submit this result.');
      }
    }

    FixtureRepo.updateResult(fixture.id, scoreHome, scoreAway, 'played');
    return FixtureRepo.findById(fixture.id);
  },

  /**
   * Forfeit a match as a 3-0 walkover win.
   */
  recordForfeit({ fixtureId, winnerName, senderId }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can record forfeits.');
    }

    const fixture = FixtureRepo.findById(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture #${fixtureId} not found.`);
    }

    const winner = PlayerRepo.findByNameOrFuzzy(winnerName);
    if (!winner) {
      throw new Error(`Player '${winnerName}' not found.`);
    }

    let scoreHome = 0;
    let scoreAway = 0;

    if (fixture.home_player_id === winner.id) {
      scoreHome = 3;
      scoreAway = 0;
    } else if (fixture.away_player_id === winner.id) {
      scoreHome = 0;
      scoreAway = 3;
    } else {
      throw new Error(`Winner '${winner.name}' is not part of Fixture #${fixture.id} (${fixture.home_name} vs ${fixture.away_name}).`);
    }

    FixtureRepo.updateResult(fixture.id, scoreHome, scoreAway, 'forfeited');
    return FixtureRepo.findById(fixture.id);
  },

  /**
   * Revert a previously played/forfeited match back to pending.
   */
  revertResult(fixtureId, senderId) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can revert results.');
    }

    const fixture = FixtureRepo.findById(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture #${fixtureId} not found.`);
    }

    FixtureRepo.revertResult(fixture.id);
    return FixtureRepo.findById(fixture.id);
  },

  /**
   * Edit a previously recorded result.
   */
  editResult(fixtureId, scoreHome, scoreAway, senderId) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can edit past results.');
    }

    if (isNaN(scoreHome) || isNaN(scoreAway) || scoreHome < 0 || scoreAway < 0 || scoreHome > 50 || scoreAway > 50) {
      throw new Error('Scores must be integers between 0 and 50.');
    }

    const fixture = FixtureRepo.findById(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture #${fixtureId} not found.`);
    }

    FixtureRepo.updateResult(fixture.id, scoreHome, scoreAway, 'played');
    return FixtureRepo.findById(fixture.id);
  },

  /**
   * Add a player before season kickoff.
   */
  addPlayer(name, whatsappId = null) {
    const existing = PlayerRepo.findByName(name);
    if (existing) {
      if (!existing.active) {
        PlayerRepo.activatePlayer(existing.id);
        return existing;
      }
      throw new Error(`Player '${name}' already exists.`);
    }
    return PlayerRepo.create(name, whatsappId, 1);
  },

  /**
   * Late joiner integration: adds player mid-season and slots remaining matches
   * without modifying any existing results or scheduled matches.
   */
  addLatePlayer(name, whatsappId = null) {
    const existing = PlayerRepo.findByName(name);
    if (existing && existing.active) {
      throw new Error(`Player '${name}' is already in the league.`);
    }

    const currentWeek = SettingsRepo.getInt('current_week', 1);
    const deadlineDays = SettingsRepo.getInt('deadline_days', 3);
    const maxWeek = FixtureRepo.getMaxWeek();
    const existingPlayers = PlayerRepo.getAllActive();

    const latePlayer = existing ? existing : PlayerRepo.create(name, whatsappId, currentWeek);

    let newFixtures = [];
    if (FixtureRepo.hasFixtures()) {
      const generated = FixtureGenerator.generateLateJoinerFixtures(
        latePlayer,
        existingPlayers,
        currentWeek,
        maxWeek,
        deadlineDays
      );
      if (generated.length > 0) {
        FixtureRepo.bulkCreate(generated);
        newFixtures = generated;
      }
    }

    return {
      player: latePlayer,
      createdFixturesCount: newFixtures.length,
      currentWeek,
    };
  },

  /**
   * Generate initial round-robin fixtures.
   */
  generateFixtures(rounds = 1) {
    const players = PlayerRepo.getAllActive();
    if (players.length < 2) {
      throw new Error('At least 2 active players are required to generate fixtures.');
    }

    const deadlineDays = SettingsRepo.getInt('deadline_days', 3);
    const fixtures = FixtureGenerator.generateRoundRobin(players, rounds, deadlineDays);

    FixtureRepo.deleteAllFixtures();
    FixtureRepo.bulkCreate(fixtures);
    SettingsRepo.set('league_status', 'active');
    SettingsRepo.set('current_week', '1');

    return {
      totalFixtures: fixtures.length,
      totalWeeks: FixtureRepo.getMaxWeek(),
      rounds,
    };
  },

  // =========================================================================
  // ONGOING LEAGUE ONBOARDING & MIGRATION METHODS
  // =========================================================================

  /**
   * Sets baseline statistics for an existing player (for leagues already underway).
   */
  setPlayerBaseline({ name, played, won, drawn, lost, gf, ga, points, senderId }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can set player baselines.');
    }

    let player = PlayerRepo.findByNameOrFuzzy(name);
    if (!player) {
      // Auto-create player if not found
      player = PlayerRepo.create(name, null, 1);
    }

    // Auto-calculate points if omitted
    const calculatedPoints = points !== undefined && points !== null
      ? points
      : (won * SettingsRepo.getInt('points_win', 3) + drawn * SettingsRepo.getInt('points_draw', 1));

    PlayerRepo.setBaseline(player.id, {
      played: parseInt(played, 10) || 0,
      won: parseInt(won, 10) || 0,
      drawn: parseInt(drawn, 10) || 0,
      lost: parseInt(lost, 10) || 0,
      gf: parseInt(gf, 10) || 0,
      ga: parseInt(ga, 10) || 0,
      points: parseInt(calculatedPoints, 10) || 0,
    });

    return PlayerRepo.findById(player.id);
  },

  /**
   * Backfills a historically played match from prior weeks into the database.
   */
  backfillMatch({ week, homeName, awayName, scoreHome, scoreAway, senderId }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can backfill historical matches.');
    }

    if (isNaN(scoreHome) || isNaN(scoreAway) || scoreHome < 0 || scoreAway < 0 || scoreHome > 50 || scoreAway > 50) {
      throw new Error('Scores must be integers between 0 and 50.');
    }

    let home = PlayerRepo.findByNameOrFuzzy(homeName);
    if (!home) home = PlayerRepo.create(homeName, null, 1);

    let away = PlayerRepo.findByNameOrFuzzy(awayName);
    if (!away) away = PlayerRepo.create(awayName, null, 1);

    const fixture = FixtureRepo.createBackfill(
      parseInt(week, 10) || 1,
      home.id,
      away.id,
      parseInt(scoreHome, 10),
      parseInt(scoreAway, 10)
    );

    return fixture;
  },

  /**
   * Imports a batch of scheduled fixtures for a given week.
   * e.g. "Messi vs Ronaldo\nNeymar vs Mbappe"
   */
  importFixturesForWeek({ week, lines, senderId }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can import fixtures.');
    }

    const targetWeek = parseInt(week, 10);
    if (isNaN(targetWeek) || targetWeek < 1) {
      throw new Error('Target week must be a positive integer.');
    }

    const deadlineDays = SettingsRepo.getInt('deadline_days', 3);
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadlineDays);

    const imported = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const parts = line.split(/\s+(?:vs|v|-)\s+/i);
      if (parts.length !== 2) continue;

      const homeName = parts[0].trim();
      const awayName = parts[1].trim();

      let home = PlayerRepo.findByNameOrFuzzy(homeName);
      if (!home) home = PlayerRepo.create(homeName, null, 1);

      let away = PlayerRepo.findByNameOrFuzzy(awayName);
      if (!away) away = PlayerRepo.create(awayName, null, 1);

      const f = FixtureRepo.create(targetWeek, home.id, away.id, deadline.toISOString());
      imported.push(f);
    }

    return imported;
  },

  /**
   * Links a WhatsApp JID or phone number to a player name
   */
  linkPlayer({ name, whatsappId, senderId }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin && senderId !== whatsappId) {
      throw new Error('Permission denied: Only admins can link other users.');
    }

    const player = PlayerRepo.findByNameOrFuzzy(name);
    if (!player) {
      throw new Error(`Player '${name}' not found.`);
    }

    PlayerRepo.updateWhatsappId(player.id, whatsappId);
    return PlayerRepo.findById(player.id);
  }
};

module.exports = LeagueService;
