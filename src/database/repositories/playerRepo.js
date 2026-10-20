const { getDatabase } = require('../db');

function normalizeId(id) {
  if (!id) return '';
  return id.replace(/[^0-9]/g, '');
}

function sanitizeName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Player name must be a valid non-empty string.');
  }
  // Remove control characters, newlines, tabs, and excess whitespace
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
  create(name, whatsappId = null, joinedWeek = 1) {
    const cleanName = sanitizeName(name);
    const cleanId = whatsappId ? whatsappId.trim() : null;
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT INTO players (name, whatsapp_id, joined_week, active)
      VALUES (?, ?, ?, 1)
    `);
    const info = stmt.run(cleanName, cleanId, joinedWeek);
    return this.findById(info.lastInsertRowid);
  },

  findById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  },

  findByName(name) {
    if (!name) return null;
    const db = getDatabase();
    const clean = name.trim().toLowerCase();
    return db.prepare('SELECT * FROM players WHERE LOWER(name) = ?').get(clean);
  },

  findByWhatsappId(whatsappId) {
    if (!whatsappId) return null;
    const db = getDatabase();
    const norm = normalizeId(whatsappId);
    return db.prepare(`
      SELECT * FROM players 
      WHERE whatsapp_id = ? 
         OR REPLACE(REPLACE(whatsapp_id, '@c.us', ''), '@s.whatsapp.net', '') = ?
    `).get(whatsappId, norm);
  },

  findByNameOrFuzzy(query) {
    if (!query) return null;
    const direct = this.findByName(query);
    if (direct) return direct;

    const db = getDatabase();
    const clean = query.trim().toLowerCase();
    const matches = db.prepare(`
      SELECT * FROM players 
      WHERE LOWER(name) LIKE ? AND active = 1
    `).all(`%${clean}%`);

    if (matches.length === 1) {
      return matches[0];
    }
    return null;
  },

  getAllActive() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM players WHERE active = 1 ORDER BY id ASC').all();
  },

  getAll() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM players ORDER BY id ASC').all();
  },

  deactivate(idOrName) {
    const db = getDatabase();
    if (typeof idOrName === 'number') {
      return db.prepare('UPDATE players SET active = 0 WHERE id = ?').run(idOrName);
    }
    return db.prepare('UPDATE players SET active = 0 WHERE LOWER(name) = ?').run(idOrName.trim().toLowerCase());
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

  countActive() {
    const db = getDatabase();
    return db.prepare('SELECT COUNT(*) as count FROM players WHERE active = 1').get().count;
  }
};

module.exports = PlayerRepo;
