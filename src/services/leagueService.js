const { getDatabase } = require('../database/db');
const PlayerRepo = require('../database/repositories/playerRepo');
const FixtureRepo = require('../database/repositories/fixtureRepo');
const SettingsRepo = require('../database/repositories/settingsRepo');
const AdminRepo = require('../database/repositories/adminRepo');
const FixtureGenerator = require('./fixtureGenerator');

const LeagueService = {
  /**
   * Dynamically calculates standings for a specific league/group.
   */
  getStandings(leagueId = 'default') {
    const players = PlayerRepo.getAllActive(leagueId);
    const fixtures = FixtureRepo.getAll({}, leagueId);
    const pointsWin = SettingsRepo.getInt('points_win', 3, leagueId);
    const pointsDraw = SettingsRepo.getInt('points_draw', 1, leagueId);
    const pointsLoss = SettingsRepo.getInt('points_loss', 0, leagueId);

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
        h2h: {},
      });
    }

    for (const f of fixtures) {
      if (f.status !== 'played' && f.status !== 'forfeited') continue;
      if (f.score_home === null || f.score_away === null) continue;

      const home = tableMap.get(f.home_player_id);
      const away = tableMap.get(f.away_player_id);

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
  recordResult({ fixtureId, homeName, awayName, scoreHome, scoreAway, senderId, leagueId = 'default' }) {
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
      const home = PlayerRepo.findByNameOrFuzzy(homeName, leagueId);
      const away = PlayerRepo.findByNameOrFuzzy(awayName, leagueId);

      if (!home) throw new Error(`Player '${homeName}' not found in this league.`);
      if (!away) throw new Error(`Player '${awayName}' not found in this league.`);

      fixture = FixtureRepo.findPendingBetween(home.id, away.id, leagueId);
      if (!fixture) {
        throw new Error(`No pending fixture found between ${home.name} and ${away.name}.`);
      }

      if (fixture.home_player_id === away.id && fixture.away_player_id === home.id) {
        const temp = scoreHome;
        scoreHome = scoreAway;
        scoreAway = temp;
      }
    } else {
      throw new Error('Must specify either a fixture ID or both player names.');
    }

    const isAdmin = AdminRepo.isAdmin(senderId);

    if (fixture.status === 'played' || fixture.status === 'forfeited') {
      if (!isAdmin) {
        throw new Error(`Match [#${fixture.id}] has already been recorded (${fixture.home_name} ${fixture.score_home} - ${fixture.score_away} ${fixture.away_name}). Ask an admin to !editresult.`);
      }
    }

    const policy = SettingsRepo.get('submission_policy', 'players_or_admin', leagueId);

    if (policy === 'admin_only' && !isAdmin) {
      throw new Error('Permission denied: Only league admins can record match results.');
    }

    if (policy === 'players_or_admin' && !isAdmin && senderId) {
      const senderPlayer = PlayerRepo.findByWhatsappId(senderId, leagueId);
      const isParticipant = senderPlayer && 
        (senderPlayer.id === fixture.home_player_id || senderPlayer.id === fixture.away_player_id);

      if (!isParticipant) {
        throw new Error('Permission denied: Only match participants or admins can submit this result.');
      }
    }

    FixtureRepo.updateResult(fixture.id, scoreHome, scoreAway, 'played');
    return FixtureRepo.findById(fixture.id);
  },

  recordForfeit({ fixtureId, winnerName, senderId, leagueId = 'default' }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can record forfeits.');
    }

    const fixture = FixtureRepo.findById(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture #${fixtureId} not found.`);
    }

    const winner = PlayerRepo.findByNameOrFuzzy(winnerName, leagueId);
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

  addPlayer(name, whatsappId = null, leagueId = 'default') {
    const existing = PlayerRepo.findByName(name, leagueId);
    if (existing) {
      if (!existing.active) {
        PlayerRepo.activatePlayer(existing.id);
        return existing;
      }
      throw new Error(`Player '${name}' already exists in this league.`);
    }
    return PlayerRepo.create(name, whatsappId, 1, leagueId);
  },

  addLatePlayer(name, whatsappId = null, leagueId = 'default') {
    const existing = PlayerRepo.findByName(name, leagueId);
    if (existing && existing.active) {
      throw new Error(`Player '${name}' is already in this league.`);
    }

    const currentWeek = SettingsRepo.getInt('current_week', 1, leagueId);
    const deadlineDays = SettingsRepo.getInt('deadline_days', 3, leagueId);
    const maxWeek = FixtureRepo.getMaxWeek(leagueId);
    const existingPlayers = PlayerRepo.getAllActive(leagueId);

    const latePlayer = existing ? existing : PlayerRepo.create(name, whatsappId, currentWeek, leagueId);

    let newFixtures = [];
    if (FixtureRepo.hasFixtures(leagueId)) {
      const generated = FixtureGenerator.generateLateJoinerFixtures(
        latePlayer,
        existingPlayers,
        currentWeek,
        maxWeek,
        deadlineDays
      );
      if (generated.length > 0) {
        generated.forEach(f => f.league_id = leagueId);
        FixtureRepo.bulkCreate(generated, leagueId);
        newFixtures = generated;
      }
    }

    return {
      player: latePlayer,
      createdFixturesCount: newFixtures.length,
      currentWeek,
    };
  },

  generateFixtures(rounds = 1, leagueId = 'default') {
    const players = PlayerRepo.getAllActive(leagueId);
    if (players.length < 2) {
      throw new Error('At least 2 active players are required to generate fixtures in this league.');
    }

    const deadlineDays = SettingsRepo.getInt('deadline_days', 3, leagueId);
    const fixtures = FixtureGenerator.generateRoundRobin(players, rounds, deadlineDays);
    fixtures.forEach(f => f.league_id = leagueId);

    FixtureRepo.deleteAllFixtures(leagueId);
    FixtureRepo.bulkCreate(fixtures, leagueId);
    SettingsRepo.set('league_status', 'active', leagueId);
    SettingsRepo.set('current_week', '1', leagueId);

    return {
      totalFixtures: fixtures.length,
      totalWeeks: FixtureRepo.getMaxWeek(leagueId),
      rounds,
    };
  },

  setPlayerBaseline({ name, played, won, drawn, lost, gf, ga, points, senderId, leagueId = 'default' }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can set player baselines.');
    }

    let player = PlayerRepo.findByNameOrFuzzy(name, leagueId);
    if (!player) {
      player = PlayerRepo.create(name, null, 1, leagueId);
    }

    const calculatedPoints = points !== undefined && points !== null
      ? points
      : (won * SettingsRepo.getInt('points_win', 3, leagueId) + drawn * SettingsRepo.getInt('points_draw', 1, leagueId));

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

  backfillMatch({ week, homeName, awayName, scoreHome, scoreAway, senderId, leagueId = 'default' }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can backfill historical matches.');
    }

    if (isNaN(scoreHome) || isNaN(scoreAway) || scoreHome < 0 || scoreAway < 0 || scoreHome > 50 || scoreAway > 50) {
      throw new Error('Scores must be integers between 0 and 50.');
    }

    let home = PlayerRepo.findByNameOrFuzzy(homeName, leagueId);
    if (!home) home = PlayerRepo.create(homeName, null, 1, leagueId);

    let away = PlayerRepo.findByNameOrFuzzy(awayName, leagueId);
    if (!away) away = PlayerRepo.create(awayName, null, 1, leagueId);

    const fixture = FixtureRepo.createBackfill(
      parseInt(week, 10) || 1,
      home.id,
      away.id,
      parseInt(scoreHome, 10),
      parseInt(scoreAway, 10),
      null,
      leagueId
    );

    return fixture;
  },

  importFixturesForWeek({ week, lines, senderId, leagueId = 'default' }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin) {
      throw new Error('Permission denied: Only admins can import fixtures.');
    }

    const targetWeek = parseInt(week, 10);
    if (isNaN(targetWeek) || targetWeek < 1) {
      throw new Error('Target week must be a positive integer.');
    }

    const deadlineDays = SettingsRepo.getInt('deadline_days', 3, leagueId);
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

      let home = PlayerRepo.findByNameOrFuzzy(homeName, leagueId);
      if (!home) home = PlayerRepo.create(homeName, null, 1, leagueId);

      let away = PlayerRepo.findByNameOrFuzzy(awayName, leagueId);
      if (!away) away = PlayerRepo.create(awayName, null, 1, leagueId);

      const f = FixtureRepo.create(targetWeek, home.id, away.id, deadline.toISOString(), leagueId);
      imported.push(f);
    }

    return imported;
  },

  linkPlayer({ name, whatsappId, senderId, leagueId = 'default' }) {
    const isAdmin = AdminRepo.isAdmin(senderId);
    if (!isAdmin && senderId !== whatsappId) {
      throw new Error('Permission denied: Only admins can link other users.');
    }

    const player = PlayerRepo.findByNameOrFuzzy(name, leagueId);
    if (!player) {
      throw new Error(`Player '${name}' not found in this league.`);
    }

    PlayerRepo.updateWhatsappId(player.id, whatsappId);
    return PlayerRepo.findById(player.id);
  }
};

module.exports = LeagueService;
