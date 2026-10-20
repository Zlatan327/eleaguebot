const { getDatabase } = require('../db');

function resolveKey(key, leagueId = 'default') {
  if (!leagueId || leagueId === 'default') {
    return key;
  }
  return `${leagueId}:${key}`;
}

const SettingsRepo = {
  get(key, defaultValue = null, leagueId = 'default') {
    const db = getDatabase();
    if (leagueId && leagueId !== 'default') {
      const scopedKey = resolveKey(key, leagueId);
      const scopedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(scopedKey);
      if (scopedRow) return scopedRow.value;
    }

    const globalRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return globalRow ? globalRow.value : defaultValue;
  },

  getInt(key, defaultValue = 0, leagueId = 'default') {
    const val = this.get(key, null, leagueId);
    return val !== null ? parseInt(val, 10) : defaultValue;
  },

  set(key, value, leagueId = 'default') {
    const db = getDatabase();
    const finalKey = resolveKey(key, leagueId);
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(finalKey, String(value));
  },

  delete(key, leagueId = 'default') {
    const db = getDatabase();
    const finalKey = resolveKey(key, leagueId);
    return db.prepare('DELETE FROM settings WHERE key = ?').run(finalKey);
  },

  getAll(leagueId = 'default') {
    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }
};

module.exports = SettingsRepo;
