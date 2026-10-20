const { getDatabase } = require('../db');

function normalizeId(id) {
  if (!id) return '';
  // Strip WhatsApp domain (@c.us, @s.whatsapp.net) and multi-device device indices (:1, :2)
  const phonePart = String(id).split('@')[0].split(':')[0];
  let digits = phonePart.replace(/[^0-9]/g, '');
  if (digits.startsWith('0') && digits.length === 11) {
    digits = '234' + digits.slice(1);
  }
  return digits;
}

function sanitizeName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Player name must be a valid non-empty string.');
  }
  const clean = name.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < 2) {
    throw new Error('Player name must be at least 2 characters long.');
  }
  if (clean.length > 20) {
    throw new Error('Player name cannot exceed 20 characters.');
  }
  return clean;
}

const PlayerRepo = {
  create(name, whatsappId = null, joinedWeek = 1, leagueId = 'default') {
    const cleanName = sanitizeName(name);
    const cleanId = whatsappId ? whatsappId.trim() : null;
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT INTO players (name, whatsapp_id, joined_week, active, league_id)
      VALUES (?, ?, ?, 1, ?)
    `);
    const info = stmt.run(cleanName, cleanId, joinedWeek, leagueId);
    return this.findById(info.lastInsertRowid);
  },

  findById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  },

  findByName(name, leagueId = 'default') {
    if (!name) return null;
    const db = getDatabase();
    const clean = name.trim().toLowerCase();
    return db.prepare(`
      SELECT * FROM players 
      WHERE LOWER(name) = ? AND league_id = ?
    `).get(clean, leagueId);
  },

  findByWhatsappId(whatsappId, leagueId = 'default') {
    if (!whatsappId) return null;
    const db = getDatabase();
    const norm = normalizeId(whatsappId);
    return db.prepare(`
      SELECT * FROM players 
      WHERE (whatsapp_id = ? 
         OR REPLACE(REPLACE(whatsapp_id, '@c.us', ''), '@s.whatsapp.net', '') = ?)
        AND league_id = ?
    `).get(whatsappId, norm, leagueId);
  },

  findByNameOrFuzzy(query, leagueId = 'default') {
    if (!query) return null;
    const direct = this.findByName(query, leagueId);
    if (direct) return direct;

    const db = getDatabase();
    const clean = query.trim().toLowerCase();
    const matches = db.prepare(`
      SELECT * FROM players 
      WHERE LOWER(name) LIKE ? AND active = 1 AND league_id = ?
    `).all(`%${clean}%`, leagueId);

    if (matches.length === 1) {
      return matches[0];
    }
    return null;
  },

  getAllActive(leagueId = 'default') {
    const db = getDatabase();
    return db.prepare('SELECT * FROM players WHERE active = 1 AND league_id = ? ORDER BY id ASC').all(leagueId);
  },

  getAll(leagueId = 'default') {
    const db = getDatabase();
    return db.prepare('SELECT * FROM players WHERE league_id = ? ORDER BY id ASC').all(leagueId);
  },

  deactivate(idOrName, leagueId = 'default') {
    const db = getDatabase();
    if (typeof idOrName === 'number') {
      return db.prepare('UPDATE players SET active = 0 WHERE id = ?').run(idOrName);
    }
    return db.prepare(`
      UPDATE players SET active = 0 
      WHERE LOWER(name) = ? AND league_id = ?
    `).run(idOrName.trim().toLowerCase(), leagueId);
  },

  activatePlayer(id) {
    const db = getDatabase();
    return db.prepare('UPDATE players SET active = 1 WHERE id = ?').run(id);
  },

  updateWhatsappId(playerId, whatsappId) {
    const db = getDatabase();
    return db.prepare('UPDATE players SET whatsapp_id = ? WHERE id = ?').run(whatsappId, playerId);
  },

  setBaseline(playerId, { played = 0, won = 0, drawn = 0, lost = 0, gf = 0, ga = 0, points = 0 }) {
    const db = getDatabase();
    return db.prepare(`
      UPDATE players 
      SET baseline_played = ?,
          baseline_won = ?,
          baseline_drawn = ?,
          baseline_lost = ?,
          baseline_gf = ?,
          baseline_ga = ?,
          baseline_points = ?
      WHERE id = ?
    `).run(played, won, drawn, lost, gf, ga, points, playerId);
  },

  countActive(leagueId = 'default') {
    const db = getDatabase();
    return db.prepare('SELECT COUNT(*) as count FROM players WHERE active = 1 AND league_id = ?').get(leagueId).count;
  },

  getDistinctLeagues() {
    const db = getDatabase();
    return db.prepare('SELECT DISTINCT league_id FROM players').all().map(r => r.league_id);
  }
};

module.exports = PlayerRepo;
