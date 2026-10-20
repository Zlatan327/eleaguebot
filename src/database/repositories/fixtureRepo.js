const { getDatabase } = require('../db');

const FixtureRepo = {
  create(week, homePlayerId, awayPlayerId, deadline) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO fixtures (week, home_player_id, away_player_id, deadline, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    const info = stmt.run(week, homePlayerId, awayPlayerId, deadline);
    return this.findById(info.lastInsertRowid);
  },

  createBackfill(week, homePlayerId, awayPlayerId, scoreHome, scoreAway, playedAt = null) {
    const db = getDatabase();
    const deadline = playedAt || new Date().toISOString();
    const played = playedAt || new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO fixtures (week, home_player_id, away_player_id, score_home, score_away, status, deadline, played_at, is_backfill)
      VALUES (?, ?, ?, ?, ?, 'played', ?, ?, 1)
    `);
    const info = stmt.run(week, homePlayerId, awayPlayerId, scoreHome, scoreAway, deadline, played);
    return this.findById(info.lastInsertRowid);
  },

  bulkCreate(fixturesList) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO fixtures (week, home_player_id, away_player_id, deadline, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    const insertMany = db.transaction((list) => {
      const inserted = [];
      for (const f of list) {
        const info = stmt.run(f.week, f.home_player_id, f.away_player_id, f.deadline);
        inserted.push(info.lastInsertRowid);
      }
      return inserted;
    });
    return insertMany(fixturesList);
  },

  findById(id) {
    const db = getDatabase();
    return db.prepare(`
      SELECT f.*, 
             hp.name AS home_name, 
             ap.name AS away_name,
             hp.whatsapp_id AS home_whatsapp,
             ap.whatsapp_id AS away_whatsapp
      FROM fixtures f
      JOIN players hp ON f.home_player_id = hp.id
      JOIN players ap ON f.away_player_id = ap.id
      WHERE f.id = ?
    `).get(id);
  },

  findByWeek(week) {
    const db = getDatabase();
    return db.prepare(`
      SELECT f.*, 
             hp.name AS home_name, 
             ap.name AS away_name
      FROM fixtures f
      JOIN players hp ON f.home_player_id = hp.id
      JOIN players ap ON f.away_player_id = ap.id
      WHERE f.week = ?
      ORDER BY f.id ASC
    `).all(week);
  },

  findByPlayer(playerId, onlyPending = false) {
    const db = getDatabase();
    let sql = `
      SELECT f.*, 
             hp.name AS home_name, 
             ap.name AS away_name
      FROM fixtures f
      JOIN players hp ON f.home_player_id = hp.id
      JOIN players ap ON f.away_player_id = ap.id
      WHERE (f.home_player_id = ? OR f.away_player_id = ?)
    `;
    if (onlyPending) {
      sql += " AND f.status = 'pending'";
    }
    sql += ' ORDER BY f.week ASC, f.id ASC';
    return db.prepare(sql).all(playerId, playerId);
  },

  findPendingBetween(playerAId, playerBId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT f.*, 
             hp.name AS home_name, 
             ap.name AS away_name
      FROM fixtures f
      JOIN players hp ON f.home_player_id = hp.id
      JOIN players ap ON f.away_player_id = ap.id
      WHERE ((f.home_player_id = ? AND f.away_player_id = ?)
         OR (f.home_player_id = ? AND f.away_player_id = ?))
        AND f.status = 'pending'
      ORDER BY f.week ASC, f.id ASC
      LIMIT 1
    `).get(playerAId, playerBId, playerBId, playerAId);
  },

  updateResult(id, scoreHome, scoreAway, status = 'played') {
    const db = getDatabase();
    return db.prepare(`
      UPDATE fixtures 
      SET score_home = ?, score_away = ?, status = ?, played_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(scoreHome, scoreAway, status, id);
  },

  revertResult(id) {
    const db = getDatabase();
    return db.prepare(`
      UPDATE fixtures 
      SET score_home = NULL, score_away = NULL, status = 'pending', played_at = NULL
      WHERE id = ?
    `).run(id);
  },

  updateDeadline(id, newDeadline) {
    const db = getDatabase();
    return db.prepare('UPDATE fixtures SET deadline = ? WHERE id = ?').run(newDeadline, id);
  },

  getAll(options = {}) {
    const db = getDatabase();
    let sql = `
      SELECT f.*, 
             hp.name AS home_name, 
             ap.name AS away_name
      FROM fixtures f
      JOIN players hp ON f.home_player_id = hp.id
      JOIN players ap ON f.away_player_id = ap.id
    `;
    const conditions = [];
    const params = [];

    if (options.status) {
      conditions.push('f.status = ?');
      params.push(options.status);
    }
    if (options.week) {
      conditions.push('f.week = ?');
      params.push(options.week);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY f.week ASC, f.id ASC';
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    return db.prepare(sql).all(...params);
  },

  getMaxWeek() {
    const db = getDatabase();
    const row = db.prepare('SELECT MAX(week) as max_week FROM fixtures').get();
    return row && row.max_week ? row.max_week : 0;
  },

  hasFixtures() {
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as count FROM fixtures').get();
    return row.count > 0;
  },

  deleteAllFixtures() {
    const db = getDatabase();
    return db.prepare('DELETE FROM fixtures').run();
  }
};

module.exports = FixtureRepo;
